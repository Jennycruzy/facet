import "./theme.js";
import { createGem } from "./gem.js";
import { createChain, short, ago } from "./chain.js";
import { enableTilt } from "./tilt.js";

const $ = (id) => document.getElementById(id);
const h = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const cut = (cls, inner) => {
  const outer = h("div", "cut");
  const box = h("div", `cut-in ${cls}`);
  box.append(h("div", "sheen"));
  box.append(...inner);
  outer.append(box);
  return outer;
};

const data = await fetch("data/facets.json").then((r) => r.json());
const chain = createChain(data.networks);
const net = data.deployment.network;
const explorer = (n) => data.networks[n].explorer;
const facet = data.facets[0];

const mark = createGem($("mark"), { segments: 6 });
mark.setFacets(data.facets);
mark.start();

/* ---------- the sequence ---------- */

const steps = [
  ["01", "UseNote", "Spend a note you already hold inside the shielded pool. Which note, and whose, never leaves the proof."],
  ["02", "Withdraw", "Send the amount to the identity's address, which is known before any code exists there. The pool is the sender, so no personal address appears."],
  ["03", "ComputeAndInvoke", "Deploy the identity if needed, run the app's call as that identity, and collect the change back into the shield."],
];
for (const [n, name, text] of steps) {
  const top = h("div", "id-top");
  top.append(h("div", "mono-badge", n));
  const t = h("div");
  t.append(h("div", "id-name", name));
  t.append(h("div", "id-ctx", "inside the proof"));
  top.append(t);
  $("steps").append(cut(`id-card accent-${["sapphire","emerald","violet"][Number(n) - 1]}`, [top, h("p", "step-text", text)]));
}

/* ---------- the two transactions ---------- */

const roleCopy = {
  deploy: ["Identity created", "The account deploys at the address predicted for it, is funded with 0.5 STRK from a shielded note, and returns all of it."],
  invoke: ["Identity acts", "The same withdrawal, then an app call executed as the identity, then the remainder collected back into the shield."],
};

for (const tx of facet.transactions) {
  const [title, text] = roleCopy[tx.role] ?? [tx.role, tx.summary ?? ""];
  const top = h("div", "id-top");
  top.append(h("div", "mono-badge", tx.role === "deploy" ? "I" : "II"));
  const t = h("div");
  t.append(h("div", "id-name", title));
  t.append(h("div", "id-ctx", new Date(tx.timestamp).toUTCString().slice(5, 22) + " UTC"));
  top.append(t);
  top.append(h("span", "pill", data.networks[facet.network].label.replace("Starknet ", "")));

  const body = h("p", "step-text", text);
  const link = h("div", "addr");
  const a = h("a", null, short(tx.hash, 12, 10));
  a.href = `${explorer(facet.network)}/tx/${tx.hash}`;
  link.append(a);
  link.append(h("span", `state ${tx.role}`, `<span id="st-${tx.role}">checking</span>`));

  $("proof-txs").append(cut(`id-card accent-${tx.role === "deploy" ? "sapphire" : "emerald"}`, [top, body, link]));
}

/* ---------- current Mainnet integration receipts ---------- */

const mainnetApps = data.apps.filter((app) =>
  app.status === "wallet-mediated-verified" && app.mainnetTransaction,
);
for (const app of mainnetApps) {
  const top = h("div", "id-top");
  top.append(h("div", "mono-badge", app.monogram));
  const title = h("div");
  title.append(h("div", "id-name", `${app.name} · ${app.action}`));
  title.append(h("div", "id-ctx", "verified Mainnet receipt"));
  top.append(title);
  top.append(h("span", "pill", "Mainnet"));

  const body = h("p", "step-text",
    `${app.name} completed a Facet action in block ${Number(app.mainnetBlock).toLocaleString()}. ` +
    "The receipt and protocol event are independently inspectable evidence.");
  const link = h("div", "addr");
  const a = h("a", null, short(app.mainnetTransaction, 12, 10));
  a.href = `${explorer("mainnet")}/tx/${app.mainnetTransaction}`;
  link.append(a);
  link.append(h("span", "state", `receipt <span id="mainnet-st-${app.id}">checking</span>`));

  $("mainnet-txs").append(cut(`id-card accent-${app.accent ?? "sapphire"}`, [top, body, link]));
}

/* ---------- the comparison ---------- */

const legs = {
  private: [
    ["UseNote", "A shielded note is spent. Nothing about it becomes public."],
    ["Withdraw", "The pool pays the identity. The pool is the sender."],
    ["Invoke", "The identity acts, and the change returns to the shield."],
  ],
  public: [
    ["approve", "A funded wallet publicly approves the account as spender. Its address is in the clear."],
    ["transfer_from", "The account's first call pulls the funds, putting funder and identity in one receipt."],
    ["settle", "The gained balance becomes a note. The link upstream is already made."],
  ],
};

for (const [kind, list] of Object.entries(legs)) {
  const box = $(`legs-${kind}`);
  list.forEach(([name, text], i) => {
    const leg = h("div", "leg");
    leg.append(h("div", "leg-n", String(i + 1)));
    const b = h("div");
    b.append(h("div", "leg-name", name));
    b.append(h("div", "leg-text", text));
    leg.append(b);
    box.append(leg);
  });
}

$("compare-note").innerHTML =
  `Left: <a href="${explorer(facet.network)}/tx/${facet.transactions[1].hash}">${short(facet.transactions[1].hash, 8, 6)}</a> on ${data.networks[facet.network].label}. ` +
  `Right: <a href="${explorer(data.linkable.network)}/tx/${data.linkable.hash}">${short(data.linkable.hash, 8, 6)}</a> on Starknet Mainnet, ` +
  `where funder <span class="m">${short(data.linkable.funder, 6, 4)}</span> is visible beside the identity it funded.`;

/* ---------- verify ---------- */

const rpc = data.networks[net].rpc;
const checks = [
  ["The identity is deployed", `curl -s ${rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt",
       "params":["latest","${facet.address}"]}'

# ${facet.classHash}`],
  ["The sequence succeeded", `curl -s ${rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt",
       "params":["${facet.transactions[1].hash}"]}'

# execution_status: SUCCEEDED, block ${facet.transactions[1].block}`],
  ["Nothing is stranded", `curl -s ${rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_call","params":[
       {"contract_address":"${data.strk}",
        "entry_point_selector":"0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
        "calldata":["${facet.address}"]},"latest"]}'

# ["0x0","0x0"] because the collect is exact`],
  ["The public alternative", `curl -s ${data.networks[data.linkable.network].rpc} \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt",
       "params":["${data.linkable.hash}"]}'

# mainnet, with the funder's address in the clear`],
];

let active = 0;
function renderTabs() {
  $("tabs").replaceChildren(...checks.map(([label], i) => {
    const b = h("button", "tab", label);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(i === active));
    b.onclick = () => { active = i; renderTabs(); };
    return b;
  }));
  $("tab-body").textContent = checks[active][1];
}
renderTabs();
$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(checks[active][1]);
    $("copy").textContent = "Copied";
    setTimeout(() => { $("copy").textContent = "Copy command"; }, 1400);
  } catch { $("copy").textContent = "Select and copy"; }
};

/* ---------- live ---------- */

try {
  const head = await chain.head(net);
  $("proof-live").textContent = `${data.networks[net].label} · block ${head.number.toLocaleString()} · ${ago(head.timestamp)}`;
  for (const tx of facet.transactions) {
    const r = await chain.receipt(facet.network, tx.hash);
    $(`st-${tx.role}`).textContent = `${r.execution_status} · block ${Number(r.block_number).toLocaleString()}`;
    $(`st-${tx.role}`).className = r.execution_status === "SUCCEEDED" ? "ok" : "";
  }
  for (const app of mainnetApps) {
    try {
      const r = await chain.receipt("mainnet", app.mainnetTransaction);
      const state = $(`mainnet-st-${app.id}`);
      state.textContent = `${r.execution_status} · block ${Number(r.block_number).toLocaleString()}`;
      state.className = r.execution_status === "SUCCEEDED" ? "ok" : "";
    } catch {
      $(`mainnet-st-${app.id}`).textContent = "recorded receipt";
    }
  }
} catch {
  $("proof-live").textContent = `chain unreachable, values recorded ${data.generated}`;
  document.querySelectorAll("[id^='st-']").forEach((n) => { n.textContent = `recorded ${data.generated}`; });
  document.querySelectorAll("[id^='mainnet-st-']").forEach((n) => { n.textContent = "recorded receipt"; });
}

enableTilt();
