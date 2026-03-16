// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * LinearVestingVault
 * - Holds ERC20 tokens
 * - Releases to beneficiary after a cliff, linearly over `duration`
 *
 * Terms:
 * - start: vesting start timestamp
 * - cliffSeconds: nothing is claimable before start + cliffSeconds
 * - durationSeconds: total time from start to fully vested (must be >= cliffSeconds)
 *   - linear vesting starts after the cliff and lasts (durationSeconds - cliffSeconds)
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract LinearVestingVault {
  IERC20 public immutable token;
  address public immutable beneficiary;
  uint64 public immutable start;
  uint64 public immutable cliffSeconds;
  uint64 public immutable durationSeconds;
  uint256 public immutable totalAllocation;

  uint256 public released;

  event Released(uint256 amount);

  constructor(
    address token_,
    address beneficiary_,
    uint64 start_,
    uint64 cliffSeconds_,
    uint64 durationSeconds_,
    uint256 totalAllocation_
  ) {
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
    return (totalAllocation * elapsedSinceCliff) / linearDuration;
  }

  function releasable() public view returns (uint256) {
    uint256 vested = vestedAmount(uint64(block.timestamp));
    if (vested <= released) return 0;
    return vested - released;
  }

  function release() external {
    require(msg.sender == beneficiary, "not beneficiary");
    uint256 amount = releasable();
    require(amount > 0, "nothing to release");
    released += amount;
    bool ok = token.transfer(beneficiary, amount);
    require(ok, "transfer failed");
    emit Released(amount);
  }
}


