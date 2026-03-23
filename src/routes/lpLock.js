import express from "express";
import { ensureDb } from "../db/init.js";
import { LpLockRecord } from "../db/models/LpLockRecord.js";
import { isAddress, createPublicClient, http, decodeEventLog } from "viem";
import { Op } from "sequelize";

// ── ABIs ───────────────────────────────────────────────────────────────────
const ERC20_ABI = [
  { type: "function", name: "name",     stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol",   stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8"   }] },
];

const LP_TIMELOCK_EVENTS_ABI = [
  {
    type: "event",
    name: "LockCreated",
    inputs: [
      { indexed: true, name: "id", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "beneficiary", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "unlockTime", type: "uint256" },
    ],
  },
];

function getRpcUrl(chainId) {
  return process.env[`RPC_URL_${chainId}`];
}

const router = express.Router();

// ── GET /api/lp-lock/my-locks?address=0x...&chainId=97
// Returns all LP locks where the address is beneficiary or owner.
router.get("/api/lp-lock/my-locks", async (req, res) => {
  const addressParam = String(req.query.address || "").trim().toLowerCase();
  const chainIdFromQuery = Number(req.query.chainId || "0");
  const chainId = chainIdFromQuery > 0 ? chainIdFromQuery : null;

  if (!addressParam || !isAddress(addressParam)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    await ensureDb();

    const where = {
      [Op.or]: [
        { beneficiaryAddress: addressParam },
        { ownerAddress: addressParam },
      ],
    };
    if (chainId) where.chainId = chainId;

    const records = await LpLockRecord.findAll({
      where,
      order: [["id", "DESC"]],
      limit: 200,
    });

    // Fire-and-forget backfill for records missing token metadata
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
                tokenName:     String(nameRes    || "").slice(0, 64),
                tokenSymbol:   String(symbolRes  || "").slice(0, 32),
                tokenDecimals: Number(decimalsRes ?? 18),
              });
            } catch { /* non-fatal */ }
          }
        })();
      }
    }

    res.json({
      records: records.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        contractAddress: r.contractAddress,
        lockId: r.lockId,
        ownerAddress: r.ownerAddress,
        beneficiaryAddress: r.beneficiaryAddress,
        tokenAddress: r.tokenAddress,
        amount: r.amount,
        unlockTime: r.unlockTime,
        txHash: r.txHash,
        blockNumber: String(r.blockNumber),
        tokenName: r.tokenName ?? null,
        tokenSymbol: r.tokenSymbol ?? null,
        tokenDecimals: r.tokenDecimals ?? null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[lp-lock/my-locks]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

// ── POST /api/lp-lock/index-tx
// Called by frontend after createLock succeeds.
// Body: { chainId, txHash }
router.post("/api/lp-lock/index-tx", async (req, res) => {
  const body = req.body;
  const chainId = Number(body?.chainId || 0);
  const txHash = String(body?.txHash || "").toLowerCase();

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

    // Parse LockCreated event from logs
    const lockEvents = [];
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: LP_TIMELOCK_EVENTS_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded?.eventName === "LockCreated") {
          lockEvents.push({ log, decoded });
        }
      } catch { /* not our event */ }
    }

    if (lockEvents.length === 0) {
      res.status(400).json({ error: "No LockCreated event found in transaction" });
      return;
    }

    const contractAddress = String(tx.to || "").toLowerCase();
    const ownerAddress = String(tx.from || "").toLowerCase();
    const blockNumber = Number(receipt.blockNumber || 0);

    // Collect unique token addresses from all lock events, then fetch metadata in parallel
    const uniqueTokens = [...new Set(lockEvents.map(({ decoded }) =>
      String(decoded.args.token || "").toLowerCase()
    ))];

    const tokenMetaMap = {};
    await Promise.all(uniqueTokens.map(async (tokenAddr) => {
      try {
        const [nameRes, symbolRes, decimalsRes] = await Promise.all([
          client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "name" }),
          client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "symbol" }),
          client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "decimals" }),
        ]);
        tokenMetaMap[tokenAddr] = {
          tokenName:     String(nameRes    || "").slice(0, 64),
          tokenSymbol:   String(symbolRes  || "").slice(0, 32),
          tokenDecimals: Number(decimalsRes ?? 18),
        };
      } catch {
        tokenMetaMap[tokenAddr] = { tokenName: null, tokenSymbol: null, tokenDecimals: null };
      }
    }));

    const inserted = [];
    for (const { log, decoded } of lockEvents) {
      const lockId = String(decoded.args.id);
      const tokenAddress = String(decoded.args.token || "").toLowerCase();
      const beneficiaryAddress = String(decoded.args.beneficiary || "").toLowerCase();
      const amount = String(decoded.args.amount ?? "0");
      const unlockTime = String(decoded.args.unlockTime ?? "0");
      const logIndex = Number(log.logIndex || 0);
      const meta = tokenMetaMap[tokenAddress] || {};

      const [record, created] = await LpLockRecord.findOrCreate({
        where: { chainId, txHash, lockId },
        defaults: {
          chainId,
          contractAddress,
          lockId,
          ownerAddress,
          beneficiaryAddress,
          tokenAddress,
          amount,
          unlockTime,
          txHash,
          blockNumber,
          logIndex,
          tokenName:     meta.tokenName     ?? null,
          tokenSymbol:   meta.tokenSymbol   ?? null,
          tokenDecimals: meta.tokenDecimals ?? null,
        },
      });

      inserted.push({ lockId, created, dbId: String(record.id) });
    }

    res.json({ ok: true, inserted });
  } catch (e) {
    console.error("[lp-lock/index-tx]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

// ── GET /api/lp-lock/lock/:chainId/:lockId
// Returns static DB record. If tokenName is missing, lazy-fetches from chain and backfills.
router.get("/api/lp-lock/lock/:chainId/:lockId", async (req, res) => {
  const chainId = Number(req.params.chainId || "0");
  const lockId  = String(req.params.lockId  || "").trim();

  if (!chainId || !lockId) {
    res.status(400).json({ error: "Invalid chainId or lockId" });
    return;
  }

  try {
    await ensureDb();

    const record = await LpLockRecord.findOne({
      where: { chainId, lockId },
      order: [["id", "DESC"]],
    });

    if (!record) {
      res.status(404).json({ error: "Lock not found in database" });
      return;
    }

    // Lazy backfill: if token metadata is missing, fetch from chain and update
    if (record.tokenName == null && record.tokenAddress) {
      const rpcUrl = getRpcUrl(chainId);
      if (rpcUrl) {
        try {
          const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });
          const tokenAddr = record.tokenAddress;
          const [nameRes, symbolRes, decimalsRes] = await Promise.all([
            client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "name" }),
            client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "symbol" }),
            client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "decimals" }),
          ]);
          const patch = {
            tokenName:     String(nameRes    || "").slice(0, 64),
            tokenSymbol:   String(symbolRes  || "").slice(0, 32),
            tokenDecimals: Number(decimalsRes ?? 18),
          };
          await record.update(patch);
          console.log(`[lp-lock/lock] backfilled token metadata for lock ${lockId} on chain ${chainId}`);
        } catch (backfillErr) {
          console.warn("[lp-lock/lock] backfill failed:", backfillErr?.message);
          // non-fatal, continue with null values
        }
      }
    }

    res.json({
      record: {
        id:                 String(record.id),
        chainId:            record.chainId,
        contractAddress:    record.contractAddress,
        lockId:             record.lockId,
        ownerAddress:       record.ownerAddress,
        beneficiaryAddress: record.beneficiaryAddress,
        tokenAddress:       record.tokenAddress,
        amount:             record.amount,
        unlockTime:         record.unlockTime,
        txHash:             record.txHash,
        blockNumber:        String(record.blockNumber),
        tokenName:          record.tokenName   ?? null,
        tokenSymbol:        record.tokenSymbol ?? null,
        tokenDecimals:      record.tokenDecimals ?? null,
        createdAt:          record.createdAt,
      },
    });
  } catch (e) {
    console.error("[lp-lock/lock]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

export default router;
