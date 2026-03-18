// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SafeLaunchToken is ERC20, Ownable {
  constructor(
    address initialOwner_,
    string memory name_,
    string memory symbol_,
    uint256 supplyRaw_
  ) ERC20(name_, symbol_) Ownable(initialOwner_) {
    require(supplyRaw_ > 0, "supply=0");
    _mint(initialOwner_, supplyRaw_);
  }
}
