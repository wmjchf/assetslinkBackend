import express from "express";
import { ensureDb } from "../db/init.js";
import { CommunityUser } from "../db/models/CommunityUser.js";

const router = express.Router();

/**
 * Server-to-server: after Next.js SIWE login, upsert community_users.
 * Header: x-internal-secret: INTERNAL_API_SECRET
 * Body: { address: "0x..." } (checksum or lower OK, stored lower)
 */
router.post("/api/internal/community/upsert-user", async (req, res) => {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected || req.headers["x-internal-secret"] !== expected) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const raw = String(req.body?.address || "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(raw)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  try {
    await ensureDb();
    await CommunityUser.upsert({
      address: raw,
      lastLoginAt: new Date(),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[upsert-user]", e);
    res.status(500).json({ error: e?.message || "Internal error" });
  }
});

export default router;
