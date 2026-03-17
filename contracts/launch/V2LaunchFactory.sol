// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * V2LaunchFactory (one-click on-chain launcher)
 *
 * Goal: allow any user to click ONE button in the frontend and finish:
 * - deploy token (OZAdvancedLaunchToken)
 * - set router/pair
 * - addLiquidityETH (Uniswap V2 / forks)
 * - lock LP token into LPTimeLock (optional deploy a new LPTimeLock)
 * - enable trading
 *
 * Important:
 * - This factory is intended to be deployed ONCE per chain with the correct V2 router address.
 * - Users call `launch{value: ethAmount}(... )` from the frontend.
 * - LP token (pair address) is ERC20 in V2.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";

import "./OZAdvancedLaunchTokenUpgradeable.sol";
import "./LPTimeLock.sol";

interface IUniswapV2Router02Factory {
  function WETH() external view returns (address);
  function addLiquidityETH(
    address token,
    uint256 amountTokenDesired,
    uint256 amountTokenMin,
    uint256 amountETHMin,
    address to,
    uint256 deadline
  ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

contract V2LaunchFactory {
  IUniswapV2Router02Factory public immutable router;
  address public immutable tokenImplementation;

  event Launched(
    address indexed user,
    address indexed token,
    address indexed pair,
    address lpLock,
    uint256 lockId
  );

  constructor(address router_, address tokenImplementation_) {
    require(router_ != address(0), "router=0");
    require(tokenImplementation_ != address(0), "tokenImpl=0");
    router = IUniswapV2Router02Factory(router_);
    tokenImplementation = tokenImplementation_;
  }

  struct Fees {
    uint16 buyMarketingBps;
    uint16 buyLiquidityBps;
    uint16 buyBurnBps;
    uint16 sellMarketingBps;
    uint16 sellLiquidityBps;
    uint16 sellBurnBps;
  }

  struct Limits {
    uint256 maxGasPriceWei; // 0 disabled
    uint256 deadBlocks;     // 0 disabled
    bool revertEarlyBuys;
    uint256 maxTxAmount;    // 0 disabled (raw)
    uint256 maxWalletAmount;// 0 disabled (raw)
  }

  struct TokenConfig {
    string name;
    string symbol;
    uint256 totalSupplyRaw;
    address marketingWallet;
    Fees fees;
    Limits limits;
  }

  struct Liquidity {
    uint256 tokenAmount; // raw token units
    uint256 ethAmount;   // wei, MUST equal msg.value
  }

  function _deployToken(TokenConfig calldata cfg) private returns (OZAdvancedLaunchTokenUpgradeable token, address tokenAddr) {
    tokenAddr = Clones.clone(tokenImplementation);
    token = OZAdvancedLaunchTokenUpgradeable(payable(tokenAddr));
    token.initialize(address(this), cfg.name, cfg.symbol, cfg.totalSupplyRaw, cfg.marketingWallet);
    token.setBuyFees(cfg.fees.buyMarketingBps, cfg.fees.buyLiquidityBps, cfg.fees.buyBurnBps);
    token.setSellFees(cfg.fees.sellMarketingBps, cfg.fees.sellLiquidityBps, cfg.fees.sellBurnBps);
    token.setLimits(
      cfg.limits.maxGasPriceWei,
      cfg.limits.deadBlocks,
      cfg.limits.revertEarlyBuys,
      cfg.limits.maxTxAmount,
      cfg.limits.maxWalletAmount
    );
  }

  function launch(
    TokenConfig calldata cfg,
    Liquidity calldata liq,
    address lpBeneficiary,
    uint256 lpLockSeconds,
    address lpLockAddress // optional, if 0 -> deploy new LPTimeLock
  ) external payable returns (address tokenAddr, address pairAddr, address lockAddr, uint256 lockId) {
    require(cfg.totalSupplyRaw > 0, "supply=0");
    require(lpBeneficiary != address(0), "beneficiary=0");
    require(lpLockSeconds > 0, "lockSeconds=0");
    require(liq.ethAmount == msg.value, "msg.value != ethAmount");
    require(liq.tokenAmount > 0 && liq.ethAmount > 0, "liquidity=0");

    // Deploy token owned by THIS factory so we can set router/add liquidity/lock LP in one tx.
    OZAdvancedLaunchTokenUpgradeable token;
    (token, tokenAddr) = _deployToken(cfg);

    // Set router & create pair
    token.setRouter(address(router));
    pairAddr = token.uniswapV2Pair();
    require(pairAddr != address(0), "pair=0");

    // Approve router to spend tokens for liquidity
    IERC20(tokenAddr).approve(address(router), liq.tokenAmount);

    // Add liquidity: LP tokens will be minted to THIS factory
    router.addLiquidityETH{ value: liq.ethAmount }(
      tokenAddr,
      liq.tokenAmount,
      0,
      0,
      address(this),
      block.timestamp
    );

    // Deploy or reuse LP lock contract
    if (lpLockAddress == address(0)) {
      LPTimeLock l = new LPTimeLock();
      lockAddr = address(l);
    } else {
      lockAddr = lpLockAddress;
    }

    // Lock ALL LP tokens received
    uint256 lpBalance = IERC20(pairAddr).balanceOf(address(this));
    require(lpBalance > 0, "no LP received");

    IERC20(pairAddr).approve(lockAddr, lpBalance);
    uint256 unlockTime = block.timestamp + lpLockSeconds;
    lockId = LPTimeLock(lockAddr).createLock(pairAddr, lpBeneficiary, lpBalance, unlockTime);

    // Enable trading (sets launchBlock)
    token.enableTrading();

    // Transfer token ownership to user
    token.transferOwnership(msg.sender);

    // Transfer remaining tokens (if any) to user
    uint256 remaining = IERC20(tokenAddr).balanceOf(address(this));
    if (remaining > 0) {
      IERC20(tokenAddr).transfer(msg.sender, remaining);
    }

    emit Launched(msg.sender, tokenAddr, pairAddr, lockAddr, lockId);
  }
}


