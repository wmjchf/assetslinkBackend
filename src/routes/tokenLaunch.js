import express from "express";
import { ensureDb } from "../db/init.js";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord.js";
import { TokenLaunchConfig } from "../db/models/TokenLaunchConfig.js";
import { TokenLaunchVestingVault } from "../db/models/TokenLaunchVestingVault.js";
import { TokenLaunchAllocation } from "../db/models/TokenLaunchAllocation.js";
import { buildVaultReleaseCurve } from "../tokenLaunch/releaseCurve.js";
import { isAddress } from "viem";

const router = express.Router();

router.get("/api/token-launch/my-token", async (req, res) => {
  const addressParam = String(req.query.address || "").trim();
  const addressLower = addressParam.toLowerCase();
  const chainIdFromQuery = Number(req.query.chainId || "0");
  const chainId = chainIdFromQuery > 0 ? chainIdFromQuery : null;

  if (!addressParam) {
    res.status(400).json({
      error: "Missing address. Please provide ?address=0x... in the URL.",
      records: [],
    });
    return;
  }

  if (!isAddress(addressParam)) {
    res.status(400).json({
      error: "Invalid address.",
      records: [],
    });
    return;
  }

  try {
    await ensureDb();

    const whereClause = { creatorAddress: addressLower };
    if (chainId !== null) {
      whereClause.chainId = chainId;
    }

    const rows = await TokenLaunchRecord.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    const txHashes = rows.map((r) => String(r.txHash).toLowerCase());
    const cfgWhereClause = { txHash: txHashes };
    if (chainId !== null) {
      cfgWhereClause.chainId = chainId;
    }

    const cfgRows = txHashes.length
      ? await TokenLaunchConfig.findAll({ where: cfgWhereClause })
      : [];

    const cfgByTx = new Map();
    for (const c of cfgRows) {
      cfgByTx.set(String(c.txHash).toLowerCase(), {
        name: String(c.name),
        symbol: String(c.symbol),
      });
    }

    const records = rows.map((r) => {
      const txHash = String(r.txHash);
      const cfg = cfgByTx.get(txHash.toLowerCase()) || null;
      return {
        id: String(r.id),
        chainId: r.chainId,
        txHash,
        tokenAddress: String(r.tokenAddress),
        createdAt: new Date(r.createdAt).getTime(),
        config: cfg,
      };
    });

    res.json({
      error: null,
      records,
    });
  } catch (e) {
    console.error("Failed to load My Tokens page data", e);
    const msg = e?.message || String(e);
    res.status(500).json({
      error: `Failed to load data from server. Please try again later. (Debug: ${msg})`,
      records: [],
    });
  }
});

// POST /api/token-launch/metadata - Update metadata (labels) for allocations and vestings
router.post("/api/token-launch/metadata", async (req, res) => {
  try {
    await ensureDb();

    const body = req.body;
    const chainId = Number(body?.chainId || 0);
    const txHash = String(body?.txHash || "").toLowerCase();

    if (!chainId || !txHash.startsWith("0x") || txHash.length !== 66) {
      res.status(400).json({ error: "Invalid chainId or txHash" });
      return;
    }

    // Only accept metadata for existing indexed records.
    const rec = await TokenLaunchRecord.findOne({ where: { chainId, txHash } });
    if (!rec) {
      res.status(404).json({ error: "Record not found yet. Please wait for the indexer and retry." });
      return;
    }

    const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    const vestings = Array.isArray(body.vestings) ? body.vestings : [];

    function normalizeLabel(s) {
      const v = String(s ?? "").trim();
      if (!v) return null;
      return v.slice(0, 64);
    }

    let allocUpdated = 0;
    for (const a of allocations) {
      const idx = Number(a?.allocIndex);
      if (!Number.isInteger(idx) || idx < 0) continue;
      const label = normalizeLabel(a?.label);
      const [count] = await TokenLaunchAllocation.update(
        { label },
        { where: { chainId, txHash, allocIndex: idx } }
      );
      allocUpdated += Number(count || 0);
    }

    let vestUpdated = 0;
    for (const v of vestings) {
      const idx = Number(v?.vestingIndex);
      if (!Number.isInteger(idx) || idx < 0) continue;
      const label = normalizeLabel(v?.label);
      const [count] = await TokenLaunchVestingVault.update(
        { label },
        { where: { chainId, txHash, vestingIndex: idx } }
      );
      vestUpdated += Number(count || 0);
    }

    res.json({
      ok: true,
      chainId,
      txHash,
      allocationsUpdated: allocUpdated,
      vestingsUpdated: vestUpdated,
    });
  } catch (e) {
    console.error("Failed to update metadata", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

// GET /api/token-launch/records - Get token launch records with full details
router.get("/api/token-launch/records", async (req, res) => {
  try {
    await ensureDb();

    const address = String(req.query.address || "").toLowerCase();
    const tokenAddress = String(req.query.tokenAddress || "").toLowerCase();
    const chainId = Number(req.query.chainId || "0");

    const where = {};
    if (address) where.creatorAddress = address;
    if (tokenAddress) where.tokenAddress = tokenAddress;
    if (chainId) where.chainId = chainId;

    const rows = await TokenLaunchRecord.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    const txHashes = rows.map((r) => r.txHash);
    const [vaultRows, cfgRows, allocRows] = txHashes.length
      ? await Promise.all([
          TokenLaunchVestingVault.findAll({
            where: { chainId: chainId || undefined, txHash: txHashes },
          }),
          TokenLaunchConfig.findAll({
            where: { chainId: chainId || undefined, txHash: txHashes },
          }),
          TokenLaunchAllocation.findAll({
            where: { chainId: chainId || undefined, txHash: txHashes },
            order: [["allocIndex", "ASC"]],
          }),
        ])
      : [[], [], []];

    const vestingByTx = new Map();
    for (const v of vaultRows) {
      const k = String(v.txHash).toLowerCase();
      const arr = vestingByTx.get(k) || [];
      arr.push({
        vaultAddress: String(v.vaultAddress),
        beneficiary: String(v.beneficiary),
        amount: String(v.amount),
        label: v.label ? String(v.label) : null,
        vestingStart: v.vestingStart ? String(v.vestingStart) : null,
        vestingCliffSeconds: v.vestingCliffSeconds ? String(v.vestingCliffSeconds) : null,
        vestingDurationSeconds: v.vestingDurationSeconds ? String(v.vestingDurationSeconds) : null,
        vestingIndex: typeof v.vestingIndex === "number" ? v.vestingIndex : null,
      });
      vestingByTx.set(k, arr);
    }

    const cfgByTx = new Map();
    for (const c of cfgRows) {
      cfgByTx.set(String(c.txHash).toLowerCase(), {
        name: String(c.name),
        symbol: String(c.symbol),
        totalSupplyRaw: String(c.totalSupplyRaw),
        marketingWallet: String(c.marketingWallet),
        fees: {
          buyMarketingBps: Number(c.buyMarketingBps || 0),
          buyLiquidityBps: Number(c.buyLiquidityBps || 0),
          buyBurnBps: Number(c.buyBurnBps || 0),
          sellMarketingBps: Number(c.sellMarketingBps || 0),
          sellLiquidityBps: Number(c.sellLiquidityBps || 0),
          sellBurnBps: Number(c.sellBurnBps || 0),
        },
        limits: {
          maxGasPriceWei: String(c.maxGasPriceWei || "0"),
          deadBlocks: String(c.deadBlocks || "0"),
          revertEarlyBuys: Boolean(c.revertEarlyBuys),
          maxTxAmount: String(c.maxTxAmount || "0"),
          maxWalletAmount: String(c.maxWalletAmount || "0"),
        },
      });
    }

    const allocByTx = new Map();
    for (const a of allocRows) {
      const k = String(a.txHash).toLowerCase();
      const arr = allocByTx.get(k) || [];
      arr.push({
        toAddress: String(a.toAddress),
        amount: String(a.amount),
        label: a.label ? String(a.label) : null,
        allocationType: String(a.allocationType),
        allocIndex: Number(a.allocIndex),
      });
      allocByTx.set(k, arr);
    }

    res.json({
      records: rows.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        txHash: r.txHash,
        tokenAddress: r.tokenAddress,
        // backward-compatible: old field still returns vault addresses only
        vestingVaults: (vestingByTx.get(String(r.txHash).toLowerCase()) || []).map((x) => x.vaultAddress),
        // new fields for full detail view
        config: cfgByTx.get(String(r.txHash).toLowerCase()) || null,
        allocations: allocByTx.get(String(r.txHash).toLowerCase()) || [],
        vestingVaultDetails: vestingByTx.get(String(r.txHash).toLowerCase()) || [],
        createdAt: new Date(r.createdAt).getTime(),
      })),
    });
  } catch (e) {
    console.error("Failed to load records", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

// GET /api/token-launch/release-curve - Get vesting release curves for a token
router.get("/api/token-launch/release-curve", async (req, res) => {
  try {
    const tokenAddress = String(req.query.tokenAddress || "").trim();
    const chainId = Number(req.query.chainId || "0");

    if (!chainId || !Number.isFinite(chainId) || chainId <= 0) {
      res.status(400).json({ error: "Invalid chainId" });
      return;
    }
    if (!isAddress(tokenAddress)) {
      res.status(400).json({ error: "Invalid tokenAddress" });
      return;
    }

    await ensureDb();

    const rows = await TokenLaunchVestingVault.findAll({
      where: { chainId, tokenAddress: tokenAddress.toLowerCase() },
      order: [["logIndex", "ASC"]],
    });

    const vaults = rows.map((v) => {
      const points = buildVaultReleaseCurve({
        vaultAddress: String(v.vaultAddress),
        amount: String(v.amount),
        vestingStart: v.vestingStart ? String(v.vestingStart) : "0",
        vestingCliffSeconds: v.vestingCliffSeconds ? String(v.vestingCliffSeconds) : "0",
        vestingDurationSeconds: v.vestingDurationSeconds ? String(v.vestingDurationSeconds) : "0",
        maxPoints: 180,
      }).points;

      return {
        vaultAddress: String(v.vaultAddress),
        beneficiary: String(v.beneficiary),
        label: v.label ? String(v.label) : null,
        amount: String(v.amount),
        vestingStart: v.vestingStart ? String(v.vestingStart) : "0",
        vestingCliffSeconds: v.vestingCliffSeconds ? String(v.vestingCliffSeconds) : "0",
        vestingDurationSeconds: v.vestingDurationSeconds ? String(v.vestingDurationSeconds) : "0",
        vestingIndex: typeof v.vestingIndex === "number" ? v.vestingIndex : null,
        points,
      };
    });

    res.json({
      chainId,
      tokenAddress: tokenAddress.toLowerCase(),
      vaultCount: vaults.length,
      vaults,
    });
  } catch (e) {
    console.error("Failed to load release curve", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

export default router;

