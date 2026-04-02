import express from "express";
import { ensureDb } from "../db/init.js";
import { AirdropRoundRecord } from "../db/models/AirdropRoundRecord.js";
import { AirdropFundRecord } from "../db/models/AirdropFundRecord.js";

const router = express.Router();

function normalizeAddress(v) {
  return String(v || "").trim().toLowerCase();
}

router.post("/api/airdrop/index-round", async (req, res) => {
  try {
    await ensureDb();
    const body = req.body || {};

    const chainId = Number(body.chainId || 0);
    const roundId = String(body.roundId || "");
    const distributorAddress = normalizeAddress(body.distributorAddress);
    const ownerAddress = normalizeAddress(body.ownerAddress);
    const tokenAddress = normalizeAddress(body.tokenAddress);
    const merkleRoot = String(body.merkleRoot || "").trim();
    const startAt = Number(body.startAt || 0);
    const endAt = Number(body.endAt || 0);
    const totalAmount = String(body.totalAmount || "");
    const createTxHash = normalizeAddress(body.createTxHash);
    const blockNumber = body.blockNumber != null ? Number(body.blockNumber) : null;
    const roundNameRaw = typeof body.roundName === "string" ? body.roundName.trim().slice(0, 200) : "";
    const roundName = roundNameRaw || null;

    if (
      !chainId ||
      !roundId ||
      !distributorAddress.startsWith("0x") ||
      !ownerAddress.startsWith("0x") ||
      !tokenAddress.startsWith("0x") ||
      !/^0x[0-9a-fA-F]{64}$/.test(merkleRoot) ||
      !startAt ||
      !endAt ||
      !totalAmount ||
      !createTxHash.startsWith("0x")
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const [record, created] = await AirdropRoundRecord.findOrCreate({
      where: { chainId, distributorAddress, roundId },
      defaults: {
        chainId,
        roundId,
        distributorAddress,
        ownerAddress,
        tokenAddress,
        merkleRoot,
        startAt,
        endAt,
        totalAmount,
        createTxHash,
        blockNumber,
        status: "created",
        roundName,
      },
    });

    if (roundName != null) {
      record.roundName = roundName;
      await record.save();
    }

    const merkleClaims = body.merkleClaims;
    if (merkleClaims && typeof merkleClaims === "object" && merkleClaims !== null) {
      const rootFromClaims = String(merkleClaims.root || "").toLowerCase();
      if (rootFromClaims && rootFromClaims === merkleRoot.toLowerCase()) {
        record.claimsJson = JSON.stringify(merkleClaims);
        await record.save();
      }
    }

    return res.json({ ok: true, created, id: String(record.id) });
  } catch (e) {
    console.error("[airdrop/index-round]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.post("/api/airdrop/index-fund", async (req, res) => {
  try {
    await ensureDb();
    const body = req.body || {};

    const chainId = Number(body.chainId || 0);
    const roundId = String(body.roundId || "");
    const distributorAddress = normalizeAddress(body.distributorAddress);
    const tokenAddress = normalizeAddress(body.tokenAddress);
    const funderAddress = normalizeAddress(body.funderAddress);
    const amount = String(body.amount || "");
    const txHash = normalizeAddress(body.txHash);
    const blockNumber = body.blockNumber != null ? Number(body.blockNumber) : null;

    if (
      !chainId ||
      !roundId ||
      !distributorAddress.startsWith("0x") ||
      !tokenAddress.startsWith("0x") ||
      !funderAddress.startsWith("0x") ||
      !amount ||
      !txHash.startsWith("0x")
    ) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const [record, created] = await AirdropFundRecord.findOrCreate({
      where: { chainId, txHash, roundId },
      defaults: {
        chainId,
        roundId,
        distributorAddress,
        tokenAddress,
        funderAddress,
        amount,
        txHash,
        blockNumber,
      },
    });

    const round = await AirdropRoundRecord.findOne({ where: { chainId, distributorAddress, roundId } });
    if (round) {
      round.status = "funded";
      await round.save();
    }

    return res.json({ ok: true, created, id: String(record.id) });
  } catch (e) {
    console.error("[airdrop/index-fund]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.get("/api/airdrop/round", async (req, res) => {
  try {
    await ensureDb();
    const chainId = Number(req.query.chainId || 0);
    const roundId = String(req.query.roundId || "");
    if (!chainId || !roundId) return res.status(400).json({ error: "Missing chainId/roundId" });

    const round = await AirdropRoundRecord.findOne({
      where: { chainId, roundId },
      order: [["id", "DESC"]],
    });
    if (!round) return res.status(404).json({ error: "Round not found" });

    const funds = await AirdropFundRecord.findAll({
      where: { chainId, roundId, distributorAddress: round.distributorAddress },
      order: [["id", "DESC"]],
      limit: 100,
    });

    return res.json({
      round: {
        id: String(round.id),
        chainId: round.chainId,
        roundId: String(round.roundId),
        distributorAddress: String(round.distributorAddress),
        ownerAddress: String(round.ownerAddress),
        tokenAddress: String(round.tokenAddress),
        merkleRoot: String(round.merkleRoot),
        startAt: Number(round.startAt),
        endAt: Number(round.endAt),
        totalAmount: String(round.totalAmount),
        createTxHash: String(round.createTxHash),
        blockNumber: round.blockNumber != null ? Number(round.blockNumber) : null,
        status: String(round.status),
        roundName: round.roundName != null ? String(round.roundName) : null,
        createdAt: round.createdAt,
      },
      funds: funds.map((f) => ({
        id: String(f.id),
        funderAddress: String(f.funderAddress),
        amount: String(f.amount),
        txHash: String(f.txHash),
        blockNumber: f.blockNumber != null ? Number(f.blockNumber) : null,
        createdAt: f.createdAt,
      })),
    });
  } catch (e) {
    console.error("[airdrop/round]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.get("/api/airdrop/merkle-claims", async (req, res) => {
  try {
    await ensureDb();
    const chainId = Number(req.query.chainId || 0);
    const roundId = String(req.query.roundId || "").trim();
    const distributor = normalizeAddress(req.query.distributor);
    if (!chainId || !roundId || !distributor.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid chainId, roundId, or distributor" });
    }
    const round = await AirdropRoundRecord.findOne({
      where: { chainId, distributorAddress: distributor, roundId },
    });
    const raw = round?.claimsJson ? String(round.claimsJson).trim() : "";
    if (!raw) {
      return res.status(404).json({ error: "Merkle data not found for this round" });
    }
    try {
      return res.json(JSON.parse(raw));
    } catch {
      return res.status(500).json({ error: "Invalid stored Merkle JSON" });
    }
  } catch (e) {
    console.error("[airdrop/merkle-claims]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.get("/api/airdrop/by-token", async (req, res) => {
  try {
    await ensureDb();
    const chainId = Number(req.query.chainId || 0);
    const tokenAddress = normalizeAddress(req.query.tokenAddress);
    if (!chainId || !tokenAddress.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid chainId or tokenAddress" });
    }

    const rows = await AirdropRoundRecord.findAll({
      where: { chainId, tokenAddress },
      order: [["id", "DESC"]],
      limit: 200,
    });
    return res.json({
      records: rows.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        roundId: String(r.roundId),
        distributorAddress: String(r.distributorAddress),
        ownerAddress: String(r.ownerAddress),
        tokenAddress: String(r.tokenAddress),
        merkleRoot: String(r.merkleRoot),
        startAt: Number(r.startAt),
        endAt: Number(r.endAt),
        totalAmount: String(r.totalAmount),
        createTxHash: String(r.createTxHash),
        status: String(r.status),
        roundName: r.roundName != null ? String(r.roundName) : null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[airdrop/by-token]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

router.get("/api/airdrop/my-rounds", async (req, res) => {
  try {
    await ensureDb();
    const address = normalizeAddress(req.query.address);
    const chainId = Number(req.query.chainId || 0);
    if (!address || !address.startsWith("0x")) return res.status(400).json({ error: "Invalid address" });

    const where = { ownerAddress: address };
    if (chainId) where.chainId = chainId;

    const rows = await AirdropRoundRecord.findAll({
      where,
      order: [["id", "DESC"]],
      limit: 200,
    });
    return res.json({
      records: rows.map((r) => ({
        id: String(r.id),
        chainId: r.chainId,
        roundId: String(r.roundId),
        distributorAddress: String(r.distributorAddress),
        ownerAddress: String(r.ownerAddress),
        tokenAddress: String(r.tokenAddress),
        merkleRoot: String(r.merkleRoot),
        startAt: Number(r.startAt),
        endAt: Number(r.endAt),
        totalAmount: String(r.totalAmount),
        createTxHash: String(r.createTxHash),
        status: String(r.status),
        roundName: r.roundName != null ? String(r.roundName) : null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    console.error("[airdrop/my-rounds]", e);
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
});

export default router;

