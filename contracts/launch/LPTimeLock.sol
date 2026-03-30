// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * LPTimeLock
 * A simple time-lock vault for ERC20 tokens (e.g. UniswapV2 LP tokens).
 *
 * Typical flow:
 * 1) Add liquidity -> receive LP tokens to your wallet
 * 2) Approve LPTimeLock to spend LP tokens
 * 3) Call createLock with msg.value >= lockFee
 * 4) Anyone can verify the lock on-chain; only beneficiary can withdraw after unlock.
 */

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract LPTimeLock is ReentrancyGuard, Ownable {
  using SafeERC20 for IERC20;

  uint256 public constant MIN_LOCK_DURATION = 1 days;

  // ─── Fee ──────────────────────────────────────────────────────────────────
  uint256 public lockFee;         // native token fee per lock (wei), 0 = free
  address public feeRecipient;    // address that receives the fee

  struct Lock {
    address token;        // LP token address (ERC20)
    address owner;        // creator (can extend / transfer ownership)
    address beneficiary;  // receiver after unlock
    uint256 amount;       // locked amount
    uint256 unlockTime;   // unix timestamp
    bool exists;          // lock record exists
    bool withdrawn;       // state
  }

  uint256 public nextId = 1;
  mapping(uint256 => Lock) public locks;

  // ─── Events ───────────────────────────────────────────────────────────────
  event LockCreated(
    uint256 indexed id,
    address indexed token,
    address indexed beneficiary,
    uint256 requestedAmount,
    uint256 receivedAmount,
    uint256 unlockTime
  );
  event LockExtended(uint256 indexed id, uint256 oldUnlockTime, uint256 newUnlockTime);
  event LockOwnershipTransferred(uint256 indexed id, address indexed oldOwner, address indexed newOwner);
  event LockBeneficiaryUpdated(uint256 indexed id, address indexed oldBeneficiary, address indexed newBeneficiary);
  event Withdrawn(uint256 indexed id, address indexed beneficiary, uint256 amount);
  event LockFeeUpdated(uint256 oldFee, uint256 newFee);
  event FeeRecipientUpdated(address oldRecipient, address newRecipient);

  modifier onlyLockOwner(uint256 id) {
    require(locks[id].exists, "lock not found");
    require(locks[id].owner == msg.sender, "Not lock owner");
    _;
  }

  modifier lockExists(uint256 id) {
    require(locks[id].exists, "lock not found");
    _;
  }

  constructor(uint256 _lockFee, address _feeRecipient) Ownable(msg.sender) {
    require(_feeRecipient != address(0), "feeRecipient=0");
    lockFee = _lockFee;
    feeRecipient = _feeRecipient;
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  function setLockFee(uint256 newFee) external onlyOwner {
    emit LockFeeUpdated(lockFee, newFee);
    lockFee = newFee;
  }

  function setFeeRecipient(address newRecipient) external onlyOwner {
    require(newRecipient != address(0), "feeRecipient=0");
    emit FeeRecipientUpdated(feeRecipient, newRecipient);
    feeRecipient = newRecipient;
  }

  // ─── Core ─────────────────────────────────────────────────────────────────

  /**
   * @notice Create a new LP lock.
   * @dev    msg.value must be >= lockFee. Any excess is refunded.
   */
  function createLock(
    address token,
    address beneficiary,
    uint256 amount,
    uint256 unlockTime
  ) external payable nonReentrant returns (uint256 id) {
    require(msg.value >= lockFee, "insufficient fee");
    require(token != address(0), "token=0");
    require(beneficiary != address(0), "beneficiary=0");
    require(amount > 0, "amount=0");
    require(unlockTime >= block.timestamp + MIN_LOCK_DURATION, "lock duration too short");

    // Forward fee to recipient
    if (lockFee > 0) {
      (bool sent, ) = feeRecipient.call{value: lockFee}("");
      require(sent, "fee transfer failed");
    }

    // Refund excess native token
    uint256 excess = msg.value - lockFee;
    if (excess > 0) {
      (bool refunded, ) = msg.sender.call{value: excess}("");
      require(refunded, "refund failed");
    }

    IERC20 tokenContract = IERC20(token);
    uint256 beforeBal = tokenContract.balanceOf(address(this));
    tokenContract.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = tokenContract.balanceOf(address(this)) - beforeBal;
    require(received > 0, "received=0");

    id = nextId++;
    locks[id] = Lock({
      token: token,
      owner: msg.sender,
      beneficiary: beneficiary,
      amount: received,
      unlockTime: unlockTime,
      exists: true,
      withdrawn: false
    });

    emit LockCreated(id, token, beneficiary, amount, received, unlockTime);
  }

  function extendLock(uint256 id, uint256 newUnlockTime) external onlyLockOwner(id) {
    Lock storage l = locks[id];
    require(!l.withdrawn, "already withdrawn");
    require(newUnlockTime > l.unlockTime, "must extend");
    uint256 old = l.unlockTime;
    l.unlockTime = newUnlockTime;
    emit LockExtended(id, old, newUnlockTime);
  }

  function transferLockOwnership(uint256 id, address newOwner) external onlyLockOwner(id) {
    require(newOwner != address(0), "newOwner=0");
    Lock storage l = locks[id];
    require(!l.withdrawn, "already withdrawn");
    address old = l.owner;
    l.owner = newOwner;
    emit LockOwnershipTransferred(id, old, newOwner);
  }

  function updateBeneficiary(uint256 id, address newBeneficiary) external onlyLockOwner(id) {
    require(newBeneficiary != address(0), "newBeneficiary=0");
    Lock storage l = locks[id];
    require(!l.withdrawn, "already withdrawn");
    address old = l.beneficiary;
    l.beneficiary = newBeneficiary;
    emit LockBeneficiaryUpdated(id, old, newBeneficiary);
  }

  function withdraw(uint256 id) external nonReentrant lockExists(id) {
    Lock storage l = locks[id];
    require(!l.withdrawn, "already withdrawn");
    require(msg.sender == l.beneficiary, "not beneficiary");
    require(block.timestamp >= l.unlockTime, "still locked");

    l.withdrawn = true;
    IERC20(l.token).safeTransfer(l.beneficiary, l.amount);
    emit Withdrawn(id, l.beneficiary, l.amount);
  }

  function getLockStatus(uint256 id) external view lockExists(id) returns (bool isLocked, uint256 remainingSeconds) {
    Lock memory l = locks[id];
    if (l.withdrawn) return (false, 0);
    if (block.timestamp >= l.unlockTime) return (false, 0);
    return (true, l.unlockTime - block.timestamp);
  }
}
