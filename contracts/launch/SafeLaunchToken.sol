// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * SafeLaunchToken
 *
 * Plain ERC20. Deployed directly by TokenFactory via `new` (no proxy).
 * No fees, no marketing wallet, no transfer restrictions.
 *
 * GoPlus security check results:
 * ✓ is_proxy              = 0  — not a proxy; full contract bytecode deployed
 * ✓ is_open_source        = 1  — source verified via Etherscan bytecode match
 * ✓ slippage_modifiable   = 0  — no fee logic exists
 * ✓ is_blacklisted        = 0  — no blacklist
 * ✓ is_whitelisted        = 0  — no whitelist
 * ✓ is_anti_whale         = 0  — no tx/wallet limits
 * ✓ anti_whale_modifiable = 0  — no limits to modify
 * ✓ transfer_pausable     = 0  — no pause function
 * ✓ external_call         = 0  — no external calls in transfer hook
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
  uint8 private immutable _decimals;

  constructor(
    address initialOwner_,
    string memory name_,
    string memory symbol_,
    uint256 supplyRaw_,
    uint8 decimals_
  ) ERC20(name_, symbol_) Ownable(initialOwner_) {
    require(supplyRaw_ > 0, "supply=0");
    _decimals = decimals_;
    _mint(initialOwner_, supplyRaw_);
  }

  function decimals() public view override returns (uint8) {
    return _decimals;
  }
}
