// Every value on the page is read from chain in the visitor's own browser. This module is
// the only place that talks to an RPC node. Results are cached in sessionStorage; if the
// node is unreachable the caller falls back to the committed snapshot behind a dated banner.

const TTL_MS = 5 * 60 * 1000;
const BALANCE_OF = "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e";

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

  async function rpc(network, method, params = []) {
    const key = `facet:${network}:${method}:${JSON.stringify(params)}`;
    const hit = cacheGet(key);
    if (hit !== null) return hit;
    const url = networks[network].rpc;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    cacheSet(key, body.result);
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
    async balanceOf(network, token, address) {
      const r = await rpc(network, "starknet_call", [
        { contract_address: token, entry_point_selector: BALANCE_OF, calldata: [address] },
        "latest",
      ]);
      return BigInt(r[0]) + (BigInt(r[1] ?? 0) << 128n);
    },
  };
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
