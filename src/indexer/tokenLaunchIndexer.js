import "dotenv/config";
import { createPublicClient, http, decodeEventLog, decodeFunctionData } from "viem";
import { ensureDb } from "../db/init.js";
import { IndexerState } from "../db/models/IndexerState.js";
import { TokenLaunchRecord } from "../db/models/TokenLaunchRecord.js";
import { TokenLaunchVestingVault } from "../db/models/TokenLaunchVestingVault.js";
import { TokenLaunchConfig } from "../db/models/TokenLaunchConfig.js";
import { TokenLaunchAllocation } from "../db/models/TokenLaunchAllocation.js";

const TOKEN_FACTORY_EVENTS_ABI = [
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "token", type: "address" },
    ],
  },
  {
    type: "event",
    name: "VestingCreated",
    inputs: [
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "vault", type: "address" },
      { indexed: true, name: "beneficiary", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
];

const TOKEN_FACTORY_FUNCTIONS_ABI = [
  {
    type: "function",
    name: "createToken",
    stateMutability: "payable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "totalSupplyRaw", type: "uint256" },
          { name: "marketingWallet", type: "address" },
          {
            name: "fees",
            type: "tuple",
            components: [
              { name: "buyMarketingBps", type: "uint16" },
              { name: "buyLiquidityBps", type: "uint16" },
              { name: "buyBurnBps", type: "uint16" },
              { name: "sellMarketingBps", type: "uint16" },
              { name: "sellLiquidityBps", type: "uint16" },
              { name: "sellBurnBps", type: "uint16" },
            ],
          },
          {
            name: "limits",
            type: "tuple",
            components: [
              { name: "maxGasPriceWei", type: "uint256" },
              { name: "deadBlocks", type: "uint256" },
              { name: "revertEarlyBuys", type: "bool" },
              { name: "maxTxAmount", type: "uint256" },
              { name: "maxWalletAmount", type: "uint256" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "tokenAddr", type: "address" }],
  },
  {
    type: "function",
    name: "createTokenWithDistribution",
    stateMutability: "payable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "totalSupplyRaw", type: "uint256" },
          { name: "marketingWallet", type: "address" },
          {
            name: "fees",
            type: "tuple",
            components: [
              { name: "buyMarketingBps", type: "uint16" },
              { name: "buyLiquidityBps", type: "uint16" },
              { name: "buyBurnBps", type: "uint16" },
              { name: "sellMarketingBps", type: "uint16" },
              { name: "sellLiquidityBps", type: "uint16" },
              { name: "sellBurnBps", type: "uint16" },
            ],
          },
          {
            name: "limits",
            type: "tuple",
            components: [
              { name: "maxGasPriceWei", type: "uint256" },
              { name: "deadBlocks", type: "uint256" },
              { name: "revertEarlyBuys", type: "bool" },
              { name: "maxTxAmount", type: "uint256" },
              { name: "maxWalletAmount", type: "uint256" },
            ],
          },
        ],
      },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [{ name: "tokenAddr", type: "address" }],
  },
  {
    type: "function",
    name: "createTokenWithDistributionAndVesting",
    stateMutability: "payable",
    inputs: [
      {
        name: "cfg",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "totalSupplyRaw", type: "uint256" },
          { name: "marketingWallet", type: "address" },
          {
            name: "fees",
            type: "tuple",
            components: [
              { name: "buyMarketingBps", type: "uint16" },
              { name: "buyLiquidityBps", type: "uint16" },
              { name: "buyBurnBps", type: "uint16" },
              { name: "sellMarketingBps", type: "uint16" },
              { name: "sellLiquidityBps", type: "uint16" },
              { name: "sellBurnBps", type: "uint16" },
            ],
          },
          {
            name: "limits",
            type: "tuple",
            components: [
              { name: "maxGasPriceWei", type: "uint256" },
              { name: "deadBlocks", type: "uint256" },
              { name: "revertEarlyBuys", type: "bool" },
              { name: "maxTxAmount", type: "uint256" },
              { name: "maxWalletAmount", type: "uint256" },
            ],
          },
        ],
      },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
      {
        name: "vestings",
        type: "tuple[]",
        components: [
          { name: "beneficiary", type: "address" },
          { name: "start", type: "uint64" },
          { name: "cliffSeconds", type: "uint64" },
          { name: "durationSeconds", type: "uint64" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "tokenAddr", type: "address" }],
  },
];

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
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
      let vaultInserted = 0;

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

            // allocations (only for distribution functions)
            const recipients =
              fn === "createTokenWithDistribution" || fn === "createTokenWithDistributionAndVesting"
                ? (args?.[1] || [])
                : [];
            const amounts =
              fn === "createTokenWithDistribution" || fn === "createTokenWithDistributionAndVesting"
                ? (args?.[2] || [])
                : [];
            const vestings = fn === "createTokenWithDistributionAndVesting" ? (args?.[3] || []) : [];

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
                },
              });
            }

            // vesting totals (remaining calc)
            for (const v of vestings) {
              const amt = BigInt(String(v?.amount ?? "0"));
              sum += amt;
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

      // Pass 2: VestingCreated (insert into separate table)
      for (const e of decodedEvents) {
        const { decoded, log: l } = e;
        if (decoded?.eventName !== "VestingCreated") continue;
        const token = String(decoded?.args?.token || "").toLowerCase();
        const vault = String(decoded?.args?.vault || "").toLowerCase();
        const beneficiary = String(decoded?.args?.beneficiary || "").toLowerCase();
        const amount = String(decoded?.args?.amount || "0");
        const txHash = String(l.transactionHash || "").toLowerCase();
        const blockNumber = Number(l.blockNumber || 0);
        const logIndex = Number(l.logIndex || 0);
        if (!token || !vault || !beneficiary || !txHash) continue;

        await TokenLaunchVestingVault.findOrCreate({
          where: { chainId, txHash, vaultAddress: vault },
          defaults: {
            chainId,
            txHash,
            tokenAddress: token,
            vaultAddress: vault,
            beneficiary,
            amount,
            blockNumber,
            logIndex,
          },
        });
        vaultInserted++;
      }

      // Pass 3: Patch vesting schedules from calldata -> match by order inside tx
      try {
        const txHashesInBatch = Array.from(
          new Set(
            decodedEvents
              .filter((x) => x.decoded?.eventName === "VestingCreated")
              .map((x) => String(x.log?.transactionHash || "").toLowerCase())
              .filter(Boolean)
          )
        );
        for (const txHash of txHashesInBatch) {
          const tx = await client.getTransaction({ hash: txHash });
          const input = String(tx?.input || "");
          if (!input || input === "0x") continue;
          const decodedFn = decodeFunctionData({
            abi: TOKEN_FACTORY_FUNCTIONS_ABI,
            data: input,
          });
          if (decodedFn?.functionName !== "createTokenWithDistributionAndVesting") continue;
          const vestings = decodedFn?.args?.[3] || [];
          if (!Array.isArray(vestings) || vestings.length === 0) continue;

          const txVestingEvents = decodedEvents
            .filter(
              (x) =>
                x.decoded?.eventName === "VestingCreated" &&
                String(x.log?.transactionHash || "").toLowerCase() === txHash
            )
            .sort((a, b) => (a.log?.logIndex ?? 0) - (b.log?.logIndex ?? 0));

          const n = Math.min(vestings.length, txVestingEvents.length);
          for (let i = 0; i < n; i++) {
            const vInput = vestings[i] || {};
            const vaultAddr = String(txVestingEvents[i]?.decoded?.args?.vault || "").toLowerCase();
            if (!vaultAddr) continue;
            await TokenLaunchVestingVault.update(
              {
                vestingStart: String(vInput?.start ?? ""),
                vestingCliffSeconds: String(vInput?.cliffSeconds ?? ""),
                vestingDurationSeconds: String(vInput?.durationSeconds ?? ""),
                vestingIndex: i,
              },
              { where: { chainId, txHash, vaultAddress: vaultAddr } }
            );
          }
        }
      } catch {
        // ignore
      }

      await IndexerState.upsert({ key, lastBlock: to });

      // Log progress: always when we found logs, otherwise every ~10 loops.
      if (logs.length > 0 || loopCount % 10 === 0) {
        console.log(
          `[indexer] scanned ${from}..${to} logs=${logs.length} created=${createdCount} vestingInserted=${vaultInserted} checkpoint=${to}/${latest}`
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

