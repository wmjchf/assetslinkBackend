import express from "express";
import { ensureDb } from "../db/init.js";
import { VestingLockRecord } from "../db/models/VestingLockRecord.js";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord.js";
import { isAddress, createPublicClient, http, decodeEventLog } from "viem";
import { Op } from "sequelize";

const router = express.Router();

const ERC20_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
];

const VESTING_LOCK_CREATED_EVENT = {
  type: "event",
  name: "VestingLockCreated",
  inputs: [
    { indexed: true, name: "id", type: "uint256" },
    { indexed: true, name: "token", type: "address" },
    { indexed: true, name: "beneficiary", type: "address" },
    { name: "requestedAmount", type: "uint256" },
    { name: "receivedAmount", type: "uint256" },
    { name: "start", type: "uint64" },
    { name: "cliffSeconds", type: "uint64" },
    { name: "durationSeconds", type: "uint64" },
  ],
};

const VESTING_LOCK_EVENTS_ABI = [VESTING_LOCK_CREATED_EVENT];

function getRpcUrl(chainId) {
  return process.env[`RPC_URL_${chainId}`];
}

function verifyAuth(req) {
  const secret = process.env.BACKEND_INTERNAL_SECRET;
  if (!secret) return true;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${secret}`;
}

function normAddr(s) {
  return String(s || "").toLowerCase();
}

function isTxHash(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{64}$/i.test(s);
}

function sanitizeDistributionLabel(s) {
  const t = String(s ?? "")
    .trim()
    .replace(/\0/g, "");
  if (!t) return null;
  return t.slice(0, 128);
}

/**
 * GET /api/vesting-lock/my-locks?address=0x&chainId=
 * Rows where address is lock owner (creator) or beneficiary.
 * tokenLaunch: optional link if this token appears in token_launch_records (same chain).
 */
router.get("/api/vesting-lock/my-locks", async (req, res) => {
  const addressParam = normAddr(String(req.query.address || "").trim());
  const chainIdFromQuery = Number(req.query.chainId || "0");
  const chainId = chainIdFromQuery > 0 ? chainIdFromQuery : null;

  if (!addressParam || !isAddress(addressParam)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    await ensureDb();

    const where = {
      [Op.or]: [{ beneficiaryAddress: addressParam }, { ownerAddress: addressParam }],
    };
    if (chainId) where.chainId = chainId;

    const records = await VestingLockRecord.findAll({
      where,
      order: [["id", "DESC"]],
      limit: 200,
    });

    const tokenSet = [...new Set(records.map((r) => normAddr(r.tokenAddress)).filter(Boolean))];
    let launchByToken = new Map();
    if (tokenSet.length > 0) {
      const launchWhere = { tokenAddress: { [Op.in]: tokenSet } };
      if (chainId) launchWhere.chainId = chainId;
      const launches = await TokenLaunchRecord.findAll({
        where: launchWhere,
        order: [["createdAt", "DESC"]],
      });
      for (const row of launches) {
        const k = normAddr(row.tokenAddress);
        if (!launchByToken.has(k)) launchByToken.set(k, row);
      }
    }

    const missingMeta = records.filter((r) => r.tokenName == null && r.tokenAddress);
    if (missingMeta.length > 0) {
      const rpcUrl = getRpcUrl(chainId || records[0]?.chainId);
      if (rpcUrl) {
        (async () => {
          const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
          for (const r of missingMeta) {
            try {
              const addr = r.tokenAddress;
              const [nameRes, symbolRes, decimalsRes] = await Promise.all([
                client.readContract({ address: addr, abi: ERC20_ABI, functionName: "name" }),
                client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }),
                client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }),
              ]);
              await r.update({
                tokenName: String(nameRes || "").slice(0, 64),
                tokenSymbol: String(symbolRes || "").slice(0, 32),
                tokenDecimals: Number(decimalsRes ?? 18),
              });
            } catch {
              /* non-fatal */
            }
          }
        })();
      }
    }

    res.json({
      records: records.map((r) => {
        const launch = launchByToken.get(normAddr(r.tokenAddress));
        return {
          id: String(r.id),
          chainId: r.chainId,
          timelockAddress: r.timelockAddress,
          vestingId: r.vestingId,
          ownerAddress: r.ownerAddress,
          beneficiaryAddress: r.beneficiaryAddress,
          tokenAddress: r.tokenAddress,
          requestedAmount: r.requestedAmount,
          receivedAmount: r.receivedAmount,
          startUnix: r.startUnix,
          cliffSeconds: r.cliffSeconds,
          durationSeconds: r.durationSeconds,
          txHash: r.txHash,
          blockNumber: String(r.blockNumber),
          tokenName: r.tokenName ?? null,
          tokenSymbol: r.tokenSymbol ?? null,
          tokenDecimals: r.tokenDecimals ?? null,
          distributionLabel: r.distributionLabel ?? null,
          createdAt: r.createdAt,
          tokenLaunch: launch
            ? {
                txHash: launch.txHash,
                createdAt: launch.createdAt ? new Date(launch.createdAt).getTime() : null,
              }
            : null,
        };
      }),
    });
  } catch (e) {
    console.error("vesting-lock my-locks", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

/**
 * GET /api/vesting-lock/by-token?chainId=&tokenAddress=
 * Indexed VestingTimeLock rows for token detail / charts (no wallet address filter).
 */
router.get("/api/vesting-lock/by-token", async (req, res) => {
  const chainId = Number(req.query.chainId || "0");
  const tokenAddress = normAddr(String(req.query.tokenAddress || "").trim());

  if (!chainId || !tokenAddress || !isAddress(tokenAddress)) {
    res.status(400).json({ error: "Invalid chainId or tokenAddress" });
    return;
  }

  try {
    await ensureDb();

    const records = await VestingLockRecord.findAll({
      where: { chainId, tokenAddress },
      order: [["id", "ASC"]],
      limit: 500,
    });

    res.json({
      records: records.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        timelockAddress: r.timelockAddress,
        vestingId: r.vestingId,
        ownerAddress: r.ownerAddress,
        beneficiaryAddress: r.beneficiaryAddress,
        tokenAddress: r.tokenAddress,
        requestedAmount: r.requestedAmount,
        receivedAmount: r.receivedAmount,
        startUnix: r.startUnix,
        cliffSeconds: r.cliffSeconds,
        durationSeconds: r.durationSeconds,
        txHash: r.txHash,
        blockNumber: String(r.blockNumber),
        tokenName: r.tokenName ?? null,
        tokenSymbol: r.tokenSymbol ?? null,
        tokenDecimals: r.tokenDecimals ?? null,
        distributionLabel: r.distributionLabel ?? null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("vesting-lock by-token", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

/**
 * GET /api/vesting-lock/one?chainId=&timelockAddress=&vestingId=
 */
router.get("/api/vesting-lock/one", async (req, res) => {
  const chainId = Number(req.query.chainId || "0");
  const timelockAddress = normAddr(String(req.query.timelockAddress || "").trim());
  const vestingId = String(req.query.vestingId || "").trim();

  if (!chainId || !timelockAddress || !isAddress(timelockAddress) || !vestingId) {
    res.status(400).json({ error: "Invalid chainId, timelockAddress, or vestingId" });
    return;
  }

  try {
    await ensureDb();
    const r = await VestingLockRecord.findOne({
      where: { chainId, timelockAddress, vestingId },
    });
    if (!r) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      record: {
        id: String(r.id),
        chainId: r.chainId,
        timelockAddress: r.timelockAddress,
        vestingId: r.vestingId,
        distributionLabel: r.distributionLabel ?? null,
        beneficiaryAddress: r.beneficiaryAddress,
        tokenAddress: r.tokenAddress,
      },
    });
  } catch (e) {
    console.error("vesting-lock one", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

/**
 * POST /api/vesting-lock/index-tx
 * Decode VestingLockCreated from receipt; optional Bearer secret.
 */
router.post("/api/vesting-lock/index-tx", async (req, res) => {
  if (!verifyAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const body = req.body || {};
  const chainId = Number(body.chainId || 0);
  const txHash = normAddr(String(body.txHash || ""));
  const timelockAddress = normAddr(String(body.timelockAddress || ""));
  const distributionLabel = sanitizeDistributionLabel(body.distributionLabel);

  if (!chainId || !isTxHash(txHash)) {
    res.status(400).json({ error: "Invalid chainId or txHash" });
    return;
  }
  if (!timelockAddress || !isAddress(timelockAddress)) {
    res.status(400).json({ error: "Invalid timelockAddress" });
    return;
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    res.status(400).json({ error: `No RPC configured for chainId=${chainId}` });
    return;
  }

  try {
    await ensureDb();

    const client = createPublicClient({ transport: http(rpcUrl, { timeout: 30_000 }) });
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash }),
      client.getTransactionReceipt({ hash: txHash }),
    ]);

    if (!tx || !receipt || receipt.status === "reverted") {
      res.status(404).json({ error: "Transaction not found or reverted" });
      return;
    }

    const ownerAddress = normAddr(tx.from || "");
    const blockNumber = Number(receipt.blockNumber || 0);

    /** @type {{ vestingId: string, tokenAddress: string, beneficiaryAddress: string, requestedAmount: string, receivedAmount: string, startUnix: string, cliffSeconds: string, durationSeconds: string, logIndex: number }[]} */
    const decodedRows = [];

    for (const l of receipt.logs) {
      if (normAddr(l.address) !== timelockAddress) continue;
      try {
        const decoded = decodeEventLog({
          abi: VESTING_LOCK_EVENTS_ABI,
          data: l.data,
          topics: l.topics,
        });
        if (decoded?.eventName !== "VestingLockCreated") continue;
        const a = decoded.args;
        decodedRows.push({
          vestingId: String(a.id),
          tokenAddress: normAddr(a.token),
          beneficiaryAddress: normAddr(a.beneficiary),
          requestedAmount: String(a.requestedAmount ?? "0"),
          receivedAmount: String(a.receivedAmount ?? "0"),
          startUnix: String(a.start ?? "0"),
          cliffSeconds: String(a.cliffSeconds ?? "0"),
          durationSeconds: String(a.durationSeconds ?? "0"),
          logIndex: Number(l.logIndex || 0),
        });
      } catch {
        /* next log */
      }
    }

    if (decodedRows.length === 0) {
      res.status(400).json({ error: "No VestingLockCreated event for this timelock in transaction" });
      return;
    }

    const tokenMetaCache = new Map();
    async function getTokenMeta(addr) {
      const k = normAddr(addr);
      if (tokenMetaCache.has(k)) return tokenMetaCache.get(k);
      let meta = { tokenName: null, tokenSymbol: null, tokenDecimals: null };
      try {
        const [nameRes, symbolRes, decimalsRes] = await Promise.all([
          client.readContract({ address: k, abi: ERC20_ABI, functionName: "name" }),
          client.readContract({ address: k, abi: ERC20_ABI, functionName: "symbol" }),
          client.readContract({ address: k, abi: ERC20_ABI, functionName: "decimals" }),
        ]);
        meta = {
          tokenName: String(nameRes || "").slice(0, 64),
          tokenSymbol: String(symbolRes || "").slice(0, 32),
          tokenDecimals: Number(decimalsRes ?? 18),
        };
      } catch {
        /* optional */
      }
      tokenMetaCache.set(k, meta);
      return meta;
    }

    const insertedIds = [];
    for (const row of decodedRows) {
      const { tokenName, tokenSymbol, tokenDecimals } = await getTokenMeta(row.tokenAddress);
      const [rec] = await VestingLockRecord.findOrCreate({
        where: {
          chainId,
          timelockAddress,
          vestingId: row.vestingId,
        },
        defaults: {
          chainId,
          timelockAddress,
          vestingId: row.vestingId,
          ownerAddress,
          beneficiaryAddress: row.beneficiaryAddress,
          tokenAddress: row.tokenAddress,
          requestedAmount: row.requestedAmount,
          receivedAmount: row.receivedAmount,
          startUnix: row.startUnix,
          cliffSeconds: row.cliffSeconds,
          durationSeconds: row.durationSeconds,
          txHash,
          blockNumber,
          logIndex: row.logIndex,
          tokenName,
          tokenSymbol,
          tokenDecimals,
          distributionLabel,
        },
      });
      if (distributionLabel) {
        await rec.update({ distributionLabel });
      }
      insertedIds.push(row.vestingId);
    }

    res.json({ ok: true, chainId, txHash, vestingIds: insertedIds });
  } catch (e) {
    console.error("vesting-lock index-tx", e);
    res.status(500).json({ error: e?.message || "Internal server error" });
  }
});

export default router;
