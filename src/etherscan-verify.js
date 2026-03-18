/**
 * Etherscan source-code verification for SafeLaunchToken and LinearVestingVault.
 *
 * Called after each TokenCreated / VestingCreated event.
 * Submits the Standard JSON Input (from hardhat build-info) + ABI-encoded
 * constructor args to Etherscan's verifysourcecode API.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_INFO_DIR = path.resolve(__dirname, "../hardhat/artifacts/build-info");
const ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api";
const SUPPORTED_CHAIN_IDS = new Set([1, 11155111, 8453, 84532, 56, 97, 42161, 10]);

// ── Build-info loader ────────────────────────────────────────────────────────

/**
 * Walk the compiler AST to collect the set of source keys transitively
 * imported by `startKey`. Uses `absolutePath` from ImportDirective nodes,
 * which is already resolved by the Solidity compiler — no manual path math.
 */
function collectNeededSources(outputSources, inputSources, startKey) {
  const needed = new Set();
  const queue = [startKey];

  while (queue.length > 0) {
    const key = queue.shift();
    if (needed.has(key)) continue;
    needed.add(key);

    const ast = outputSources?.[key]?.ast;
    if (!ast) continue;

    for (const node of ast.nodes ?? []) {
      if (node.nodeType !== "ImportDirective") continue;
      const dep = node.absolutePath;
      if (dep && inputSources[dep] && !needed.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return needed;
}

function loadBuildInfo(contractSourceKey) {
  if (!fs.existsSync(BUILD_INFO_DIR)) {
    console.error(`[etherscan-verify] BUILD_INFO_DIR not found: ${BUILD_INFO_DIR}`);
    return null;
  }

  const files = fs
    .readdirSync(BUILD_INFO_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BUILD_INFO_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) {
    console.error(`[etherscan-verify] No build-info JSON files in: ${BUILD_INFO_DIR}`);
    return null;
  }

  for (const { f } of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf8"));
      if (!data?.input?.sources?.[contractSourceKey]) continue;

      console.log(`[etherscan-verify] Using build-info: ${f} (for ${contractSourceKey})`);

      // Filter sources to only the files actually needed by contractSourceKey.
      // This prevents unrelated contracts from appearing on Etherscan's Sources tab.
      const needed = collectNeededSources(data.output?.sources, data.input.sources, contractSourceKey);
      const filteredInput = {
        ...data.input,
        sources: Object.fromEntries(
          Object.entries(data.input.sources).filter(([k]) => needed.has(k))
        ),
      };

      console.log(
        `[etherscan-verify] Sources: ${needed.size} needed / ${Object.keys(data.input.sources).length} total`
      );

      return { input: filteredInput, solcLongVersion: data.solcLongVersion };
    } catch {
      // skip unreadable files
    }
  }

  console.error(`[etherscan-verify] No build-info contains "${contractSourceKey}". Available files:`);
  files.forEach(({ f }) => {
    try {
      const keys = Object.keys(
        JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf8"))?.input?.sources ?? {}
      );
      console.error(`  ${f}: ${keys.filter((k) => k.startsWith("contracts/")).join(", ")}`);
    } catch { /**/ }
  });
  return null;
}

// ── Etherscan API helpers ────────────────────────────────────────────────────

async function submitVerification(chainId, apiKey, contractAddress, contractName, sourceInput, solcLongVersion, constructorArguments) {
  const endpoint = `${ETHERSCAN_V2_URL}?chainid=${chainId}`;
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: contractAddress,
    sourceCode: JSON.stringify(sourceInput),
    codeformat: "solidity-standard-json-input",
    contractname: contractName,
    compilerversion: `v${solcLongVersion}`,
    constructorArguements: constructorArguments,
    apikey: apiKey,
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json();
  if (json.status !== "1") throw new Error(`submit failed: ${json.result || json.message}`);
  return String(json.result); // guid
}

async function pollResult(chainId, apiKey, guid, maxAttempts = 10, intervalMs = 5000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const url = `${ETHERSCAN_V2_URL}?chainid=${chainId}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;
    const res = await fetch(url);
    const json = await res.json();
    const result = String(json.result || "");
    if (result === "Pass - Verified") return "verified";
    if (result === "Already Verified") return "already_verified";
    if (result.includes("Fail")) throw new Error(`verification failed: ${result}`);
  }
  return "pending";
}

async function verifyContract(chainId, contractAddress, contractName, sourceKey, constructorArguments) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return { status: "skipped", message: "ETHERSCAN_API_KEY not set" };

  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    return { status: "skipped", message: `chainId ${chainId} not supported by Etherscan V2` };
  }

  const buildInfo = loadBuildInfo(sourceKey);
  if (!buildInfo) return { status: "skipped", message: "build-info not found" };

  const initialDelayMs = Number(process.env.ETHERSCAN_VERIFY_DELAY_MS ?? 30_000);
  await new Promise((r) => setTimeout(r, initialDelayMs));

  let guid;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      guid = await submitVerification(
        chainId, apiKey, contractAddress, contractName,
        buildInfo.input, buildInfo.solcLongVersion, constructorArguments
      );
      break;
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.toLowerCase().includes("already verified")) return { status: "already_verified" };
      const isNotFound = msg.toLowerCase().includes("unable to locate");
      if (isNotFound && attempt < 3) {
        console.warn(`[etherscan-verify] contract not yet indexed, retrying in 15s (attempt ${attempt}/3)…`);
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      return { status: "skipped", message: msg };
    }
  }

  try {
    const status = await pollResult(chainId, apiKey, guid);
    console.log(`[etherscan-verify] ${contractName} @ ${contractAddress} → ${status}`);
    return { status };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("already verified")) return { status: "already_verified" };
    return { status: "skipped", message: msg };
  }
}

// ── SafeLaunchToken ──────────────────────────────────────────────────────────

/**
 * @param {number} chainId
 * @param {string} tokenAddress
 * @param {{ factoryAddress: string, name: string, symbol: string,
 *           totalSupplyRaw: string|bigint, decimals: number }} args
 */
export async function verifyTokenOnEtherscan(chainId, tokenAddress, args) {
  const constructorArguments = encodeAbiParameters(
    parseAbiParameters("address, string, string, uint256, uint8"),
    [
      args.factoryAddress,
      args.name,
      args.symbol,
      BigInt(args.totalSupplyRaw),
      args.decimals ?? 18,
    ]
  ).slice(2);

  return verifyContract(
    chainId,
    tokenAddress,
    "contracts/launch/SafeLaunchToken.sol:SafeLaunchToken",
    "contracts/launch/SafeLaunchToken.sol",
    constructorArguments
  );
}

// ── LinearVestingVault ───────────────────────────────────────────────────────

/**
 * @param {number} chainId
 * @param {string} vaultAddress
 * @param {{ tokenAddress: string, beneficiary: string, start: string|bigint,
 *           cliffSeconds: string|bigint, durationSeconds: string|bigint,
 *           totalAllocation: string|bigint }} args
 */
export async function verifyVestingVaultOnEtherscan(chainId, vaultAddress, args) {
  const constructorArguments = encodeAbiParameters(
    parseAbiParameters("address, address, uint64, uint64, uint64, uint256"),
    [
      args.tokenAddress,
      args.beneficiary,
      BigInt(args.start ?? 0),
      BigInt(args.cliffSeconds ?? 0),
      BigInt(args.durationSeconds ?? 0),
      BigInt(args.totalAllocation),
    ]
  ).slice(2);

  return verifyContract(
    chainId,
    vaultAddress,
    "contracts/launch/LinearVestingVault.sol:LinearVestingVault",
    "contracts/launch/LinearVestingVault.sol",
    constructorArguments
  );
}
