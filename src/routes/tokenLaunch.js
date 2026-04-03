import express from "express";
import { Op } from "sequelize";
import { ensureDb } from "../db/init.js";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord.js";
import { TokenLaunchConfig } from "../db/models/TokenLaunchConfig.js";
import { TokenLaunchVestingVault } from "../db/models/TokenLaunchVestingVault.js";
import { TokenLaunchAllocation } from "../db/models/TokenLaunchAllocation.js";
import { buildVaultReleaseCurve } from "../tokenLaunch/releaseCurve.js";
import { isAddress, createPublicClient, http, decodeEventLog, decodeFunctionData } from "viem";
import { verifyTokenOnEtherscan } from "../etherscan-verify.js";
import { TOKEN_FACTORY_EVENTS_ABI, TOKEN_FACTORY_FUNCTIONS_ABI } from "../tokenLaunch/factoryAbi.js";

function getRpcUrl(chainId) {
  return process.env[`RPC_URL_${chainId}`];
}

function normalizeLabel(s) {
  const v = String(s ?? "").trim();
  return v ? v.slice(0, 64) : null;
}

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

    const creatorRows = await TokenLaunchRecord.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      limit: 100,
    });

    const byKey = new Map();
    const creatorKeySet = new Set();
    for (const r of creatorRows) {
      const key = `${r.chainId}:${String(r.tokenAddress).toLowerCase()}`;
      byKey.set(key, r);
      creatorKeySet.add(key);
    }

    const allocWhere = { toAddress: addressLower };
    if (chainId !== null) {
      allocWhere.chainId = chainId;
    }
    const allocRows = await TokenLaunchAllocation.findAll({
      where: allocWhere,
      attributes: ["chainId", "tokenAddress"],
    });

    const extraPairs = new Map();
    for (const a of allocRows) {
      const cid = a.chainId;
      const tok = String(a.tokenAddress).toLowerCase();
      const key = `${cid}:${tok}`;
      if (creatorKeySet.has(key)) continue;
      extraPairs.set(key, { chainId: cid, tokenAddress: tok });
    }

    if (extraPairs.size > 0) {
      const orList = [...extraPairs.values()];
      const extraRecords = await TokenLaunchRecord.findAll({
        where: { [Op.or]: orList },
      });
      for (const r of extraRecords) {
        const key = `${r.chainId}:${String(r.tokenAddress).toLowerCase()}`;
        if (!byKey.has(key)) byKey.set(key, r);
      }
    }

    const rows = [...byKey.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);

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
      const key = `${r.chainId}:${String(r.tokenAddress).toLowerCase()}`;
      return {
        id: String(r.id),
        chainId: r.chainId,
        txHash,
        tokenAddress: String(r.tokenAddress),
        createdAt: new Date(r.createdAt).getTime(),
        config: cfg,
        profileRole: creatorKeySet.has(key) ? "creator" : "recipient",
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

// GET /api/token-launch/recent — latest indexed launches (public, for homepage)
router.get("/api/token-launch/recent", async (req, res) => {
  const limitRaw = Number(req.query.limit || 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20));

  try {
    await ensureDb();

    const rows = await TokenLaunchRecord.findAll({
      order: [["createdAt", "DESC"]],
      limit,
    });

    if (!rows.length) {
      res.json({ error: null, records: [] });
      return;
    }

    const orClause = rows.map((r) => ({
      chainId: r.chainId,
      txHash: String(r.txHash).toLowerCase(),
    }));

    const cfgRows = await TokenLaunchConfig.findAll({
      where: { [Op.or]: orClause },
    });

    const cfgByKey = new Map();
    for (const c of cfgRows) {
      const k = `${c.chainId}:${String(c.txHash).toLowerCase()}`;
      cfgByKey.set(k, { name: String(c.name), symbol: String(c.symbol) });
    }

    const records = rows.map((r) => {
      const k = `${r.chainId}:${String(r.txHash).toLowerCase()}`;
      const cfg = cfgByKey.get(k) || null;
      return {
        id: String(r.id),
        chainId: r.chainId,
        txHash: String(r.txHash),
        tokenAddress: String(r.tokenAddress),
        createdAt: new Date(r.createdAt).getTime(),
        config: cfg,
      };
    });

    res.json({ error: null, records });
  } catch (e) {
    console.error("Failed to load recent token launches", e);
    res.status(500).json({
      error: e?.message || "Internal server error",
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
        creatorAddress: String(r.creatorAddress || "").toLowerCase(),
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

// POST /api/token-launch/index-tx
// Called by frontend immediately after deployment. Fetches tx from chain, writes to DB, triggers verification.
router.post("/api/token-launch/index-tx", async (req, res) => {
  const body = req.body;
  const chainId = Number(body?.chainId || 0);
  const txHash = String(body?.txHash || "").toLowerCase();
  const labels = body?.labels || {};

  if (!chainId || !txHash.startsWith("0x") || txHash.length !== 66) {
    res.status(400).json({ error: "Invalid chainId or txHash" });
    return;
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    res.status(400).json({ error: `No RPC configured for chainId=${chainId}. Set RPC_URL_${chainId} env var.` });
    return;
  }

  try {
    await ensureDb();

    const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });

    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);

    if (!tx || !receipt) {
      res.status(404).json({ error: "Transaction not found on chain" });
      return;
    }

    if (receipt.status === "reverted") {
      res.status(400).json({ error: "Transaction reverted" });
      return;
    }

    // Decode events from receipt logs
    const decodedEvents = [];
    for (const l of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: TOKEN_FACTORY_EVENTS_ABI, data: l.data, topics: l.topics });
        decodedEvents.push({ log: l, decoded });
      } catch { /* ignore */ }
    }

    const tokenCreatedEvent = decodedEvents.find((e) => e.decoded?.eventName === "TokenCreated");
    if (!tokenCreatedEvent) {
      res.status(400).json({ error: "No TokenCreated event found in transaction" });
      return;
    }

    const creator = String(tokenCreatedEvent.decoded?.args?.creator || "").toLowerCase();
    const token = String(tokenCreatedEvent.decoded?.args?.token || "").toLowerCase();
    const factoryAddress = String(tx.to || "").toLowerCase();
    const blockNumber = Number(receipt.blockNumber || 0);
    const logIndex = Number(tokenCreatedEvent.log.logIndex || 0);

    // 1. Upsert main record
    await TokenLaunchRecord.findOrCreate({
      where: { chainId, txHash },
      defaults: { chainId, factoryAddress, creatorAddress: creator, txHash, tokenAddress: token, blockNumber, logIndex },
    });

    // 2. Decode calldata → config + allocations
    let decodedFn = null;
    try {
      decodedFn = decodeFunctionData({ abi: TOKEN_FACTORY_FUNCTIONS_ABI, data: tx.input });
    } catch { /* ignore */ }

    if (decodedFn) {
      const fn = String(decodedFn?.functionName || "");
      const args = decodedFn?.args || [];
      const cfg = args?.[0] || {};
      const fees = cfg?.fees || {};
      const limits = cfg?.limits || {};

      await TokenLaunchConfig.findOrCreate({
        where: { chainId, txHash },
        defaults: {
          chainId, txHash, tokenAddress: token, factoryAddress, creatorAddress: creator,
          name: String(cfg?.name || ""),
          symbol: String(cfg?.symbol || ""),
          totalSupplyRaw: String(cfg?.totalSupplyRaw ?? "0"),
          marketingWallet: String(cfg?.marketingWallet || "").toLowerCase(),
          buyMarketingBps: Number(fees?.buyMarketingBps ?? 0),
          buyLiquidityBps: Number(fees?.buyLiquidityBps ?? 0),
          buyBurnBps: Number(fees?.buyBurnBps ?? 0),
          sellMarketingBps: Number(fees?.sellMarketingBps ?? 0),
          sellLiquidityBps: Number(fees?.sellLiquidityBps ?? 0),
          sellBurnBps: Number(fees?.sellBurnBps ?? 0),
          maxGasPriceWei: String(limits?.maxGasPriceWei ?? "0"),
          deadBlocks: String(limits?.deadBlocks ?? "0"),
          revertEarlyBuys: Boolean(limits?.revertEarlyBuys ?? true),
          maxTxAmount: String(limits?.maxTxAmount ?? "0"),
          maxWalletAmount: String(limits?.maxWalletAmount ?? "0"),
        },
      });

      const recipients = fn === "createTokenWithDistribution" ? (args?.[1] || []) : [];
      const amounts = fn === "createTokenWithDistribution" ? (args?.[2] || []) : [];
      const labelsOnChain =
        fn === "createTokenWithDistribution" && Array.isArray(args?.[3]) ? args[3] : [];

      let sum = BigInt(0);
      const allocLabels = Array.isArray(labels.allocations) ? labels.allocations : [];
      for (let i = 0; i < recipients.length; i++) {
        const toAddr = String(recipients[i] || "").toLowerCase();
        const amt = BigInt(String(amounts[i] ?? "0"));
        sum += amt;
        const userLabel = allocLabels.find((l) => Number(l?.allocIndex) === i);
        const fromChain = normalizeLabel(labelsOnChain[i]);
        const fromBody = normalizeLabel(userLabel?.label);
        await TokenLaunchAllocation.findOrCreate({
          where: { chainId, txHash, allocIndex: i },
          defaults: {
            chainId, txHash, tokenAddress: token, toAddress: toAddr,
            amount: amt.toString(), allocationType: "immediate", allocIndex: i,
            label: fromChain ?? fromBody,
          },
        });
      }

      // Creator remaining
      const totalSupplyRaw = BigInt(String(cfg?.totalSupplyRaw ?? "0"));
      const remaining = totalSupplyRaw > sum ? totalSupplyRaw - sum : BigInt(0);
      if (remaining > BigInt(0)) {
        await TokenLaunchAllocation.findOrCreate({
          where: { chainId, txHash, allocIndex: 999999 },
          defaults: {
            chainId, txHash, tokenAddress: token, toAddress: creator,
            amount: remaining.toString(), allocationType: "creator_remaining", allocIndex: 999999,
          },
        });
      }

      // Trigger Etherscan verification (non-blocking)
      verifyTokenOnEtherscan(chainId, token, {
        factoryAddress,
        name: String(cfg?.name || ""),
        symbol: String(cfg?.symbol || ""),
        totalSupplyRaw: String(cfg?.totalSupplyRaw ?? "0"),
        decimals: 18,
      })
        .then((r) => console.log(`[index-tx][verify] token=${token} status=${r.status}${r.message ? " msg=" + r.message : ""}`))
        .catch((e) => console.warn("[index-tx][verify] error:", e?.message || e));
    }

    res.json({ ok: true, chainId, txHash, tokenAddress: token });
  } catch (e) {
    console.error("[index-tx] error:", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

export default router;

