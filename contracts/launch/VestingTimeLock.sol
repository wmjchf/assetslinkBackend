// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * VestingTimeLock
 * Single contract per chain (same product pattern as LPTimeLock): many linear vesting schedules by id.
 *
 * Flow:
 * 1) Approve this contract to spend your ERC20
 * 2) Call createVesting with msg.value >= vestingLockFee
 * 3) Beneficiary calls release(id) repeatedly until fully vested
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract VestingTimeLock is ReentrancyGuard, Ownable {
  using SafeERC20 for IERC20;

  /// @notice Full vesting end must be at least this far in the future at creation (like LP min lock).
  uint256 public constant MIN_VESTING_END_DELAY = 1 days;

  uint256 public vestingLockFee;
  address public feeRecipient;

  struct VestingLock {
    address token;
    address owner;
    address beneficiary;
    uint256 totalAmount;
    uint256 released;
    uint64 start;
    uint64 cliffSeconds;
    uint64 durationSeconds;
    bool exists;
  }

  uint256 public nextId = 1;
  mapping(uint256 => VestingLock) public vestingLocks;

  event VestingLockCreated(
    uint256 indexed id,
    address indexed token,
    address indexed beneficiary,
    uint256 requestedAmount,
    uint256 receivedAmount,
    uint64 start,
    uint64 cliffSeconds,
    uint64 durationSeconds
  );
  event Released(uint256 indexed id, address indexed beneficiary, uint256 amount);
  event VestingDurationExtended(uint256 indexed id, uint64 oldDurationSeconds, uint64 newDurationSeconds);
  event VestingLockOwnershipTransferred(uint256 indexed id, address indexed oldOwner, address indexed newOwner);
  event VestingBeneficiaryUpdated(uint256 indexed id, address indexed oldBeneficiary, address indexed newBeneficiary);
  event VestingLockFeeUpdated(uint256 oldFee, uint256 newFee);
  event FeeRecipientUpdated(address oldRecipient, address newRecipient);

  modifier onlyVestingOwner(uint256 id) {
    require(vestingLocks[id].exists, "vesting not found");
    require(vestingLocks[id].owner == msg.sender, "Not vesting owner");
    _;
  }

  modifier vestingExists(uint256 id) {
    require(vestingLocks[id].exists, "vesting not found");
    _;
  }

  constructor(uint256 _vestingLockFee, address _feeRecipient) Ownable(msg.sender) {
    require(_feeRecipient != address(0), "feeRecipient=0");
    vestingLockFee = _vestingLockFee;
    feeRecipient = _feeRecipient;
  }

  function setVestingLockFee(uint256 newFee) external onlyOwner {
    emit VestingLockFeeUpdated(vestingLockFee, newFee);
    vestingLockFee = newFee;
  }

  function setFeeRecipient(address newRecipient) external onlyOwner {
    require(newRecipient != address(0), "feeRecipient=0");
    emit FeeRecipientUpdated(feeRecipient, newRecipient);
    feeRecipient = newRecipient;
  }

  function _vestedAmount(VestingLock memory l, uint64 timestamp) internal pure returns (uint256) {
    uint64 cliffTime = l.start + l.cliffSeconds;
    if (timestamp < cliffTime) return 0;

    uint64 endTime = l.start + l.durationSeconds;
    if (timestamp >= endTime) return l.totalAmount;

    uint256 linearDuration = uint256(l.durationSeconds - l.cliffSeconds);
    if (linearDuration == 0) return l.totalAmount;
    uint256 elapsedSinceCliff = uint256(timestamp - cliffTime);
    return (l.totalAmount * elapsedSinceCliff) / linearDuration;
  }

  function _releasable(VestingLock memory l) internal view returns (uint256) {
    uint256 vested = _vestedAmount(l, uint64(block.timestamp));
    if (vested <= l.released) return 0;
    return vested - l.released;
  }

  /**
   * @notice Create a vesting schedule and pull ERC20 into this contract.
   * @dev    msg.value must be >= vestingLockFee. Excess native token is refunded.
   */
  function createVesting(
    address token,
    address beneficiary,
    uint64 start,
    uint64 cliffSeconds,
    uint64 durationSeconds,
    uint256 amount
  ) external payable nonReentrant returns (uint256 id) {
    require(msg.value >= vestingLockFee, "insufficient fee");
    require(token != address(0), "token=0");
    require(beneficiary != address(0), "beneficiary=0");
    require(amount > 0, "amount=0");
    require(durationSeconds > 0, "duration=0");
    require(durationSeconds >= cliffSeconds, "duration < cliff");

    uint256 endTime = uint256(start) + uint256(durationSeconds);
    require(endTime >= block.timestamp + MIN_VESTING_END_DELAY, "vesting ends too soon");

    if (vestingLockFee > 0) {
      (bool sent, ) = feeRecipient.call{value: vestingLockFee}("");
      require(sent, "fee transfer failed");
    }

    uint256 excess = msg.value - vestingLockFee;
    if (excess > 0) {
      (bool refunded, ) = msg.sender.call{value: excess}("");
      require(refunded, "refund failed");
    }

    IERC20 t = IERC20(token);
    uint256 beforeBal = t.balanceOf(address(this));
    t.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = t.balanceOf(address(this)) - beforeBal;
    require(received > 0, "received=0");

    id = nextId++;
    vestingLocks[id] = VestingLock({
      token: token,
      owner: msg.sender,
      beneficiary: beneficiary,
      totalAmount: received,
      released: 0,
      start: start,
      cliffSeconds: cliffSeconds,
      durationSeconds: durationSeconds,
      exists: true
    });

    emit VestingLockCreated(id, token, beneficiary, amount, received, start, cliffSeconds, durationSeconds);
  }

  function release(uint256 id) external nonReentrant vestingExists(id) {
    VestingLock storage l = vestingLocks[id];
    require(msg.sender == l.beneficiary, "not beneficiary");
    uint256 amt = _releasable(l);
    require(amt > 0, "nothing to release");
    l.released += amt;
    IERC20(l.token).safeTransfer(l.beneficiary, amt);
    emit Released(id, l.beneficiary, amt);
  }

  function releasable(uint256 id) external view vestingExists(id) returns (uint256) {
    return _releasable(vestingLocks[id]);
  }

  function vestedAmount(uint256 id) external view vestingExists(id) returns (uint256) {
    return _vestedAmount(vestingLocks[id], uint64(block.timestamp));
  }

  /// @notice Owner may lengthen the vesting period (pushes full vest date later; cannot shorten).
  function extendVestingDuration(uint256 id, uint64 newDurationSeconds) external onlyVestingOwner(id) {
    VestingLock storage l = vestingLocks[id];
    require(newDurationSeconds > l.durationSeconds, "must extend");
    require(newDurationSeconds >= l.cliffSeconds, "duration < cliff");
    uint256 old = l.durationSeconds;
    l.durationSeconds = newDurationSeconds;
    emit VestingDurationExtended(id, uint64(old), newDurationSeconds);
  }

  function transferVestingLockOwnership(uint256 id, address newOwner) external onlyVestingOwner(id) {
    require(newOwner != address(0), "newOwner=0");
    VestingLock storage l = vestingLocks[id];
    address old = l.owner;
    l.owner = newOwner;
    emit VestingLockOwnershipTransferred(id, old, newOwner);
  }

  function updateBeneficiary(uint256 id, address newBeneficiary) external onlyVestingOwner(id) {
    require(newBeneficiary != address(0), "newBeneficiary=0");
    VestingLock storage l = vestingLocks[id];
    address old = l.beneficiary;
    l.beneficiary = newBeneficiary;
    emit VestingBeneficiaryUpdated(id, old, newBeneficiary);
  }

  receive() external payable {}
}
