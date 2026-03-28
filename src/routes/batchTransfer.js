import express from "express";
import { ensureDb } from "../db/init.js";
import { BatchTransferRecord } from "../db/models/BatchTransferRecord.js";

const router = express.Router();

function verifyAuth(req) {
  const secret = process.env.BACKEND_INTERNAL_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${secret}`;
}

function isAddress(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/i.test(s);
}

function isTxHash(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{64}$/i.test(s);
}

function normAddr(s) {
  return s.toLowerCase();
}

/**
 * POST /api/batch-transfer/record
 * Called by Next.js proxy after a successful on-chain batch transfer.
 * Optional: Authorization: Bearer <BACKEND_INTERNAL_SECRET>
 */
router.post("/api/batch-transfer/record", async (req, res) => {
  if (!verifyAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const b = req.body;
  if (!b || typeof b !== "object") {
    res.status(400).json({ error: "Expected JSON object" });
    return;
  }

  if (b.kind != null && b.kind !== "batch_transfer") {
    res.status(400).json({ error: "Unsupported kind" });
    return;
  }

  const chainId = b.chainId;
  if (typeof chainId !== "number" || !Number.isInteger(chainId) || chainId <= 0) {
    res.status(400).json({ error: "Invalid chainId" });
    return;
  }

  if (!isTxHash(b.txHash)) {
    res.status(400).json({ error: "Invalid txHash" });
    return;
  }
  const txHash = normAddr(String(b.txHash));

  if (!isAddress(b.from)) {
    res.status(400).json({ error: "Invalid from address" });
    return;
  }

  if (!isAddress(b.batchContract)) {
    res.status(400).json({ error: "Invalid batchContract" });
    return;
  }

  const tokenType = b.tokenType;
  if (tokenType !== "native" && tokenType !== "erc20") {
    res.status(400).json({ error: "Invalid tokenType" });
    return;
  }

  let tokenAddress = null;
  if (tokenType === "erc20") {
    if (b.tokenAddress == null || !isAddress(b.tokenAddress)) {
      res.status(400).json({ error: "Invalid tokenAddress for erc20" });
      return;
    }
    tokenAddress = normAddr(b.tokenAddress);
  }

  const decimals = b.decimals;
  const decNum =
    typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
      ? decimals
      : 18;

  const { recipientCount, successCount, failedCount } = b;
  if (
    typeof recipientCount !== "number" ||
    !Number.isInteger(recipientCount) ||
    recipientCount < 0 ||
    typeof successCount !== "number" ||
    !Number.isInteger(successCount) ||
    successCount < 0 ||
    typeof failedCount !== "number" ||
    !Number.isInteger(failedCount) ||
    failedCount < 0
  ) {
    res.status(400).json({ error: "Invalid counts" });
    return;
  }

  const feeWei = b.feeWei;
  if (typeof feeWei !== "string" || !/^[0-9]+$/.test(feeWei)) {
    res.status(400).json({ error: "Invalid feeWei" });
    return;
  }

  const transfers = b.transfers;
  if (!Array.isArray(transfers)) {
    res.status(400).json({ error: "transfers must be an array" });
    return;
  }

  let failedBatchIndicesJson = null;
  if (b.failedBatchIndices != null) {
    if (!Array.isArray(b.failedBatchIndices)) {
      res.status(400).json({ error: "failedBatchIndices must be an array" });
      return;
    }
    failedBatchIndicesJson = JSON.stringify(b.failedBatchIndices);
  }

  let blockNumber = null;
  if (b.blockNumber != null) {
    if (typeof b.blockNumber !== "string" && typeof b.blockNumber !== "number") {
      res.status(400).json({ error: "Invalid blockNumber" });
      return;
    }
    blockNumber = String(b.blockNumber);
  }

  const transfersJson = JSON.stringify(transfers);

  try {
    await ensureDb();
    const [row, created] = await BatchTransferRecord.findOrCreate({
      where: { chainId, txHash },
      defaults: {
        fromAddress: normAddr(b.from),
        batchContract: normAddr(b.batchContract),
        tokenType,
        tokenAddress,
        decimals: decNum,
        recipientCount,
        successCount,
        failedCount,
        failedBatchIndicesJson,
        blockNumber,
        feeWei,
        transfersJson,
      },
    });

    if (!created) {
      res.status(200).json({ ok: true, id: row.id, duplicate: true });
      return;
    }

    res.status(201).json({ ok: true, id: row.id });
  } catch (e) {
    console.error("[batch-transfer/record]", e);
    res.status(500).json({ error: e?.message || "Database error" });
  }
});

/**
 * GET /api/batch-transfer/records?address=0x...&chainId=56
 * Public read for profile / history (same pattern as my-token, my-locks).
 */
router.get("/api/batch-transfer/records", async (req, res) => {
  const addressRaw = String(req.query.address || "").trim();
  if (!isAddress(addressRaw)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  const address = normAddr(addressRaw);

  const chainIdRaw = req.query.chainId;
  const where = { fromAddress: address };
  if (chainIdRaw != null && String(chainIdRaw).trim() !== "") {
    const cid = Number(chainIdRaw);
    if (!Number.isInteger(cid) || cid <= 0) {
      res.status(400).json({ error: "Invalid chainId" });
      return;
    }
    where.chainId = cid;
  }

  try {
    await ensureDb();
    const rows = await BatchTransferRecord.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    const records = rows.map((row) => {
      const plain = row.get({ plain: true });
      let transfers = [];
      try {
        transfers = JSON.parse(plain.transfersJson || "[]");
      } catch {
        transfers = [];
      }
      let failedBatchIndices = [];
      try {
        failedBatchIndices = plain.failedBatchIndicesJson
          ? JSON.parse(plain.failedBatchIndicesJson)
          : [];
      } catch {
        failedBatchIndices = [];
      }
      return {
        id: String(plain.id),
        chainId: plain.chainId,
        txHash: plain.txHash,
        fromAddress: plain.fromAddress,
        batchContract: plain.batchContract,
        tokenType: plain.tokenType,
        tokenAddress: plain.tokenAddress,
        decimals: plain.decimals,
        recipientCount: plain.recipientCount,
        successCount: plain.successCount,
        failedCount: plain.failedCount,
        failedBatchIndices,
        blockNumber: plain.blockNumber,
        feeWei: plain.feeWei,
        createdAt: plain.createdAt ? new Date(plain.createdAt).getTime() : 0,
        transfers,
      };
    });

    res.json({ records });
  } catch (e) {
    console.error("[batch-transfer/records]", e);
    res.status(500).json({ error: e?.message || "Database error" });
  }
});

export default router;
