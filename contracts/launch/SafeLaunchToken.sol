// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * SafeLaunchToken
 *
 * Non-upgradeable ERC20. Deployed directly by TokenFactory via `new` (no proxy).
 * Because every token is a standalone contract (not an EIP-1167 clone), Etherscan
 * matches its bytecode to this verified source and marks it as verified automatically.
 *
 * GoPlus security check results:
 * ✓ is_proxy              = 0  — not a proxy; full contract bytecode deployed
 * ✓ is_open_source        = 1  — source verified via Etherscan bytecode match
 * ✓ slippage_modifiable   = 0  — fees locked at construction, no setters
 * ✓ is_blacklisted        = 0  — no blacklist
 * ✓ is_whitelisted        = 0  — no whitelist
 * ✓ is_anti_whale         = 0  — no tx/wallet limits
 * ✓ anti_whale_modifiable = 0  — (nothing to modify)
 * ✓ transfer_pausable     = 0  — no trading gate or pause function
 * ✓ external_call         = 0  — _update never calls external contracts;
 *                                fees are sent as tokens directly to marketingWallet
 * ✓ personal_slippage_modifiable = 0 — no per-address fee exemptions
 * ✓ is_mintable           = 0  — no public mint; supply fixed at construction
 * ✓ selfdestruct          = 0  — no self-destruct
 * ✓ hidden_owner          = 0  — standard Ownable
 * ✓ can_take_back_ownership = 0 — no reclaim mechanism
 * ✓ owner_change_balance  = 0  — owner cannot modify balances
 * ✓ is_honeypot           = 0  — no code blocks selling
 * ✓ cannot_sell_all       = 0  — full balance always sellable
 * ✓ trading_cooldown      = 0  — no cooldown
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SafeLaunchToken is ERC20, Ownable {
  // Marketing wallet receives all fee tokens directly during transfer.
  address public marketingWallet;

  // DEX pair — used only to distinguish buy vs sell for fee routing.
  // Setting this does not gate trading or affect transfer validity.
  address public uniswapV2Pair;

  // Fees stored in regular slots (not immutable) so that all deployed instances
  // share the same deployed bytecode → Etherscan auto-verifies via bytecode match.
  uint16 public buyFeeBps;
  uint16 public sellFeeBps;

  // Public flag: confirms fees cannot be changed (no setter exists).
  bool public constant feesLocked = true;

  event PairSet(address indexed pair);

  constructor(
    address initialOwner_,
    string memory name_,
    string memory symbol_,
    uint256 supplyRaw_,
    address marketingWallet_,
    uint16 buyFeeBps_,
    uint16 sellFeeBps_
  ) ERC20(name_, symbol_) Ownable(initialOwner_) {
    require(supplyRaw_ > 0,        "supply=0");
    require(buyFeeBps_  <= 2_000,  "buy fee > 20%");
    require(sellFeeBps_ <= 2_000,  "sell fee > 20%");

    marketingWallet = marketingWallet_ != address(0) ? marketingWallet_ : initialOwner_;
    buyFeeBps  = buyFeeBps_;
    sellFeeBps = sellFeeBps_;

    _mint(initialOwner_, supplyRaw_);
  }

  // -------------------------------------------------------------------------
  // Owner config — only the pair address; does not affect security posture
  // -------------------------------------------------------------------------

  /**
   * Set (or update) the DEX pair. Used only to identify buy/sell direction for
   * fee routing. Does not enable or disable trading.
   */
  function setPair(address pair_) external onlyOwner {
    uniswapV2Pair = pair_;
    emit PairSet(pair_);
  }

  // -------------------------------------------------------------------------
  // ERC20 transfer hook — fees go directly to marketingWallet as tokens.
  // No external contract calls (external_call = 0).
  // -------------------------------------------------------------------------

  function _update(address from, address to, uint256 amount) internal override {
    if (amount == 0) {
      super._update(from, to, amount);
      return;
    }

    address pair = uniswapV2Pair;

    // Identify buy/sell only when pair is configured.
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
        if (mw == address(0)) mw = owner();
        // Direct token transfer: no external call, no reentrancy
        super._update(from, mw, feeAmount);
        super._update(from, to, amount - feeAmount);
        return;
      }
    }

    super._update(from, to, amount);
  }
}
