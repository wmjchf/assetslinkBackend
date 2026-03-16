// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * AdvancedLaunchToken (Uniswap V2 style)
 * - ERC20 with optional buy/sell fees (marketing / liquidity / burn)
 * - Anti-bot controls (dead blocks, max gas price, max tx, max wallet)
 * - Whitelist / Blacklist
 * - Trading switch + pair detection (buy/sell on UniswapV2Pair)
 * - Optional swap-back: swap collected fees to ETH + add liquidity via router
 *
 * Notes:
 * - This contract targets Uniswap V2 / forks (PancakeSwap V2 etc.).
 * - For Uniswap V3 (LP is NFT), the LP lock design is different.
 * - All params are configurable by owner. Use responsibly.
 */

interface IERC20Minimal {
  function totalSupply() external view returns (uint256);
  function balanceOf(address account) external view returns (uint256);
  function transfer(address to, uint256 value) external returns (bool);
  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 value) external returns (bool);
  function transferFrom(address from, address to, uint256 value) external returns (bool);
  event Transfer(address indexed from, address indexed to, uint256 value);
  event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IUniswapV2Factory {
  function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Router02 {
  function factory() external view returns (address);
  function WETH() external view returns (address);
  function addLiquidityETH(
    address token,
    uint256 amountTokenDesired,
    uint256 amountTokenMin,
    uint256 amountETHMin,
    address to,
    uint256 deadline
  ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

  function swapExactTokensForETHSupportingFeeOnTransferTokens(
    uint256 amountIn,
    uint256 amountOutMin,
    address[] calldata path,
    address to,
    uint256 deadline
  ) external;
}

abstract contract Ownable {
  address public owner;
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
  modifier onlyOwner() {
    require(msg.sender == owner, "Ownable: not owner");
    _;
  }
  constructor(address initialOwner) {
    require(initialOwner != address(0), "Ownable: zero owner");
    owner = initialOwner;
    emit OwnershipTransferred(address(0), initialOwner);
  }
  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "Ownable: zero owner");
    emit OwnershipTransferred(owner, newOwner);
    owner = newOwner;
  }
}

contract AdvancedLaunchToken is IERC20Minimal, Ownable {
  string public name;
  string public symbol;
  uint8 private _decimals;

  uint256 private _totalSupply;
  mapping(address => uint256) private _balances;
  mapping(address => mapping(address => uint256)) private _allowances;

  // trading / pairs
  bool public tradingEnabled;
  uint256 public launchBlock;
  address public uniswapV2Pair;
  IUniswapV2Router02 public uniswapV2Router;

  // fee config (BPS out of 10_000)
  struct FeeConfig {
    uint16 marketingBps;
    uint16 liquidityBps;
    uint16 burnBps;
    uint16 totalBps;
  }
  FeeConfig public buyFee;
  FeeConfig public sellFee;

  address public marketingWallet;
  address public constant BURN_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

  // fee handling
  bool public swapEnabled = true;
  uint256 public swapTokensAtAmount;
  bool private _inSwap;
  modifier swapping() {
    _inSwap = true;
    _;
    _inSwap = false;
  }

  // anti-bot / limits
  uint256 public maxGasPriceWei; // 0 = disabled
  uint256 public deadBlocks; // blocks after enableTrading where buys are restricted
  bool public revertEarlyBuys = true; // if false, early buys are allowed but still limited by other rules

  uint256 public maxTxAmount; // 0 = disabled
  uint256 public maxWalletAmount; // 0 = disabled

  mapping(address => bool) public isWhitelisted; // can buy during dead blocks / before trading
  mapping(address => bool) public isBlacklisted;
  mapping(address => bool) public isExcludedFromFees;
  mapping(address => bool) public isExcludedFromLimits;

  event TradingEnabled(uint256 indexed launchBlock, address indexed pair);
  event RouterSet(address indexed router, address indexed pair);
  event MarketingWalletSet(address indexed wallet);
  event FeesUpdated(string side, uint16 marketingBps, uint16 liquidityBps, uint16 burnBps, uint16 totalBps);
  event SwapSettingsUpdated(bool enabled, uint256 swapTokensAtAmount);
  event LimitsUpdated(uint256 maxGasPriceWei, uint256 deadBlocks, bool revertEarlyBuys, uint256 maxTxAmount, uint256 maxWalletAmount);
  event AddressFlagsUpdated(address indexed account, bool whitelisted, bool blacklisted, bool excludedFees, bool excludedLimits);

  constructor(
    address initialOwner,
    string memory tokenName,
    string memory tokenSymbol,
    uint8 tokenDecimals,
    uint256 initialSupply,
    address marketingWallet_
  ) Ownable(initialOwner) {
    require(marketingWallet_ != address(0), "marketing wallet = 0");
    name = tokenName;
    symbol = tokenSymbol;
    _decimals = tokenDecimals;
    marketingWallet = marketingWallet_;

    // defaults
    swapTokensAtAmount = initialSupply / 10_000; // 0.01%
    // buy: 2% marketing + 2% liquidity + 0% burn = 4%
    buyFee = _makeFee(200, 200, 0);
    // sell: 3% marketing + 3% liquidity + 0% burn = 6%
    sellFee = _makeFee(300, 300, 0);

    // exclusions
    isExcludedFromFees[initialOwner] = true;
    isExcludedFromFees[address(this)] = true;
    isExcludedFromFees[marketingWallet_] = true;

    isExcludedFromLimits[initialOwner] = true;
    isExcludedFromLimits[address(this)] = true;
    isExcludedFromLimits[marketingWallet_] = true;

    // whitelist owner so they can set up liquidity pre-trading
    isWhitelisted[initialOwner] = true;
    isWhitelisted[address(this)] = true;

    _mint(initialOwner, initialSupply);
  }

  receive() external payable {}

  function decimals() external view returns (uint8) {
    return _decimals;
  }

  function totalSupply() external view override returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address account) external view override returns (uint256) {
    return _balances[account];
  }

  function allowance(address owner_, address spender) external view override returns (uint256) {
    return _allowances[owner_][spender];
  }

  function approve(address spender, uint256 value) external override returns (bool) {
    _approve(msg.sender, spender, value);
    return true;
  }

  function transfer(address to, uint256 value) external override returns (bool) {
    _transfer(msg.sender, to, value);
    return true;
  }

  function transferFrom(address from, address to, uint256 value) external override returns (bool) {
    uint256 currentAllowance = _allowances[from][msg.sender];
    require(currentAllowance >= value, "ERC20: insufficient allowance");
    unchecked {
      _allowances[from][msg.sender] = currentAllowance - value;
    }
    emit Approval(from, msg.sender, _allowances[from][msg.sender]);
    _transfer(from, to, value);
    return true;
  }

  // --- admin: router / pair / trading ---
  function setRouter(address router) external onlyOwner {
    require(router != address(0), "router=0");
    uniswapV2Router = IUniswapV2Router02(router);
    address pair = IUniswapV2Factory(uniswapV2Router.factory()).createPair(address(this), uniswapV2Router.WETH());
    uniswapV2Pair = pair;
    isExcludedFromLimits[pair] = true;
    emit RouterSet(router, pair);
  }

  function enableTrading() external onlyOwner {
    require(!tradingEnabled, "trading already enabled");
    require(uniswapV2Pair != address(0), "pair not set");
    tradingEnabled = true;
    launchBlock = block.number;
    emit TradingEnabled(launchBlock, uniswapV2Pair);
  }

  // --- admin: config ---
  function setMarketingWallet(address wallet) external onlyOwner {
    require(wallet != address(0), "wallet=0");
    marketingWallet = wallet;
    isExcludedFromFees[wallet] = true;
    isExcludedFromLimits[wallet] = true;
    emit MarketingWalletSet(wallet);
  }

  function setBuyFees(uint16 marketingBps, uint16 liquidityBps, uint16 burnBps) external onlyOwner {
    buyFee = _makeFee(marketingBps, liquidityBps, burnBps);
    emit FeesUpdated("buy", marketingBps, liquidityBps, burnBps, buyFee.totalBps);
  }

  function setSellFees(uint16 marketingBps, uint16 liquidityBps, uint16 burnBps) external onlyOwner {
    sellFee = _makeFee(marketingBps, liquidityBps, burnBps);
    emit FeesUpdated("sell", marketingBps, liquidityBps, burnBps, sellFee.totalBps);
  }

  function setSwapSettings(bool enabled, uint256 thresholdTokens) external onlyOwner {
    swapEnabled = enabled;
    swapTokensAtAmount = thresholdTokens;
    emit SwapSettingsUpdated(enabled, thresholdTokens);
  }

  function setLimits(
    uint256 maxGasPriceWei_,
    uint256 deadBlocks_,
    bool revertEarlyBuys_,
    uint256 maxTxAmount_,
    uint256 maxWalletAmount_
  ) external onlyOwner {
    maxGasPriceWei = maxGasPriceWei_;
    deadBlocks = deadBlocks_;
    revertEarlyBuys = revertEarlyBuys_;
    maxTxAmount = maxTxAmount_;
    maxWalletAmount = maxWalletAmount_;
    emit LimitsUpdated(maxGasPriceWei_, deadBlocks_, revertEarlyBuys_, maxTxAmount_, maxWalletAmount_);
  }

  function setAddressFlags(
    address account,
    bool whitelisted,
    bool blacklisted,
    bool excludedFees,
    bool excludedLimits
  ) external onlyOwner {
    isWhitelisted[account] = whitelisted;
    isBlacklisted[account] = blacklisted;
    isExcludedFromFees[account] = excludedFees;
    isExcludedFromLimits[account] = excludedLimits;
    emit AddressFlagsUpdated(account, whitelisted, blacklisted, excludedFees, excludedLimits);
  }

  // --- public helpers ---
  function manualSwapBack() external {
    require(msg.sender == owner || msg.sender == marketingWallet, "not allowed");
    _swapBack();
  }

  // --- internal ERC20 ---
  function _approve(address owner_, address spender, uint256 value) internal {
    require(owner_ != address(0) && spender != address(0), "ERC20: zero address");
    _allowances[owner_][spender] = value;
    emit Approval(owner_, spender, value);
  }

  function _mint(address to, uint256 value) internal {
    require(to != address(0), "ERC20: mint to zero");
    _totalSupply += value;
    _balances[to] += value;
    emit Transfer(address(0), to, value);
  }

  function _transfer(address from, address to, uint256 value) internal {
    require(from != address(0) && to != address(0), "ERC20: zero address");
    require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklisted");

    // gas price limit (only for buys/sells)
    if (maxGasPriceWei > 0 && (from == uniswapV2Pair || to == uniswapV2Pair)) {
      require(tx.gasprice <= maxGasPriceWei, "Gas price too high");
    }

    // trading gate
    if (!tradingEnabled) {
      require(isWhitelisted[from] || isWhitelisted[to], "Trading not enabled");
    }

    bool isBuy = (from == uniswapV2Pair && to != address(uniswapV2Router));
    bool isSell = (to == uniswapV2Pair);

    // dead blocks (anti-bot) - restrict buys near launch
    if (tradingEnabled && deadBlocks > 0 && isBuy && !isWhitelisted[to]) {
      if (block.number < launchBlock + deadBlocks) {
        if (revertEarlyBuys) {
          revert("AntiBot: early buy blocked");
        }
      }
    }

    // limits (tx/wallet)
    if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
      if (maxTxAmount > 0 && (isBuy || isSell)) {
        require(value <= maxTxAmount, "Max tx exceeded");
      }
      if (maxWalletAmount > 0 && isBuy) {
        require(_balances[to] + value <= maxWalletAmount, "Max wallet exceeded");
      }
    }

    uint256 fromBalance = _balances[from];
    require(fromBalance >= value, "ERC20: transfer exceeds balance");

    // swap back before sell to reduce price impact
    if (
      !_inSwap &&
      swapEnabled &&
      isSell &&
      uniswapV2Pair != address(0) &&
      address(uniswapV2Router) != address(0) &&
      swapTokensAtAmount > 0 &&
      _balances[address(this)] >= swapTokensAtAmount
    ) {
      _swapBack();
    }

    uint256 amountToTransfer = value;

    // fees
    if (!_inSwap && !isExcludedFromFees[from] && !isExcludedFromFees[to] && (isBuy || isSell)) {
      FeeConfig memory fee = isBuy ? buyFee : sellFee;
      if (fee.totalBps > 0) {
        uint256 feeAmount = (value * fee.totalBps) / 10_000;
        if (feeAmount > 0) {
          amountToTransfer = value - feeAmount;

          // burn part
          uint256 burnAmount = (feeAmount * fee.burnBps) / fee.totalBps;
          if (burnAmount > 0) {
            _balances[from] = fromBalance - burnAmount;
            _balances[BURN_ADDRESS] += burnAmount;
            emit Transfer(from, BURN_ADDRESS, burnAmount);
            fromBalance = _balances[from];
            feeAmount -= burnAmount;
          }

          // collect remaining fee to contract
          if (feeAmount > 0) {
            _balances[from] = fromBalance - feeAmount;
            _balances[address(this)] += feeAmount;
            emit Transfer(from, address(this), feeAmount);
            fromBalance = _balances[from];
          }
        }
      }
    }

    // normal transfer
    unchecked {
      _balances[from] = fromBalance - amountToTransfer;
    }
    _balances[to] += amountToTransfer;
    emit Transfer(from, to, amountToTransfer);
  }

  function _makeFee(uint16 marketingBps, uint16 liquidityBps, uint16 burnBps) internal pure returns (FeeConfig memory) {
    uint16 total = marketingBps + liquidityBps + burnBps;
    require(total <= 2_000, "Fee too high (max 20%)");
    return FeeConfig({
      marketingBps: marketingBps,
      liquidityBps: liquidityBps,
      burnBps: burnBps,
      totalBps: total
    });
  }

  function _swapBack() internal swapping {
    uint256 contractTokenBalance = _balances[address(this)];
    if (contractTokenBalance == 0) return;
    if (address(uniswapV2Router) == address(0)) return;
    if (uniswapV2Pair == address(0)) return;

    // split by sellFee weights (more common) to simplify; you can also make a custom ratio.
    uint16 totalBps = sellFee.totalBps;
    if (totalBps == 0) return;

    uint256 liquidityTokens = (contractTokenBalance * sellFee.liquidityBps) / totalBps;
    uint256 marketingTokens = contractTokenBalance - liquidityTokens;

    uint256 tokensForLiquidityHalf = liquidityTokens / 2;
    uint256 tokensToSwapForEth = marketingTokens + (liquidityTokens - tokensForLiquidityHalf);

    // approve router
    _approve(address(this), address(uniswapV2Router), tokensToSwapForEth);

    uint256 ethBefore = address(this).balance;
    address[] memory path = new address[](2);
    path[0] = address(this);
    path[1] = uniswapV2Router.WETH();

    uniswapV2Router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      tokensToSwapForEth,
      0,
      path,
      address(this),
      block.timestamp
    );

    uint256 ethGained = address(this).balance - ethBefore;
    if (ethGained == 0) return;

    // eth allocation: marketing gets proportional to marketingTokens, liquidity gets remaining
    uint256 ethForMarketing = 0;
    if (tokensToSwapForEth > 0) {
      ethForMarketing = (ethGained * marketingTokens) / tokensToSwapForEth;
    }
    uint256 ethForLiquidity = ethGained - ethForMarketing;

    if (ethForMarketing > 0 && marketingWallet != address(0)) {
      (bool ok, ) = marketingWallet.call{ value: ethForMarketing }("");
      ok; // ignore failure to avoid blocking transfers; owner can manualWithdraw via router or rescue
    }

    if (tokensForLiquidityHalf > 0 && ethForLiquidity > 0) {
      _approve(address(this), address(uniswapV2Router), tokensForLiquidityHalf);
      uniswapV2Router.addLiquidityETH{ value: ethForLiquidity }(
        address(this),
        tokensForLiquidityHalf,
        0,
        0,
        owner,
        block.timestamp
      );
    }
  }
}


