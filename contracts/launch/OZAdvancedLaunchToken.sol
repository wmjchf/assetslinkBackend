// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * OZAdvancedLaunchToken (Uniswap V2 style)
 * OpenZeppelin-based ERC20 with:
 * - Buy/Sell fees (marketing / liquidity / burn) in BPS
 * - Anti-bot (dead blocks, max gas price)
 * - Limits (max tx, max wallet)
 * - Whitelist / Blacklist
 * - Trading toggle + auto pair create via UniswapV2 router
 * - Swap-back: swap fee tokens to ETH + add liquidity + send marketing ETH
 *
 * Notes:
 * - Targets Uniswap V2 / V2 forks (PancakeSwap V2 etc.)
 * - Uniswap V3 LP is NFT; not compatible with V2 LP lock flow
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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

contract OZAdvancedLaunchToken is ERC20, Ownable {
  struct FeeConfig {
    uint16 marketingBps;
    uint16 liquidityBps;
    uint16 burnBps;
    uint16 totalBps;
  }

  address public marketingWallet;
  address public constant BURN_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

  // Uniswap V2
  IUniswapV2Router02 public uniswapV2Router;
  address public uniswapV2Pair;

  // trading
  bool public tradingEnabled;
  uint256 public launchBlock;

  // fees
  FeeConfig public buyFee;
  FeeConfig public sellFee;

  bool public swapEnabled = true;
  uint256 public swapTokensAtAmount;
  bool private _inSwap;

  // anti-bot / limits
  uint256 public maxGasPriceWei; // 0 disabled
  uint256 public deadBlocks; // 0 disabled
  bool public revertEarlyBuys = true;

  uint256 public maxTxAmount; // 0 disabled
  uint256 public maxWalletAmount; // 0 disabled

  mapping(address => bool) public isWhitelisted;
  mapping(address => bool) public isBlacklisted;
  mapping(address => bool) public isExcludedFromFees;
  mapping(address => bool) public isExcludedFromLimits;

  event RouterSet(address indexed router, address indexed pair);
  event TradingEnabled(uint256 indexed launchBlock, address indexed pair);
  event MarketingWalletSet(address indexed wallet);
  event FeesUpdated(string side, uint16 marketingBps, uint16 liquidityBps, uint16 burnBps, uint16 totalBps);
  event SwapSettingsUpdated(bool enabled, uint256 thresholdTokens);
  event LimitsUpdated(uint256 maxGasPriceWei, uint256 deadBlocks, bool revertEarlyBuys, uint256 maxTxAmount, uint256 maxWalletAmount);
  event AddressFlagsUpdated(address indexed account, bool whitelisted, bool blacklisted, bool excludedFees, bool excludedLimits);

  modifier swapping() {
    _inSwap = true;
    _;
    _inSwap = false;
  }

  constructor(
    address initialOwner,
    string memory tokenName,
    string memory tokenSymbol,
    uint256 initialSupplyRaw,
    address marketingWallet_
  ) ERC20(tokenName, tokenSymbol) Ownable(initialOwner) {
    require(marketingWallet_ != address(0), "marketing wallet = 0");
    marketingWallet = marketingWallet_;

    // default fees: buy 4%, sell 6%
    buyFee = _makeFee(200, 200, 0);
    sellFee = _makeFee(300, 300, 0);

    // default swap threshold: 0.01%
    swapTokensAtAmount = initialSupplyRaw / 10_000;

    // exclusions
    isExcludedFromFees[initialOwner] = true;
    isExcludedFromFees[address(this)] = true;
    isExcludedFromFees[marketingWallet_] = true;

    isExcludedFromLimits[initialOwner] = true;
    isExcludedFromLimits[address(this)] = true;
    isExcludedFromLimits[marketingWallet_] = true;

    // whitelist owner + contract for pre-launch setup
    isWhitelisted[initialOwner] = true;
    isWhitelisted[address(this)] = true;

    _mint(initialOwner, initialSupplyRaw);
  }

  receive() external payable {}

  // --- admin: router/pair/trading ---
  function setRouter(address router) external onlyOwner {
    require(router != address(0), "router=0");
    uniswapV2Router = IUniswapV2Router02(router);
    address pair = IUniswapV2Factory(uniswapV2Router.factory()).createPair(address(this), uniswapV2Router.WETH());
    uniswapV2Pair = pair;
    isExcludedFromLimits[pair] = true;
    emit RouterSet(router, pair);
  }

  function enableTrading() external onlyOwner {
    require(!tradingEnabled, "already enabled");
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

  // manual trigger (owner or marketing)
  function manualSwapBack() external {
    require(msg.sender == owner() || msg.sender == marketingWallet, "not allowed");
    _swapBack();
  }

  // --- ERC20 hook (OZ v5) ---
  function _update(address from, address to, uint256 amount) internal override {
    require(!isBlacklisted[from] && !isBlacklisted[to], "Blacklisted");

    // gas price limit only for pair trades
    if (maxGasPriceWei > 0 && (from == uniswapV2Pair || to == uniswapV2Pair)) {
      require(tx.gasprice <= maxGasPriceWei, "Gas price too high");
    }

    // trading gate
    if (!tradingEnabled) {
      // allow mint/burn and whitelisted transfers pre-launch
      if (from != address(0) && to != address(0)) {
        require(isWhitelisted[from] || isWhitelisted[to], "Trading not enabled");
      }
    }

    bool isBuy = (from == uniswapV2Pair && to != address(uniswapV2Router));
    bool isSell = (to == uniswapV2Pair);

    // anti-bot: dead blocks restrict buys
    if (tradingEnabled && deadBlocks > 0 && isBuy && !isWhitelisted[to]) {
      if (block.number < launchBlock + deadBlocks) {
        if (revertEarlyBuys) revert("AntiBot: early buy blocked");
      }
    }

    // limits
    if (!isExcludedFromLimits[from] && !isExcludedFromLimits[to]) {
      if (maxTxAmount > 0 && (isBuy || isSell)) {
        require(amount <= maxTxAmount, "Max tx exceeded");
      }
      if (maxWalletAmount > 0 && isBuy) {
        require(balanceOf(to) + amount <= maxWalletAmount, "Max wallet exceeded");
      }
    }

    // swap back before sell
    if (
      !_inSwap &&
      swapEnabled &&
      isSell &&
      address(uniswapV2Router) != address(0) &&
      uniswapV2Pair != address(0) &&
      swapTokensAtAmount > 0 &&
      balanceOf(address(this)) >= swapTokensAtAmount
    ) {
      _swapBack();
    }

    // fees only on buys/sells, and not during swap
    if (
      !_inSwap &&
      (isBuy || isSell) &&
      from != address(0) &&
      to != address(0) &&
      !isExcludedFromFees[from] &&
      !isExcludedFromFees[to]
    ) {
      FeeConfig memory fee = isBuy ? buyFee : sellFee;
      if (fee.totalBps > 0) {
        uint256 feeAmount = (amount * fee.totalBps) / 10_000;
        if (feeAmount > 0) {
          uint256 transferAmount = amount - feeAmount;

          // burn portion
          uint256 burnAmount = (feeAmount * fee.burnBps) / fee.totalBps;
          uint256 remainingFee = feeAmount - burnAmount;

          if (burnAmount > 0) {
            super._update(from, BURN_ADDRESS, burnAmount);
          }
          if (remainingFee > 0) {
            super._update(from, address(this), remainingFee);
          }

          super._update(from, to, transferAmount);
          return;
        }
      }
    }

    super._update(from, to, amount);
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
    uint256 contractTokenBalance = balanceOf(address(this));
    if (contractTokenBalance == 0) return;
    if (address(uniswapV2Router) == address(0)) return;
    if (uniswapV2Pair == address(0)) return;

    // use sell fee weights as default ratio
    uint16 totalBps = sellFee.totalBps;
    if (totalBps == 0) return;

    uint256 liquidityTokens = (contractTokenBalance * sellFee.liquidityBps) / totalBps;
    uint256 marketingTokens = contractTokenBalance - liquidityTokens;

    uint256 tokensForLiquidityHalf = liquidityTokens / 2;
    uint256 tokensToSwapForEth = marketingTokens + (liquidityTokens - tokensForLiquidityHalf);

    if (tokensToSwapForEth == 0) return;

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

    uint256 ethForMarketing = 0;
    if (tokensToSwapForEth > 0) {
      ethForMarketing = (ethGained * marketingTokens) / tokensToSwapForEth;
    }
    uint256 ethForLiquidity = ethGained - ethForMarketing;

    if (ethForMarketing > 0 && marketingWallet != address(0)) {
      (bool ok, ) = marketingWallet.call{ value: ethForMarketing }("");
      ok;
    }

    if (tokensForLiquidityHalf > 0 && ethForLiquidity > 0) {
      _approve(address(this), address(uniswapV2Router), tokensForLiquidityHalf);
      uniswapV2Router.addLiquidityETH{ value: ethForLiquidity }(
        address(this),
        tokensForLiquidityHalf,
        0,
        0,
        owner(),
        block.timestamp
      );
    }
  }
}


