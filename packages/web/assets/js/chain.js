// Every value on the page is read from chain in the visitor's own browser. This module is
// the only place that talks to an RPC node. Results are cached in sessionStorage; if the
// node is unreachable the caller falls back to the committed snapshot behind a dated banner.

const TTL_MS = 5 * 60 * 1000;
const BALANCE_OF = "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e";
const GET_SHADOW_ACCOUNTS = "0x21108f52038fd171399fadd200a5243018cee55ae27e6a44e948df18d4b779f";

export const BALANCE_OF_SELECTOR = BALANCE_OF;
export const GET_SHADOW_ACCOUNTS_SELECTOR = GET_SHADOW_ACCOUNTS;

function hex(value) {
  const numeric = BigInt(value);
  if (numeric < 0n) throw new RangeError("felt values must be non-negative.");
  return `0x${numeric.toString(16)}`;
}

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t > TTL_MS ? null : v;
  } catch { return null; }
}

function cacheSet(key, v) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* private mode */ }
}

export function createChain(networks) {
  let id = 0;

  async function rpc(network, method, params = [], useCache = true) {
    const key = `facet:${network}:${method}:${JSON.stringify(params)}`;
    if (useCache) {
      const hit = cacheGet(key);
      if (hit !== null) return hit;
    }
    const url = networks[network].rpc;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    if (useCache) cacheSet(key, body.result);
    return body.result;
  }

  return {
    rpc,
    async head(network) {
      const n = await rpc(network, "starknet_blockNumber");
      const block = await rpc(network, "starknet_getBlockWithTxHashes", [{ block_number: n }]);
      return { number: n, timestamp: block.timestamp };
    },
    receipt: (network, hash) => rpc(network, "starknet_getTransactionReceipt", [hash]),
    classHashAt: (network, address) => rpc(network, "starknet_getClassHashAt", ["latest", address]),
    async shadowAccounts(network, anonymizer, partialCommitment, nonce = 0) {
      const start = BigInt(nonce);
      if (start < 0n || start > BigInt(Number.MAX_SAFE_INTEGER - 1)) {
        throw new RangeError("Shadow-account nonce must be a safe non-negative integer.");
      }
      const result = await rpc(network, "starknet_call", [{
        contract_address: anonymizer,
        entry_point_selector: GET_SHADOW_ACCOUNTS,
        calldata: [
          hex(partialCommitment),
          hex(start),
          hex(start + 1n),
          "0x0",
        ],
      }, "latest"], false);
      return decodeShadowAccounts(result);
    },
    async balanceOf(network, token, address) {
      const r = await rpc(network, "starknet_call", [
        { contract_address: token, entry_point_selector: BALANCE_OF, calldata: [address] },
        "latest",
      ]);
      return BigInt(r[0]) + (BigInt(r[1] ?? 0) << 128n);
    },
  };
}

/** Decode the ABI serialization of Span<ShadowAccountInfo> returned by the anonymizer view. */
export function decodeShadowAccounts(result) {
  if (!Array.isArray(result)) throw new TypeError("Shadow-account view returned malformed data.");
  let count;
  try { count = Number(BigInt(result[0] ?? "0")); } catch {
    throw new TypeError("Shadow-account view returned an invalid length.");
  }
  if (!Number.isSafeInteger(count) || count < 0 || result.length < 1 + count * 3) {
    throw new TypeError("Shadow-account view returned an invalid account span.");
  }
  const accounts = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 1 + index * 3;
    let nonce;
    let address;
    let deployed;
    try {
      nonce = BigInt(result[offset]);
      address = hex(result[offset + 1]);
      deployed = BigInt(result[offset + 2]) !== 0n;
    } catch {
      throw new TypeError("Shadow-account view returned an invalid account.");
    }
    accounts.push({ nonce, address, isDeployed: deployed });
  }
  return accounts;
}

export function short(hex, lead = 8, tail = 6) {
  if (!hex) return "";
  return hex.length <= lead + tail + 2 ? hex : `${hex.slice(0, lead + 2)}…${hex.slice(-tail)}`;
}

export function strk(wei) {
  const v = Number(wei) / 1e18;
  if (v === 0) return "0";
  if (v < 0.0001) return `${wei} wei`;
  return `${v.toFixed(v < 1 ? 4 : 3).replace(/\.?0+$/, "")} STRK`;
}

export function ago(unixSeconds) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
