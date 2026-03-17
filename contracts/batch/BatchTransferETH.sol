// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BatchTransferETH
 * @notice Batch send native token (ETH/BNB/...) or ERC20 tokens to multiple addresses.
 *         Fee is charged in native token (ETH/BNB): perAddressFee per successful transfer.
 *         No referral or commission mechanism.
 */
contract BatchTransferETH is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Structs ────────────────────────────────────────────────────────────────

    struct Transfer {
        address to;
        uint256 amount;
    }

    struct TransferResult {
        address to;
        uint256 amount;
        bool success;
        string failureReason;
    }

    // ─── State ──────────────────────────────────────────────────────────────────

    address public feeCollector;

    /// @notice Fee per address in wei (native token).
    uint256 public perAddressFee;

    /// @notice Max transfers per batch (native / ERC20).
    uint256 public maxNativeBatchSize;
    uint256 public maxErc20BatchSize;

    /// @notice Pending native-token refunds for failed transfers / excess fee.
    mapping(address => uint256) public pendingWithdrawals;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event BatchNativeTransfer(
        address indexed sender,
        uint256 successCount,
        uint256 failureCount,
        uint256 refundAmount
    );
    event BatchTokenTransfer(
        address indexed sender,
        address indexed token,
        uint256 successCount,
        uint256 failureCount
    );
    event TransferDetail(
        address indexed sender,
        uint256 indexed batchIndex,
        address to,
        uint256 amount,
        bool success,
        string failureReason
    );
    event WithdrawalSuccess(address indexed user, uint256 amount);
    event BalanceAdded(address indexed user, uint256 amount, string reason);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event FeeConfigUpdated(uint256 perAddressFee);
    event MaxNativeBatchSizeUpdated(uint256 oldSize, uint256 newSize);
    event MaxErc20BatchSizeUpdated(uint256 oldSize, uint256 newSize);

    // ─── Constructor ────────────────────────────────────────────────────────────

    constructor(address _feeCollector) Ownable(msg.sender) ReentrancyGuard() {
        require(_feeCollector != address(0), "Invalid fee collector");
        feeCollector = _feeCollector;
        maxNativeBatchSize = 400;
        maxErc20BatchSize = 200;
    }

    // ─── View helpers ────────────────────────────────────────────────────────────

    /// @notice Returns the fee in wei for a given number of recipients.
    function calculateFee(uint256 addressCount) public view returns (uint256) {
        return perAddressFee * addressCount;
    }

    function getFeeConfig() external view returns (uint256) {
        return perAddressFee;
    }

    function getPendingWithdrawal(address user) external view returns (uint256) {
        return pendingWithdrawals[user];
    }

    function getMaxNativeBatchSize() external view returns (uint256) {
        return maxNativeBatchSize;
    }

    function getMaxErc20BatchSize() external view returns (uint256) {
        return maxErc20BatchSize;
    }

    // ─── Core: batch native transfer ─────────────────────────────────────────────

    function _doSingleNativeTransfer(
        address to,
        uint256 amount
    ) internal returns (bool ok, string memory reason) {
        (bool success, bytes memory errData) = to.call{ value: amount }("");
        if (success) return (true, "");
        reason = errData.length >= 68 ? _extractRevertReason(errData) : "Transfer failed";
        return (false, reason);
    }

    /**
     * @notice Batch send native token to multiple addresses.
     *         msg.value MUST equal totalAmount + fee (fee = perAddressFee × addressCount, excess refunded).
     *         Fee is paid in native token from msg.value.
     */
    function batchTransferNative(
        Transfer[] calldata transfers
    ) external payable returns (TransferResult[] memory results) {
        uint256 count = transfers.length;
        require(count > 0, "Empty transfers");
        require(count <= maxNativeBatchSize, "Batch too large");

        uint256 totalAmount;
        for (uint256 i; i < count; ++i) {
            totalAmount += transfers[i].amount;
        }
        uint256 maxFee = perAddressFee * count;
        require(msg.value >= totalAmount + maxFee, "Insufficient value (amount + fee)");

        results = new TransferResult[](count);
        uint256 successCount;
        uint256 refundAmount;

        for (uint256 i; i < count; ++i) {
            (bool ok, string memory reason) = _doSingleNativeTransfer(
                transfers[i].to, transfers[i].amount
            );
            if (!ok) {
                refundAmount += transfers[i].amount;
            } else {
                ++successCount;
            }
            results[i] = TransferResult(transfers[i].to, transfers[i].amount, ok, reason);
            emit TransferDetail(msg.sender, i, transfers[i].to, transfers[i].amount, ok, reason);
        }

        uint256 failureCount = count - successCount;
        uint256 actualFee = perAddressFee * successCount;
        uint256 surplus = msg.value - totalAmount;
        uint256 refundTotal = refundAmount + (surplus - actualFee);
        if (refundTotal > 0) {
            pendingWithdrawals[msg.sender] += refundTotal;
            emit BalanceAdded(msg.sender, refundTotal, "refund");
        }
        if (actualFee > 0) {
            (bool sent, ) = feeCollector.call{value: actualFee}("");
            require(sent, "Fee transfer failed");
        }

        emit BatchNativeTransfer(msg.sender, successCount, failureCount, refundAmount);
    }

    // ─── Core: batch ERC20 transfer ──────────────────────────────────────────────

    function _requireSufficientAllowance(
        address token,
        uint256 totalAmount,
        uint256 /* count */
    ) internal view {
        require(
            IERC20(token).allowance(msg.sender, address(this)) >= totalAmount,
            "Insufficient token allowance"
        );
    }

    /**
     * @notice Batch send ERC20 tokens to multiple addresses.
     *         Caller must pre-approve the transfer token.
     *         msg.value MUST cover fee (perAddressFee × addressCount), excess refunded.
     */
    function _doSingleTokenTransfer(
        address token,
        address to,
        uint256 amount
    ) internal returns (bool ok, string memory reason) {
        try IERC20(token).transferFrom(msg.sender, to, amount) {
            return (true, "");
        } catch Error(string memory r) {
            return (false, r);
        } catch {
            return (false, "Unknown error");
        }
    }

    function batchTransferToken(
        address token,
        Transfer[] calldata transfers
    ) external payable returns (TransferResult[] memory results) {
        uint256 count = transfers.length;
        require(count > 0, "Empty transfers");
        require(count <= maxErc20BatchSize, "Batch too large");

        uint256 totalAmount;
        for (uint256 i; i < count; ++i) {
            totalAmount += transfers[i].amount;
        }
        _requireSufficientAllowance(token, totalAmount, count);

        uint256 maxFee = perAddressFee * count;
        require(msg.value >= maxFee, "Insufficient native for fee");

        results = new TransferResult[](count);
        uint256 successCount;
        uint256 failureCount;

        for (uint256 i; i < count; ++i) {
            (bool ok, string memory reason) = _doSingleTokenTransfer(
                token, transfers[i].to, transfers[i].amount
            );
            if (ok) ++successCount; else ++failureCount;

            results[i] = TransferResult(transfers[i].to, transfers[i].amount, ok, reason);
            emit TransferDetail(msg.sender, i, transfers[i].to, transfers[i].amount, ok, reason);
        }

        emit BatchTokenTransfer(msg.sender, token, successCount, failureCount);

        uint256 actualFee = perAddressFee * successCount;
        if (actualFee > 0) {
            (bool sent, ) = feeCollector.call{value: actualFee}("");
            require(sent, "Fee transfer failed");
        }
        uint256 refundFee = msg.value - actualFee;
        if (refundFee > 0) {
            pendingWithdrawals[msg.sender] += refundFee;
            emit BalanceAdded(msg.sender, refundFee, "fee_refund");
        }
    }

    // ─── Withdraw failed-transfer refunds ────────────────────────────────────────

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
        emit WithdrawalSuccess(msg.sender, amount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "Invalid address");
        emit FeeCollectorUpdated(feeCollector, _feeCollector);
        feeCollector = _feeCollector;
    }

    function setFeeConfig(uint256 _perAddressFee) external onlyOwner {
        perAddressFee = _perAddressFee;
        emit FeeConfigUpdated(_perAddressFee);
    }

    function setMaxNativeBatchSize(uint256 _maxNativeBatchSize) external onlyOwner {
        require(_maxNativeBatchSize > 0, "Invalid size");
        emit MaxNativeBatchSizeUpdated(maxNativeBatchSize, _maxNativeBatchSize);
        maxNativeBatchSize = _maxNativeBatchSize;
    }

    function setMaxErc20BatchSize(uint256 _maxErc20BatchSize) external onlyOwner {
        require(_maxErc20BatchSize > 0, "Invalid size");
        emit MaxErc20BatchSizeUpdated(maxErc20BatchSize, _maxErc20BatchSize);
        maxErc20BatchSize = _maxErc20BatchSize;
    }

    // ─── Internal ────────────────────────────────────────────────────────────────

    function _extractRevertReason(bytes memory data) internal pure returns (string memory) {
        if (data.length < 68) return "Unknown revert";
        assembly {
            data := add(data, 0x04)
        }
        return abi.decode(data, (string));
    }

    receive() external payable {}
}
