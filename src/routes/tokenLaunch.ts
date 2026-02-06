import Router from "koa-router";
import type { Context } from "koa";
import { ensureDb } from "../db/init";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord";
import { TokenLaunchConfig } from "../db/models/TokenLaunchConfig";
import { TokenLaunchVestingVault } from "../db/models/TokenLaunchVestingVault";
import { TokenLaunchAllocation } from "../db/models/TokenLaunchAllocation";
import { buildVaultReleaseCurve } from "../tokenLaunch/releaseCurve";
import { isAddress } from "viem";

const router = new Router();

router.get("/api/token-launch/my-token", async (ctx: Context) => {
  const addressParam = String(ctx.query.address || "").trim();
  const addressLower = addressParam.toLowerCase();
  const chainIdFromQuery = Number(ctx.query.chainId || "0");
  const chainId = chainIdFromQuery > 0 ? chainIdFromQuery : null;

  if (!addressParam) {
    ctx.status = 400;
    ctx.body = {
      error: "Missing address. Please provide ?address=0x... in the URL.",
      records: [],
    };
    return;
  }

  if (!isAddress(addressParam)) {
    ctx.status = 400;
    ctx.body = {
      error: "Invalid address.",
      records: [],
    };
    return;
  }

  try {
    await ensureDb();

    const whereClause: any = { creatorAddress: addressLower };
    if (chainId !== null) {
      whereClause.chainId = chainId;
    }

    const rows = await TokenLaunchRecord.findAll({
      where: whereClause,
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    const txHashes = rows.map((r) => String(r.txHash).toLowerCase());
    const cfgWhereClause: any = { txHash: txHashes };
    if (chainId !== null) {
      cfgWhereClause.chainId = chainId;
    }

    const cfgRows = txHashes.length
      ? await TokenLaunchConfig.findAll({ where: cfgWhereClause })
      : [];

    const cfgByTx = new Map<string, { name: string; symbol: string }>();
    for (const c of cfgRows as any[]) {
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

    ctx.body = {
      error: null,
      records,
    };
  } catch (e: any) {
    console.error("Failed to load My Tokens page data", e);
    const msg = e?.message || String(e);
    ctx.status = 500;
    ctx.body = {
      error: `Failed to load data from server. Please try again later. (Debug: ${msg})`,
      records: [],
    };
  }
});

// POST /api/token-launch/metadata - Update metadata (labels) for allocations and vestings
router.post("/api/token-launch/metadata", async (ctx: Context) => {
  try {
    await ensureDb();

    const body = ctx.request.body as any;
    const chainId = Number(body?.chainId || 0);
    const txHash = String(body?.txHash || "").toLowerCase();

    if (!chainId || !txHash.startsWith("0x") || txHash.length !== 66) {
      ctx.status = 400;
      ctx.body = { error: "Invalid chainId or txHash" };
      return;
    }

    // Only accept metadata for existing indexed records.
    const rec = await TokenLaunchRecord.findOne({ where: { chainId, txHash } as any });
    if (!rec) {
      ctx.status = 404;
      ctx.body = { error: "Record not found yet. Please wait for the indexer and retry." };
      return;
    }

    const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    const vestings = Array.isArray(body.vestings) ? body.vestings : [];

    function normalizeLabel(s: any) {
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
        { label } as any,
        { where: { chainId, txHash, allocIndex: idx } as any }
      );
      allocUpdated += Number(count || 0);
    }

    let vestUpdated = 0;
    for (const v of vestings) {
      const idx = Number(v?.vestingIndex);
      if (!Number.isInteger(idx) || idx < 0) continue;
      const label = normalizeLabel(v?.label);
      const [count] = await TokenLaunchVestingVault.update(
        { label } as any,
        { where: { chainId, txHash, vestingIndex: idx } as any }
      );
      vestUpdated += Number(count || 0);
    }

    ctx.body = {
      ok: true,
      chainId,
      txHash,
      allocationsUpdated: allocUpdated,
      vestingsUpdated: vestUpdated,
    };
  } catch (e: any) {
    console.error("Failed to update metadata", e);
    ctx.status = 500;
    ctx.body = { error: e?.message || "Internal server error" };
  }
});

// GET /api/token-launch/records - Get token launch records with full details
router.get("/api/token-launch/records", async (ctx: Context) => {
  try {
    await ensureDb();

    const address = String(ctx.query.address || "").toLowerCase();
    const tokenAddress = String(ctx.query.tokenAddress || "").toLowerCase();
    const chainId = Number(ctx.query.chainId || "0");

    const where: any = {};
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
            where: { chainId: chainId || undefined, txHash: txHashes } as any,
          }),
          TokenLaunchConfig.findAll({
            where: { chainId: chainId || undefined, txHash: txHashes } as any,
          }),
          TokenLaunchAllocation.findAll({
            where: { chainId: chainId || undefined, txHash: txHashes } as any,
            order: [["allocIndex", "ASC"]],
          }),
        ])
      : [[], [], []];

    const vestingByTx = new Map<string, any[]>();
    for (const v of vaultRows as any[]) {
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

    const cfgByTx = new Map<string, any>();
    for (const c of cfgRows as any[]) {
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

    const allocByTx = new Map<string, any[]>();
    for (const a of allocRows as any[]) {
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

    ctx.body = {
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
    };
  } catch (e: any) {
    console.error("Failed to load records", e);
    ctx.status = 500;
    ctx.body = { error: e?.message || "Internal server error" };
  }
});

// GET /api/token-launch/release-curve - Get vesting release curves for a token
router.get("/api/token-launch/release-curve", async (ctx: Context) => {
  try {
    const tokenAddress = String(ctx.query.tokenAddress || "").trim();
    const chainId = Number(ctx.query.chainId || "0");

    if (!chainId || !Number.isFinite(chainId) || chainId <= 0) {
      ctx.status = 400;
      ctx.body = { error: "Invalid chainId" };
      return;
    }
    if (!isAddress(tokenAddress)) {
      ctx.status = 400;
      ctx.body = { error: "Invalid tokenAddress" };
      return;
    }

    await ensureDb();

    const rows = await TokenLaunchVestingVault.findAll({
      where: { chainId, tokenAddress: tokenAddress.toLowerCase() } as any,
      order: [["logIndex", "ASC"]],
    });

    const vaults = (rows as any[]).map((v) => {
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

    ctx.body = {
      chainId,
      tokenAddress: tokenAddress.toLowerCase(),
      vaultCount: vaults.length,
      vaults,
    };
  } catch (e: any) {
    console.error("Failed to load release curve", e);
    ctx.status = 500;
    ctx.body = { error: e?.message || "Internal server error" };
  }
});

export default router;

