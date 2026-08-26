import { createGem } from "./gem.js";
import { createChain, short, strk, ago } from "./chain.js";
import { enableTilt } from "./tilt.js";

const $ = (id) => document.getElementById(id);
const h = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
// Every surface carries one cut corner. Two layers so the hairline follows the chamfer.
const cut = (cls, inner) => {
  const outer = h("div", "cut");
  const box = h("div", `cut-in ${cls}`);
  box.append(h("div", "sheen"));
  if (inner) box.append(...inner);
  outer.append(box);
  return outer;
};

const data = await fetch("data/facets.json").then((r) => r.json());
const chain = createChain(data.networks);
const net = data.deployment.network;
const explorer = (n) => data.networks[n].explorer;

/* ---------- the stone, and the mark ---------- */

for (const [id, opts] of [["stone", {}], ["mark", { segments: 6 }]]) {
  const gem = createGem($(id), opts);
  gem.setFacets(data.facets);
  gem.start();
}

/* ---------- stats ---------- */

$("stat-faces").textContent = String(data.facets.length);
const publicLinks = data.facets.filter((f) => f.fundedPublicly).length;
$("stat-links").textContent = String(publicLinks);
if (publicLinks > 0) $("stat-links").classList.remove("ok");
$("ids-aside").textContent = `${data.facets.length} cut`;

/* ---------- identities ---------- */

function copyable(text, href) {
  const row = h("div", "addr");
  const a = h("a", null, short(text, 10, 8));
  a.href = href;
  row.append(a);
  const btn = h("button", "copy-btn", "copy");
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "copied";
      setTimeout(() => { btn.textContent = "copy"; }, 1200);
    } catch { btn.textContent = "select"; }
  };
  row.append(btn);
  return row;
}

function identityCard(f) {
  const app = f.app ? data.apps.find((a) => a.id === f.app) : null;

  const top = h("div", "id-top");
  top.append(h("div", "mono-badge", app ? app.monogram : (f.monogram ?? "01")));
  const names = h("div");
  names.append(h("div", "id-name", app ? app.name : f.label));
  names.append(h("div", "id-ctx", app ? app.kind : f.context ?? ""));
  top.append(names);
  top.append(h("span", "pill", data.networks[f.network].label.replace("Starknet ", "")));

  const amount = h("div", "amount", `<small>Holding</small><span id="${f.id}-bal">&nbsp;</span>`);

  const txs = h("div", "txs");
  for (const tx of f.transactions) {
    const row = h("div", "tx");
    row.append(h("span", "tick", "✓"));
    row.append(h("span", null, tx.role));
    const a = h("a", null, short(tx.hash, 6, 4));
    a.href = `${explorer(f.network)}/tx/${tx.hash}`;
    row.append(a);
    row.append(h("span", null, `<span id="${f.id}-${tx.role}-blk"></span>`));
    txs.append(row);
  }

  const card = cut(`id-card accent-${f.accent ?? "sapphire"}`, [
    top, amount, copyable(f.address, `${explorer(f.network)}/contract/${f.address}`), txs,
  ]);
  card.id = `card-${f.id}`;
  return card;
}

data.facets.forEach((f) => $("ids").append(identityCard(f)));

{
  const top = h("div", "id-top");
  top.append(h("div", "mono-badge dim", "+"));
  const names = h("div");
  names.append(h("div", "id-name", "Cut a new one"));
  names.append(h("div", "id-ctx", data.uncutNote));
  top.append(names);
  $("ids").append(cut("id-card empty", [top]));
}

/* ---------- apps ---------- */

for (const app of data.apps) {
  const top = h("div", "tile-top");
  top.append(h("div", "mono-badge", app.monogram));
  const names = h("div");
  names.append(h("div", "id-name", app.name));
  names.append(h("div", "id-ctx", app.kind));
  top.append(names);

  const parts = [top, h("div", "tile-note", app.note)];

  if (app.contract) {
    parts.push(h("div", "calls",
      `calls <a href="${explorer("mainnet")}/contract/${app.contract}">${short(app.contract, 6, 4)}</a> <b>${app.entrypoint}</b><br>${app.contractLabel}`));
  }

  const act = h("div", "act");
  const btn = h("button", "btn", app.action);
  btn.disabled = true;
  act.append(btn);
  act.append(h("span", "btn-why", app.tolerates_delay ? "live when contracts land" : "after the first two"));
  parts.push(act);

  $("tiles").append(cut(`tile accent-${app.accent ?? "sapphire"}`, parts));
}

/* ---------- live values ---------- */

function setLive(state, text) {
  $("live").dataset.state = state;
  $("live-text").textContent = text;
}

try {
  const head = await chain.head(net);
  setLive("live", `${data.networks[net].label} · ${head.number.toLocaleString()} · ${ago(head.timestamp)}`);
  for (const f of data.facets) {
    const bal = await chain.balanceOf(f.network, data.strk, f.address);
    $(`${f.id}-bal`).textContent = bal === 0n ? "0 STRK" : strk(bal);
    for (const tx of f.transactions) {
      const r = await chain.receipt(f.network, tx.hash);
      $(`${f.id}-${tx.role}-blk`).textContent = `· ${Number(r.block_number).toLocaleString()}`;
    }
  }
} catch {
  setLive("stale", "chain unreachable, figures recorded 25 Aug 2026");
}

enableTilt();
