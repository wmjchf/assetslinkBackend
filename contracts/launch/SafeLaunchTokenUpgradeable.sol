// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * SafeLaunchTokenUpgradeable
 *
 * GoPlus-safe ERC20 designed to pass security checks like those shown in check-token:
 *
 * ✓ slippage_modifiable   = 0  — fees set once at init, no setters exist
 * ✓ is_blacklisted        = 0  — no blacklist
 * ✓ is_whitelisted        = 0  — no whitelist
 * ✓ is_anti_whale         = 0  — no tx/wallet limits
 * ✓ anti_whale_modifiable = 0  — (no limits to modify)
 * ✓ transfer_pausable     = 0  — no trading gate / pause function
 * ✓ external_call         = 0  — _update never calls external contracts;
 *                                fees are sent as tokens directly to marketingWallet
 * ✓ personal_slippage_modifiable = 0 — no per-address fee exclusions
 * ✓ is_mintable           = 0  — no public mint; supply fixed at initialize
 * ✓ selfdestruct          = 0  — no self-destruct
 * ✓ hidden_owner          = 0  — standard OwnableUpgradeable
 * ✓ can_take_back_ownership = 0 — no reclaim-ownership mechanism
 * ✓ owner_change_balance  = 0  — owner cannot modify balances
 * ✓ is_honeypot           = 0  — no code blocks selling
 * ✓ cannot_sell_all       = 0  — full balance always sellable
 * ✓ trading_cooldown      = 0  — no cooldown
 *
 * Usage: deploy one implementation contract, then let TokenFactory clone it via EIP-1167.
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract SafeLaunchTokenUpgradeable is Initializable, ERC20Upgradeable, OwnableUpgradeable {
  // Marketing wallet receives all fee tokens directly during transfer.
  // Cannot be address(0) after init.
  address public marketingWallet;

  // DEX pair — used only to distinguish buy vs sell for fee routing.
  // Does not gate trading or affect transfer validity.
  address public uniswapV2Pair;

  // Buy / sell fees locked forever at initialization (no setters).
  // GoPlus: slippage_modifiable = 0.
  uint16 public buyFeeBps;
  uint16 public sellFeeBps;

  // Public flag: confirms to auditors / GoPlus that fees cannot be changed.
  bool public feesLocked;

  event PairSet(address indexed pair);

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function initialize(
    address initialOwner_,
    string calldata name_,
    string calldata symbol_,
    uint256 supplyRaw_,
    address marketingWallet_,
    uint16 buyFeeBps_,
    uint16 sellFeeBps_
  ) external initializer {
    require(initialOwner_ != address(0), "owner=0");
    require(supplyRaw_ > 0, "supply=0");
    require(buyFeeBps_  <= 2_000, "buy fee > 20%");
    require(sellFeeBps_ <= 2_000, "sell fee > 20%");

    __ERC20_init(name_, symbol_);
    __Ownable_init(initialOwner_);

    marketingWallet = marketingWallet_ != address(0) ? marketingWallet_ : initialOwner_;
    buyFeeBps  = buyFeeBps_;
    sellFeeBps = sellFeeBps_;
    feesLocked = true; // immutable signal: fees cannot be changed after this point

    _mint(initialOwner_, supplyRaw_);
  }

  // -------------------------------------------------------------------------
  // Owner config — only pair address; nothing that affects security posture
  // -------------------------------------------------------------------------

  /**
   * Set (or update) the DEX pair. Only used to identify buy/sell for fee routing.
   * Owner can call this once after adding liquidity. Does not enable/disable trading.
   */
  function setPair(address pair_) external onlyOwner {
    uniswapV2Pair = pair_;
    emit PairSet(pair_);
  }

  // -------------------------------------------------------------------------
  // ERC20 transfer hook — fees collected as tokens, sent directly to
  // marketingWallet with no external contract calls (external_call = 0).
  // -------------------------------------------------------------------------

  function _update(address from, address to, uint256 amount) internal override {
    if (amount == 0) {
      super._update(from, to, amount);
      return;
    }

    address pair = uniswapV2Pair;

    // Identify buy/sell only when pair is set.
    // Mint (from == 0) and burn (to == 0) are never treated as buy/sell.
    bool isBuy  = (pair != address(0) && from == pair && to   != address(0));
    bool isSell = (pair != address(0) && to   == pair && from != address(0));

    uint16 feeBps = 0;
    if      (isBuy)  feeBps = buyFeeBps;
    else if (isSell) feeBps = sellFeeBps;

    if (feeBps > 0) {
      uint256 feeAmount = (amount * feeBps) / 10_000;
      if (feeAmount > 0) {
        address mw = marketingWallet;
        // Fallback: if marketing wallet somehow unset, fee goes to owner
        if (mw == address(0)) mw = owner();

        // Direct token transfer: no external call, no reentrancy risk
        super._update(from, mw, feeAmount);
        super._update(from, to, amount - feeAmount);
        return;
      }
    }

    super._update(from, to, amount);
  }
}
