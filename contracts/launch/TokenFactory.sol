// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * TokenFactory
 *
 * Deploys SafeLaunchToken and LinearVestingVault instances via `new` (no proxy / no clone).
 *
 * Why `new` instead of Clones (EIP-1167)?
 * - EIP-1167 creates a minimal proxy whose bytecode only delegates to the
 *   implementation. Etherscan shows it as "Read/Write Contract as Proxy" and
 *   GoPlus flags is_proxy = 1 + is_open_source = 0 (source not verified for
 *   the proxy shell itself).
 * - With `new`, every deployed contract IS the full implementation.
 *   Etherscan matches the identical deployed bytecode to the verified source.
 *   Result: is_proxy = 0, is_open_source = 1.
 *
 * ABI-compatible with previous factory:
 *   - TokenConfig still has `fees` (6 BPS sub-fields) and `limits` structs.
 *   - `limits` is accepted for ABI compatibility but not applied (token has no limits).
 *   - Buy/sell fee totals are derived by summing the 3 BPS sub-fields each.
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./SafeLaunchToken.sol";
import "./LinearVestingVault.sol";

contract TokenFactory is ReentrancyGuard {
  using SafeERC20 for IERC20;

  event TokenCreated(address indexed creator, address indexed token);
  event TokenDistributed(address indexed token, address indexed to, uint256 amount);
  event VestingCreated(address indexed token, address indexed vault, address indexed beneficiary, uint256 amount);
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
  event FeesUpdated(
    uint256 oldBasicFeeWei,
    uint256 oldDistributionFeeWei,
    uint256 oldVestingFeeWei,
    uint256 newBasicFeeWei,
    uint256 newDistributionFeeWei,
    uint256 newVestingFeeWei
  );
  event FeesWithdrawn(address indexed to, uint256 amountWei);

  address public owner;
  uint256 public basicFeeWei;         // createToken
  uint256 public distributionFeeWei;  // createTokenWithDistribution
  uint256 public vestingFeeWei;       // createTokenWithDistributionAndVesting

  modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
  }

  constructor() {
    owner = msg.sender;
    emit OwnershipTransferred(address(0), msg.sender);

    basicFeeWei        = 0.0001 ether;
    distributionFeeWei = 0.001 ether;
    vestingFeeWei      = 0.005 ether;
  }

  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "owner=0");
    address prev = owner;
    owner = newOwner;
    emit OwnershipTransferred(prev, newOwner);
  }

  function setFeesWei(
    uint256 newBasicFeeWei,
    uint256 newDistributionFeeWei,
    uint256 newVestingFeeWei
  ) external onlyOwner {
    require(newBasicFeeWei        <= 1 ether, "basic fee too high");
    require(newDistributionFeeWei <= 1 ether, "distribution fee too high");
    require(newVestingFeeWei      <= 1 ether, "vesting fee too high");

    uint256 oldBasic        = basicFeeWei;
    uint256 oldDistribution = distributionFeeWei;
    uint256 oldVesting      = vestingFeeWei;

    basicFeeWei        = newBasicFeeWei;
    distributionFeeWei = newDistributionFeeWei;
    vestingFeeWei      = newVestingFeeWei;

    emit FeesUpdated(oldBasic, oldDistribution, oldVesting, newBasicFeeWei, newDistributionFeeWei, newVestingFeeWei);
  }

  function withdrawFees(address payable to, uint256 amountWei) external onlyOwner nonReentrant {
    if (to == address(0)) to = payable(owner);
    uint256 amount = amountWei == 0 ? address(this).balance : amountWei;
    require(amount <= address(this).balance, "insufficient balance");

    emit FeesWithdrawn(to, amount);
    (bool ok, ) = to.call{ value: amount }("");
    require(ok, "withdraw failed");
  }

  function _requireFeePaid(uint256 feeWei) private view {
    if (feeWei == 0) {
      require(msg.value == 0, "no fee required");
    } else {
      require(msg.value == feeWei, "bad fee");
    }
  }

  // ---------------------------------------------------------------------------
  // Structs — ABI-compatible with the previous factory version.
  // ---------------------------------------------------------------------------

  struct TokenConfig {
    string name;
    string symbol;
    uint256 totalSupplyRaw;
    address marketingWallet;
    Fees fees;
    Limits limits; // accepted for ABI compatibility; not applied to the token
  }

  /**
   * Buy/sell fees split into marketing + liquidity + burn sub-fields.
   * The factory sums them into a single buyFeeBps / sellFeeBps and passes
   * the total to SafeLaunchToken, which routes everything to marketingWallet
   * as tokens (simple, no external-call risk).
   */
  struct Fees {
    uint16 buyMarketingBps;
    uint16 buyLiquidityBps;
    uint16 buyBurnBps;
    uint16 sellMarketingBps;
    uint16 sellLiquidityBps;
    uint16 sellBurnBps;
  }

  /**
   * Kept for ABI compatibility only. SafeLaunchToken has no limit mechanism,
   * so these values are accepted but not applied:
   *   is_anti_whale = 0, anti_whale_modifiable = 0, trading_cooldown = 0.
   */
  struct Limits {
    uint256 maxGasPriceWei;
    uint256 deadBlocks;
    bool    revertEarlyBuys;
    uint256 maxTxAmount;
    uint256 maxWalletAmount;
  }

  struct Vesting {
    address beneficiary;
    uint64  start;
    uint64  cliffSeconds;
    uint64  durationSeconds;
    uint256 amount;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function _sumFeeBps(Fees calldata f) private pure returns (uint16 buyTotal, uint16 sellTotal) {
    buyTotal  = f.buyMarketingBps  + f.buyLiquidityBps  + f.buyBurnBps;
    sellTotal = f.sellMarketingBps + f.sellLiquidityBps + f.sellBurnBps;
    require(buyTotal  <= 2_000, "buy fee > 20%");
    require(sellTotal <= 2_000, "sell fee > 20%");
  }

  function _deployToken(
    TokenConfig calldata cfg
  ) private returns (SafeLaunchToken token, address tokenAddr) {
    (uint16 buyBps, uint16 sellBps) = _sumFeeBps(cfg.fees);

    address marketing = cfg.marketingWallet != address(0) ? cfg.marketingWallet : msg.sender;

    // Deploy a full contract instance — NOT a proxy.
    // Each token has the same deployed bytecode → Etherscan auto-verifies via
    // bytecode match once this source is verified. is_proxy = 0.
    token = new SafeLaunchToken(
      address(this), // factory holds ownership until hand-off at end of create*
      cfg.name,
      cfg.symbol,
      cfg.totalSupplyRaw,
      marketing,
      buyBps,
      sellBps
    );
    tokenAddr = address(token);
  }

  function _deployVesting(address tokenAddr, Vesting calldata v) private returns (address vaultAddr) {
    LinearVestingVault vault = new LinearVestingVault(
      tokenAddr,
      v.beneficiary,
      v.start,
      v.cliffSeconds,
      v.durationSeconds,
      v.amount
    );
    vaultAddr = address(vault);
  }

  function _validateRecipientsAndSum(
    uint256 totalSupplyRaw,
    address[] calldata recipients,
    uint256[] calldata amounts
  ) private pure returns (uint256 sum) {
    require(recipients.length == amounts.length, "length mismatch");
    require(recipients.length <= 100, "too many recipients");
    for (uint256 i = 0; i < recipients.length; i++) {
      require(recipients[i] != address(0), "recipient=0");
      uint256 amt = amounts[i];
      if (amt == 0) continue;
      sum += amt;
    }
    require(sum <= totalSupplyRaw, "distribution > supply");
  }

  function _validateRecipientsVestingsAndSum(
    uint256 totalSupplyRaw,
    address[] calldata recipients,
    uint256[] calldata amounts,
    Vesting[] calldata vestings
  ) private pure returns (uint256 sum) {
    sum = _validateRecipientsAndSum(totalSupplyRaw, recipients, amounts);
    require(vestings.length <= 50, "too many vestings");
    for (uint256 j = 0; j < vestings.length; j++) {
      Vesting calldata v = vestings[j];
      require(v.beneficiary != address(0), "beneficiary=0");
      require(v.amount > 0, "vesting amount=0");
      sum += v.amount;
    }
    require(sum <= totalSupplyRaw, "distribution > supply");
  }

  // ---------------------------------------------------------------------------
  // Public entry points
  // ---------------------------------------------------------------------------

  /**
   * Deploy a bare token. All supply goes to msg.sender.
   */
  function createToken(TokenConfig calldata cfg) external payable returns (address tokenAddr) {
    _requireFeePaid(basicFeeWei);
    require(cfg.totalSupplyRaw > 0, "supply=0");

    SafeLaunchToken token;
    (token, tokenAddr) = _deployToken(cfg);

    token.transferOwnership(msg.sender);

    uint256 bal = token.balanceOf(address(this));
    if (bal > 0) {
      IERC20(tokenAddr).safeTransfer(msg.sender, bal);
    }

    emit TokenCreated(msg.sender, tokenAddr);
  }

  /**
   * Deploy token and distribute initial supply to multiple recipients.
   * Remaining supply (after recipients) goes to msg.sender.
   */
  function createTokenWithDistribution(
    TokenConfig calldata cfg,
    address[] calldata recipients,
    uint256[] calldata amounts
  ) external payable returns (address tokenAddr) {
    _requireFeePaid(distributionFeeWei);
    require(cfg.totalSupplyRaw > 0, "supply=0");
    _validateRecipientsAndSum(cfg.totalSupplyRaw, recipients, amounts);

    SafeLaunchToken token;
    (token, tokenAddr) = _deployToken(cfg);

    for (uint256 i = 0; i < recipients.length; i++) {
      uint256 amt = amounts[i];
      if (amt == 0) continue;
      IERC20(tokenAddr).safeTransfer(recipients[i], amt);
      emit TokenDistributed(tokenAddr, recipients[i], amt);
    }

    uint256 remaining = token.balanceOf(address(this));
    if (remaining > 0) {
      IERC20(tokenAddr).safeTransfer(msg.sender, remaining);
      emit TokenDistributed(tokenAddr, msg.sender, remaining);
    }

    token.transferOwnership(msg.sender);
    emit TokenCreated(msg.sender, tokenAddr);
  }

  /**
   * Deploy token, distribute some immediately, and vest the rest via
   * LinearVestingVault clones. Remaining supply goes to msg.sender.
   */
  function createTokenWithDistributionAndVesting(
    TokenConfig calldata cfg,
    address[] calldata recipients,
    uint256[] calldata amounts,
    Vesting[] calldata vestings
  ) external payable returns (address tokenAddr) {
    _requireFeePaid(vestingFeeWei);
    require(cfg.totalSupplyRaw > 0, "supply=0");
    _validateRecipientsVestingsAndSum(cfg.totalSupplyRaw, recipients, amounts, vestings);

    SafeLaunchToken token;
    (token, tokenAddr) = _deployToken(cfg);

    for (uint256 i = 0; i < recipients.length; i++) {
      uint256 amt = amounts[i];
      if (amt == 0) continue;
      IERC20(tokenAddr).safeTransfer(recipients[i], amt);
      emit TokenDistributed(tokenAddr, recipients[i], amt);
    }

    for (uint256 j = 0; j < vestings.length; j++) {
      Vesting calldata v = vestings[j];
      address vaultAddr = _deployVesting(tokenAddr, v);
      IERC20(tokenAddr).safeTransfer(vaultAddr, v.amount);
      emit VestingCreated(tokenAddr, vaultAddr, v.beneficiary, v.amount);
    }

    uint256 remaining = token.balanceOf(address(this));
    if (remaining > 0) {
      IERC20(tokenAddr).safeTransfer(msg.sender, remaining);
      emit TokenDistributed(tokenAddr, msg.sender, remaining);
    }

    token.transferOwnership(msg.sender);
    emit TokenCreated(msg.sender, tokenAddr);
  }
}
