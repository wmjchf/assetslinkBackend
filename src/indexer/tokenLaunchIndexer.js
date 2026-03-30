import "dotenv/config";
import { createPublicClient, http, decodeEventLog, decodeFunctionData } from "viem";
import { ensureDb } from "../db/init.js";
import { IndexerState } from "../db/models/IndexerState.js";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord.js";
import { TokenLaunchConfig } from "../db/models/TokenLaunchConfig.js";
import { TokenLaunchAllocation } from "../db/models/TokenLaunchAllocation.js";
import { verifyTokenOnEtherscan } from "../etherscan-verify.js";
import { TOKEN_FACTORY_EVENTS_ABI, TOKEN_FACTORY_FUNCTIONS_ABI } from "../tokenLaunch/factoryAbi.js";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function normalizeAllocLabel(s) {
  const v = String(s ?? "").trim();
  return v ? v.slice(0, 64) : null;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const rpcUrl = mustEnv("INDEXER_RPC_URL");
  const chainId = Number(mustEnv("INDEXER_CHAIN_ID"));
  const factoryAddress = mustEnv("INDEXER_TOKEN_FACTORY").toLowerCase();
  const startBlock = Number(process.env.INDEXER_START_BLOCK || "0");
  const pollMs = Number(process.env.INDEXER_POLL_MS || "5000");
  const batchBlocks = Number(process.env.INDEXER_BATCH_BLOCKS || "2000");

  await ensureDb();

  console.log(
    `[indexer] token-launch started | chainId=${chainId} factory=${factoryAddress} startBlock=${startBlock || "auto"} pollMs=${pollMs} batchBlocks=${batchBlocks}`
  );

  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 30_000 }),
  });

  const key = `tokenFactory:${chainId}:${factoryAddress}`;
  let loopCount = 0;

  while (true) {
    try {
      loopCount++;
      const latest = Number(await client.getBlockNumber());

      const state = await IndexerState.findOne({ where: { key } });
      const last = state?.lastBlock ?? 0;
      const from = Math.max(startBlock || 0, last > 0 ? last + 1 : 0);
      if (from === 0) {
        // If no checkpoint and no start block, default to latest (avoid scanning from genesis)
        const checkpoint = latest;
        await IndexerState.upsert({ key, lastBlock: checkpoint });
        console.log(
          `[indexer] no checkpoint/startBlock. Set checkpoint=${checkpoint}. (Set INDEXER_START_BLOCK to backfill history.)`
        );
        await sleep(pollMs);
        continue;
      }

      if (from > latest) {
        await sleep(pollMs);
        continue;
      }

      const to = Math.min(latest, from + batchBlocks);

      const logs = await client.getLogs({
        address: factoryAddress,
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
      });
      // Sort for deterministic processing
      logs.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return Number(a.blockNumber - b.blockNumber);
        return (a.logIndex ?? 0) - (b.logIndex ?? 0);
      });

      let createdCount = 0;

      const decodedEvents = [];
      for (const l of logs) {
        try {
          const decoded = decodeEventLog({
            abi: TOKEN_FACTORY_EVENTS_ABI,
            data: l.data,
            topics: l.topics,
          });
          decodedEvents.push({ log: l, decoded });
        } catch {
          // ignore
        }
      }

      // Pass 1: TokenCreated (record shell)
      for (const e of decodedEvents) {
        const { decoded, log: l } = e;
        if (decoded?.eventName !== "TokenCreated") continue;
        const creator = String(decoded?.args?.creator || "").toLowerCase();
        const token = String(decoded?.args?.token || "").toLowerCase();
        const txHash = String(l.transactionHash || "").toLowerCase();
        const blockNumber = Number(l.blockNumber || 0);
        const logIndex = Number(l.logIndex || 0);
        if (!creator || !token || !txHash) continue;

        const [, isNew] = await TokenLaunchRecord.findOrCreate({
          where: { chainId, txHash },
          defaults: {
            chainId,
            factoryAddress,
            creatorAddress: creator,
            txHash,
            tokenAddress: token,
            blockNumber,
            logIndex,
          },
        });
        console.log(isNew,'TokenLaunchRecord');
        if (isNew) createdCount++;

        // Decode tx calldata to store config + allocations (idempotent)
        try {
          const tx = await client.getTransaction({ hash: txHash });
          const input = String(tx?.input || "");
          if (input && input !== "0x") {
            const decodedFn = decodeFunctionData({
              abi: TOKEN_FACTORY_FUNCTIONS_ABI,
              data: input,
            });

            const fn = String(decodedFn?.functionName || "");
            const args = decodedFn?.args || [];
            const cfg = args?.[0] || {};
            const fees = cfg?.fees || {};
            const limits = cfg?.limits || {};

            await TokenLaunchConfig.findOrCreate({
              where: { chainId, txHash },
              defaults: {
                chainId,
                txHash,
                tokenAddress: token,
                factoryAddress,
                creatorAddress: creator,
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
console.log('TokenLaunchConfig');
            verifyTokenOnEtherscan(chainId, token, {
              factoryAddress,
              name: String(cfg?.name || ""),
              symbol: String(cfg?.symbol || ""),
              totalSupplyRaw: String(cfg?.totalSupplyRaw ?? "0"),
              decimals: 18,
            })
              .then((r) => {
                console.log(`[verify] token=${token} status=${r.status}${r.message ? " msg=" + r.message : ""}`);
              })
              .catch((e) => {
                console.warn("[verify] error:", e?.message || e);
              });

            const recipients = fn === "createTokenWithDistribution" ? (args?.[1] || []) : [];
            const amounts = fn === "createTokenWithDistribution" ? (args?.[2] || []) : [];
            const labelsOnChain =
              fn === "createTokenWithDistribution" && Array.isArray(args?.[3]) ? args[3] : [];

            let sum = BigInt(0);
            for (let i = 0; i < recipients.length; i++) {
              const toAddr = String(recipients[i] || "").toLowerCase();
              const amt = BigInt(String(amounts[i] ?? "0"));
              sum += amt;
              await TokenLaunchAllocation.findOrCreate({
                where: { chainId, txHash, allocIndex: i },
                defaults: {
                  chainId,
                  txHash,
                  tokenAddress: token,
                  toAddress: toAddr,
                  amount: amt.toString(),
                  allocationType: "immediate",
                  allocIndex: i,
                  label: normalizeAllocLabel(labelsOnChain[i]),
                },
              });
            }

            // creator remaining = totalSupplyRaw - sum
            const totalSupplyRaw = BigInt(String(cfg?.totalSupplyRaw ?? "0"));
            const remaining = totalSupplyRaw > sum ? totalSupplyRaw - sum : BigInt(0);
            if (remaining > BigInt(0)) {
              await TokenLaunchAllocation.findOrCreate({
                where: { chainId, txHash, allocIndex: 999999 },
                defaults: {
                  chainId,
                  txHash,
                  tokenAddress: token,
                  toAddress: creator,
                  amount: remaining.toString(),
                  allocationType: "creator_remaining",
                  allocIndex: 999999,
                },
              });
            }
          }
        } catch {
          // ignore decoding failures (will retry next loop)
        }
      }

      await IndexerState.upsert({ key, lastBlock: to });

      // Log progress: always when we found logs, otherwise every ~10 loops.
      if (logs.length > 0 || loopCount % 10 === 0) {
        console.log(
          `[indexer] scanned ${from}..${to} logs=${logs.length} created=${createdCount} checkpoint=${to}/${latest}`
        );
      }
    } catch (e) {
      console.error("Indexer loop error:", e);
      await sleep(Math.min(30_000, pollMs * 2));
    }

    await sleep(pollMs);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

