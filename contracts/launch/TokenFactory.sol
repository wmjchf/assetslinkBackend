// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * TokenFactory
 *
 * Deploys SafeLaunchToken instances via `new` (no proxy / no clone).
 * Vesting was removed from this factory — use VestingTimeLock (shared contract) for standalone linear vesting.
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
 * TokenConfig is minimal: name, symbol, totalSupplyRaw.
 * Creation is free (no native-token fees).
 * Distribution rows include optional labels (emitted in TokenDistributed, max 64 bytes each).
 */

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./SafeLaunchToken.sol";

contract TokenFactory {
  using SafeERC20 for IERC20;

  uint256 public constant MAX_DISTRIBUTION_LABEL_BYTES = 64;

  event TokenCreated(address indexed creator, address indexed token);
  event TokenDistributed(address indexed token, address indexed to, uint256 amount, string label);
  event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

  address public owner;

  modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
  }

  constructor() {
    owner = msg.sender;
    emit OwnershipTransferred(address(0), msg.sender);
  }

  function transferOwnership(address newOwner) external onlyOwner {
    require(newOwner != address(0), "owner=0");
    address prev = owner;
    owner = newOwner;
    emit OwnershipTransferred(prev, newOwner);
  }

  // ---------------------------------------------------------------------------
  // Structs
  // ---------------------------------------------------------------------------

  struct TokenConfig {
    string  name;
    string  symbol;
    uint256 totalSupplyRaw;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function _deployToken(
    TokenConfig calldata cfg
  ) private returns (SafeLaunchToken token, address tokenAddr) {
    token = new SafeLaunchToken(
      address(this),
      cfg.name,
      cfg.symbol,
      cfg.totalSupplyRaw
    );
    tokenAddr = address(token);
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

  function _validateDistributionLabels(
    uint256 recipientCount,
    string[] calldata labels
  ) private pure {
    require(labels.length == recipientCount, "labels length");
    for (uint256 i = 0; i < labels.length; i++) {
      require(bytes(labels[i]).length <= MAX_DISTRIBUTION_LABEL_BYTES, "label too long");
    }
  }

  // ---------------------------------------------------------------------------
  // Public entry points
  // ---------------------------------------------------------------------------

  /**
   * Deploy a bare token. All supply goes to msg.sender.
   */
  function createToken(TokenConfig calldata cfg) external returns (address tokenAddr) {
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
   * @param labels one per recipient (same order); use "" when no label; emitted in TokenDistributed.
   */
  function createTokenWithDistribution(
    TokenConfig calldata cfg,
    address[] calldata recipients,
    uint256[] calldata amounts,
    string[] calldata labels
  ) external returns (address tokenAddr) {
    require(cfg.totalSupplyRaw > 0, "supply=0");
    _validateRecipientsAndSum(cfg.totalSupplyRaw, recipients, amounts);
    _validateDistributionLabels(recipients.length, labels);

    SafeLaunchToken token;
    (token, tokenAddr) = _deployToken(cfg);

    for (uint256 i = 0; i < recipients.length; i++) {
      uint256 amt = amounts[i];
      if (amt == 0) continue;
      IERC20(tokenAddr).safeTransfer(recipients[i], amt);
      emit TokenDistributed(tokenAddr, recipients[i], amt, labels[i]);
    }

    uint256 remaining = token.balanceOf(address(this));
    if (remaining > 0) {
      IERC20(tokenAddr).safeTransfer(msg.sender, remaining);
      emit TokenDistributed(tokenAddr, msg.sender, remaining, "");
    }

    token.transferOwnership(msg.sender);
    emit TokenCreated(msg.sender, tokenAddr);
  }
}
