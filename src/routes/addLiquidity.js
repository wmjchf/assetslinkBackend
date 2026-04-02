import express from "express";
import { ensureDb } from "../db/init.js";
import { AddLiquidityRecord } from "../db/models/AddLiquidityRecord.js";
import { LpLockRecord } from "../db/models/LpLockRecord.js";
import { isAddress as viemIsAddress } from "viem";
import { Op } from "sequelize";

const router = express.Router();

function verifyAuth(req) {
  const secret = process.env.BACKEND_INTERNAL_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${secret}`;
}

function isAddr(s) {
  return typeof s === "string" && viemIsAddress(s);
}

function isTxHash(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{64}$/i.test(s);
}

function normAddr(s) {
  return String(s).trim().toLowerCase();
}

const QUOTE_ASSETS = new Set(["native", "usdt", "usdc"]);

/**
 * POST /api/add-liquidity/index-tx
 * Body matches Next.js AddLiquidityClient (after successful mint).
 * Optional: Authorization: Bearer <BACKEND_INTERNAL_SECRET>
 */
router.post("/api/add-liquidity/index-tx", async (req, res) => {
  if (!verifyAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const b = req.body;
  if (!b || typeof b !== "object") {
    res.status(400).json({ error: "Expected JSON object" });
    return;
  }

  const chainId = Number(b.chainId || 0);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    res.status(400).json({ error: "Invalid chainId" });
    return;
  }

  if (!isTxHash(b.txHash)) {
    res.status(400).json({ error: "Invalid txHash" });
    return;
  }
  const txHash = normAddr(b.txHash);

  const quoteAsset = String(b.quoteAsset || "").trim().toLowerCase();
  if (!QUOTE_ASSETS.has(quoteAsset)) {
    res.status(400).json({ error: "Invalid quoteAsset (use native, usdt, or usdc)" });
    return;
  }

  if (!isAddr(b.tokenAddress)) {
    res.status(400).json({ error: "Invalid tokenAddress" });
    return;
  }
  const tokenAddress = normAddr(b.tokenAddress);

  if (!isAddr(b.pairAddress)) {
    res.status(400).json({ error: "Invalid pairAddress" });
    return;
  }
  const pairAddress = normAddr(b.pairAddress);

  const wallet = b.wallet != null && isAddr(b.wallet) ? normAddr(b.wallet) : "";
  if (!wallet) {
    res.status(400).json({ error: "Invalid or missing wallet" });
    return;
  }

  let counterpartyTokenAddress = null;
  if (b.counterpartyTokenAddress != null && String(b.counterpartyTokenAddress).trim() !== "") {
    if (!isAddr(b.counterpartyTokenAddress)) {
      res.status(400).json({ error: "Invalid counterpartyTokenAddress" });
      return;
    }
    counterpartyTokenAddress = normAddr(b.counterpartyTokenAddress);
  }

  let lpTokenAddress = pairAddress;
  if (b.lpTokenAddress != null && String(b.lpTokenAddress).trim() !== "") {
    if (!isAddr(b.lpTokenAddress)) {
      res.status(400).json({ error: "Invalid lpTokenAddress" });
      return;
    }
    lpTokenAddress = normAddr(b.lpTokenAddress);
  }

  try {
    await ensureDb();

    const [record, created] = await AddLiquidityRecord.findOrCreate({
      where: { chainId, txHash },
      defaults: {
        chainId,
        txHash,
        wallet,
        tokenAddress,
        quoteAsset,
        counterpartyTokenAddress,
        pairAddress,
        lpTokenAddress,
      },
    });

    if (!created) {
      res.json({
        ok: true,
        created: false,
        id: String(record.id),
        message: "Record already exists for this tx",
      });
      return;
    }

    res.json({ ok: true, created: true, id: String(record.id) });
  } catch (e) {
    console.error("[add-liquidity/index-tx]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

/**
 * GET /api/add-liquidity/pair-lock-status?chainId=1&pairAddress=0x...
 * True if add_liquidity row is marked lpLocked or any lp_lock_records row exists for this LP token.
 */
router.get("/api/add-liquidity/pair-lock-status", async (req, res) => {
  const chainId = Number(req.query.chainId || 0);
  const raw = String(req.query.pairAddress || "").trim().toLowerCase();

  if (!Number.isInteger(chainId) || chainId <= 0) {
    res.status(400).json({ error: "Invalid chainId" });
    return;
  }
  if (!raw || !viemIsAddress(raw)) {
    res.status(400).json({ error: "Invalid pairAddress" });
    return;
  }

  try {
    await ensureDb();

    const lockRow = await LpLockRecord.findOne({
      where: { chainId, tokenAddress: raw },
      order: [["id", "DESC"]],
    });

    const addLocked = await AddLiquidityRecord.findOne({
      where: {
        chainId,
        lpLocked: true,
        [Op.or]: [{ pairAddress: raw }, { lpTokenAddress: raw }],
      },
    });

    const lpLocked = Boolean(addLocked || lockRow);
    const lockId = lockRow ? String(lockRow.lockId) : null;
    res.json({ lpLocked, lockId });
  } catch (e) {
    console.error("[add-liquidity/pair-lock-status]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

/**
 * GET /api/add-liquidity/my-records?address=0x...&chainId=1
 */
router.get("/api/add-liquidity/my-records", async (req, res) => {
  const addressParam = String(req.query.address || "").trim().toLowerCase();
  const chainIdFromQuery = Number(req.query.chainId || "0");
  const chainId = chainIdFromQuery > 0 ? chainIdFromQuery : null;

  if (!addressParam || !viemIsAddress(addressParam)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    await ensureDb();

    const where = { wallet: addressParam };
    if (chainId) where.chainId = chainId;

    const records = await AddLiquidityRecord.findAll({
      where,
      order: [["id", "DESC"]],
      limit: 200,
    });

    res.json({
      records: records.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        txHash: r.txHash,
        wallet: r.wallet,
        tokenAddress: r.tokenAddress,
        quoteAsset: r.quoteAsset,
        counterpartyTokenAddress: r.counterpartyTokenAddress ?? undefined,
        pairAddress: r.pairAddress,
        lpTokenAddress: r.lpTokenAddress ?? r.pairAddress,
        lpLocked: Boolean(r.lpLocked),
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[add-liquidity/my-records]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

export default router;
