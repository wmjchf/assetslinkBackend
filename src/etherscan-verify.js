/**
 * Etherscan source-code verification for SafeLaunchToken.
 *
 * Called by the indexer after each TokenCreated event.
 * Submits the Standard JSON Input (from hardhat build-info) + ABI-encoded
 * constructor args to Etherscan's verifysourcecode API so the token shows
 * as verified and GoPlus marks is_open_source = 1.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { encodeAbiParameters, parseAbiParameters } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Hardhat build-info lives two levels up from backend/src/
const BUILD_INFO_DIR = path.resolve(__dirname, "../hardhat/artifacts/build-info");
// Etherscan API V2: single endpoint, chainid= param selects the network.
// Supported chainIds: https://docs.etherscan.io/v2-migration
const ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api";
const SUPPORTED_CHAIN_IDS = new Set([1, 11155111, 8453, 84532, 56, 97, 42161, 10]);

// The exact sources key Etherscan expects in the Standard JSON Input
const CONTRACT_SOURCE_KEY = "contracts/launch/SafeLaunchToken.sol";

// Scan all build-info files (newest first) and return the first one
// that actually contains SafeLaunchToken.sol — avoids picking up stale
// build-info files from other contracts (e.g. SafeLaunchTokenUpgradeable).
function loadBuildInfo() {
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
      if (data?.input?.sources?.[CONTRACT_SOURCE_KEY]) {
        console.log(`[etherscan-verify] Using build-info: ${f}`);
        return { input: data.input, solcLongVersion: data.solcLongVersion };
      }
    } catch {
      // skip unreadable files
    }
  }

  console.error(`[etherscan-verify] No build-info contains "${CONTRACT_SOURCE_KEY}". Available files:`);
  files.forEach(({ f }) => {
    try {
      const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(BUILD_INFO_DIR, f), "utf8"))?.input?.sources ?? {});
      console.error(`  ${f}: ${keys.filter(k => k.startsWith("contracts/")).join(", ")}`);
    } catch { /**/ }
  });
  return null;
}

// ABI-encode SafeLaunchToken constructor arguments
function encodeConstructorArgs(initialOwner, name, symbol, totalSupplyRaw, marketingWallet, buyFeeBps, sellFeeBps) {
  const encoded = encodeAbiParameters(
    parseAbiParameters("address, string, string, uint256, address, uint16, uint16"),
    [initialOwner, name, symbol, BigInt(totalSupplyRaw), marketingWallet, buyFeeBps, sellFeeBps]
  );
  return encoded.slice(2); // remove "0x"
}

async function submitVerification(chainId, apiKey, tokenAddress, sourceInput, solcLongVersion, constructorArguments) {
  // chainid must be a URL query param in V2, NOT in the POST body
  const endpoint = `${ETHERSCAN_V2_URL}?chainid=${chainId}`;

  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    contractaddress: tokenAddress,
    sourceCode: JSON.stringify(sourceInput),
    codeformat: "solidity-standard-json-input",
    contractname: "contracts/launch/SafeLaunchToken.sol:SafeLaunchToken",
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

/**
 * @param {number} chainId
 * @param {string} tokenAddress
 * @param {{ factoryAddress: string, name: string, symbol: string,
 *           totalSupplyRaw: string|bigint, marketingWallet: string,
 *           buyFeeBps: number, sellFeeBps: number }} args
 */
export async function verifyTokenOnEtherscan(chainId, tokenAddress, args) {
  if (!SUPPORTED_CHAIN_IDS.has(chainId)) {
    return { status: "skipped", message: `chainId ${chainId} not supported by Etherscan V2` };
  }
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) return { status: "skipped", message: "ETHERSCAN_API_KEY not set" };
  const buildInfo = loadBuildInfo();
  if (!buildInfo) return { status: "skipped", message: "build-info not found" };
  const constructorArguments = encodeConstructorArgs(
    args.factoryAddress,
    args.name,
    args.symbol,
    args.totalSupplyRaw,
    args.marketingWallet,
    args.buyFeeBps,
    args.sellFeeBps
  );
  // Wait for Etherscan to index the deployment before submitting verification.
  // Without this delay "Unable to locate ContractCode" is returned.
  const initialDelayMs = Number(process.env.ETHERSCAN_VERIFY_DELAY_MS ?? 30_000);
  await new Promise((r) => setTimeout(r, initialDelayMs));
  // Retry submit up to 3 times in case Etherscan still hasn't indexed the contract.
  let guid;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      guid = await submitVerification(
        chainId, apiKey, tokenAddress,
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
    return { status };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes("already verified")) return { status: "already_verified" };
    return { status: "skipped", message: msg };
  }
}
