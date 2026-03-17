// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * LPTimeLock
 * A simple time-lock vault for ERC20 tokens (e.g. UniswapV2 LP tokens).
 *
 * Typical flow:
 * 1) Add liquidity -> receive LP tokens to your wallet
 * 2) Approve LPTimeLock to spend LP tokens
 * 3) Create lock with unlockTime (timestamp)
 * 4) Anyone can verify the lock on-chain; only beneficiary can withdraw after unlock.
 */

interface IERC20Lock {
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
}

contract LPTimeLock {
  struct Lock {
    address token;        // LP token address (ERC20)
    address owner;        // creator (can extend / transfer ownership)
    address beneficiary;  // receiver after unlock
    uint256 amount;       // locked amount
    uint256 unlockTime;   // unix timestamp
    bool withdrawn;       // state
  }

  uint256 public nextId = 1;
  mapping(uint256 => Lock) public locks;

  event LockCreated(
    uint256 indexed id,
    address indexed token,
    address indexed beneficiary,
    uint256 amount,
    uint256 unlockTime
  );
  event LockExtended(uint256 indexed id, uint256 oldUnlockTime, uint256 newUnlockTime);
  event LockOwnershipTransferred(uint256 indexed id, address indexed oldOwner, address indexed newOwner);
  event LockBeneficiaryUpdated(uint256 indexed id, address indexed oldBeneficiary, address indexed newBeneficiary);
  event Withdrawn(uint256 indexed id, address indexed beneficiary, uint256 amount);

  modifier onlyLockOwner(uint256 id) {
    require(locks[id].owner == msg.sender, "Not lock owner");
    _;
  }

  function createLock(
    address token,
    address beneficiary,
    uint256 amount,
    uint256 unlockTime
  ) external returns (uint256 id) {
    require(token != address(0), "token=0");
    require(beneficiary != address(0), "beneficiary=0");
    require(amount > 0, "amount=0");
    require(unlockTime > block.timestamp, "unlockTime must be future");

    id = nextId++;
    locks[id] = Lock({
      token: token,
      owner: msg.sender,
      beneficiary: beneficiary,
      amount: amount,
      unlockTime: unlockTime,
      withdrawn: false
    });

    bool ok = IERC20Lock(token).transferFrom(msg.sender, address(this), amount);
    require(ok, "transferFrom failed");

    emit LockCreated(id, token, beneficiary, amount, unlockTime);
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

  function withdraw(uint256 id) external {
    Lock storage l = locks[id];
    require(!l.withdrawn, "already withdrawn");
    require(msg.sender == l.beneficiary, "not beneficiary");
    require(block.timestamp >= l.unlockTime, "still locked");

    l.withdrawn = true;
    bool ok = IERC20Lock(l.token).transfer(l.beneficiary, l.amount);
    require(ok, "transfer failed");
    emit Withdrawn(id, l.beneficiary, l.amount);
  }

  function getLockStatus(uint256 id) external view returns (bool isLocked, uint256 remainingSeconds) {
    Lock memory l = locks[id];
    if (l.withdrawn) return (false, 0);
    if (block.timestamp >= l.unlockTime) return (false, 0);
    return (true, l.unlockTime - block.timestamp);
  }
}


