// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * LinearVestingVaultUpgradeable (clone-friendly)
 * - Holds ERC20 tokens
 * - Releases to beneficiary after a cliff, then linearly until fully vested at `start + duration`
 * - Uses initializer instead of constructor (for EIP-1167 clones)
 */

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LinearVestingVaultUpgradeable is Initializable {
  IERC20 public token;
  address public beneficiary;
  uint64 public start;
  uint64 public cliffSeconds;
  uint64 public durationSeconds;
  uint256 public totalAllocation;

  uint256 public released;

  event Released(uint256 amount, uint256 totalReleased, uint256 remaining);

  function initialize(
    address token_,
    address beneficiary_,
    uint64 start_,
    uint64 cliffSeconds_,
    uint64 durationSeconds_,
    uint256 totalAllocation_
  ) external initializer {
    require(token_ != address(0), "token=0");
    require(beneficiary_ != address(0), "beneficiary=0");
    require(durationSeconds_ > 0, "duration=0");
    require(durationSeconds_ >= cliffSeconds_, "duration < cliff");
    require(totalAllocation_ > 0, "allocation=0");

    token = IERC20(token_);
    beneficiary = beneficiary_;
    start = start_;
    cliffSeconds = cliffSeconds_;
    durationSeconds = durationSeconds_;
    totalAllocation = totalAllocation_;
  }

  function vestedAmount(uint64 timestamp) public view returns (uint256) {
    uint64 cliffTime = start + cliffSeconds;
    if (timestamp < cliffTime) return 0;

    uint64 endTime = start + durationSeconds;
    if (timestamp >= endTime) return totalAllocation;

    // Flow #1: linear vesting starts AFTER the cliff, so the vested amount at cliffTime is 0 (no jump).
    uint256 linearDuration = uint256(durationSeconds - cliffSeconds);
    if (linearDuration == 0) return totalAllocation;
    uint256 elapsedSinceCliff = uint256(timestamp - cliffTime);
    
    // Calculate vested amount
    uint256 vested = (totalAllocation * elapsedSinceCliff) / linearDuration;
    
    // If we're very close to the end, return totalAllocation to avoid precision loss
    // This ensures all tokens can be released eventually
    if (elapsedSinceCliff + 1 >= linearDuration) {
      return totalAllocation;
    }
    
    return vested;
  }

  function releasable() public view returns (uint256) {
    // block.timestamp is uint256, but vestedAmount accepts uint64
    // In practice, uint64 is sufficient until year 2106
    require(block.timestamp <= type(uint64).max, "timestamp overflow");
    uint256 vested = vestedAmount(uint64(block.timestamp));
    if (vested <= released) return 0;
    return vested - released;
  }

  function release() external {
    require(msg.sender == beneficiary, "not beneficiary");
    uint256 amount = releasable();
    require(amount > 0, "nothing to release");
    
    // Safety check: ensure released won't exceed totalAllocation
    require(released + amount <= totalAllocation, "release exceeds allocation");
    
    // Check contract balance
    uint256 balance = token.balanceOf(address(this));
    require(balance >= amount, "insufficient contract balance");
    
    released += amount;
    bool ok = token.transfer(beneficiary, amount);
    require(ok, "transfer failed");
    
    uint256 remaining = totalAllocation - released;
    emit Released(amount, released, remaining);
  }
  
  // Emergency withdraw: allows beneficiary to withdraw all remaining tokens
  // Should only be used in extreme cases (e.g., token contract issues)
  function emergencyWithdraw() external {
    require(msg.sender == beneficiary, "not beneficiary");
    uint256 balance = token.balanceOf(address(this));
    require(balance > 0, "no balance");
    
    // Mark as fully released to prevent further releases
    released = totalAllocation;
    
    bool ok = token.transfer(beneficiary, balance);
    require(ok, "transfer failed");
    emit Released(balance, released, 0);
  }
  
  // --- View functions ---
  
  function totalReleased() public view returns (uint256) {
    return released;
  }
  
  function remaining() public view returns (uint256) {
    return totalAllocation - released;
  }
  
  function isFullyVested() public view returns (bool) {
    require(block.timestamp <= type(uint64).max, "timestamp overflow");
    return uint64(block.timestamp) >= start + durationSeconds;
  }
  
  function vestingEndTime() public view returns (uint64) {
    return start + durationSeconds;
  }
  
  function cliffEndTime() public view returns (uint64) {
    return start + cliffSeconds;
  }
}


