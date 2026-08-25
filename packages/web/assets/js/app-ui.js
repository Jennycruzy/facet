import { createGem } from "./gem.js";
import { createChain, short, strk, ago } from "./chain.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

const data = await fetch("data/facets.json").then((r) => r.json());
const chain = createChain(data.networks);
const net = data.deployment.network;
const explorer = data.networks[net].explorer;

/* ---------- the mark ---------- */

const mark = createGem($("mark"), {});
mark.setFacets(data.facets);
mark.start();

/* ---------- status ---------- */

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}

/* ---------- the strip ---------- */

$("face-count").textContent = String(data.facets.length);

// A public link is a funding leg that names a personal address. Ours are funded from the
// shielded pool, so the honest count is derived, not asserted.
const publicLinks = data.facets.filter((f) => f.fundedPublicly).length;
$("link-count").textContent = String(publicLinks);
if (publicLinks > 0) $("link-count").classList.remove("ok");

/* ---------- faces ---------- */

function facetCard(facet) {
  const card = el("div", "card lit");
  const title = facet.app
    ? data.apps.find((a) => a.id === facet.app)?.name ?? facet.app
    : facet.label ?? "Facet";
  card.append(el("h3", null, `<span class="pip"></span>${title}`));
  const kv = el("dl", "kv");
  const row = (k, v) => kv.append(el("dt", null, k), el("dd", null, v));
  row("address", `<a class="hash" href="${explorer}/contract/${facet.address}">${short(facet.address, 10, 8)}</a>`);
  row("network", data.networks[facet.network].label);
  row("deployed", `<span class="hash" id="${facet.id}-class"><span class="skeleton"></span></span>`);
  row("holding", `<span class="hash" id="${facet.id}-bal"><span class="skeleton"></span></span>`);
  for (const tx of facet.transactions) {
    row(tx.role, `<a class="hash" href="${explorer}/tx/${tx.hash}">${short(tx.hash, 10, 8)}</a>
      <span id="${facet.id}-${tx.role}-status" style="color:var(--text-faint)"> · <span class="skeleton"></span></span>`);
  }
  card.append(kv);
  return card;
}

data.facets.forEach((f) => $("facet-cards").append(facetCard(f)));

const uncut = el("div", "card uncut");
uncut.append(el("h3", null, `<span class="pip"></span>Not yet cut`));
uncut.append(el("p", null, data.uncutNote));
$("facet-cards").append(uncut);

/* ---------- apps ---------- */

$("app-notice").innerHTML = `
  <strong>Creating a face from this page is not live yet.</strong> It needs the Facet
  contracts on mainnet, and they are being deployed now. Rather than show buttons that do
  nothing, each card below states exactly where it stands. Everything above this line is real
  and on chain today — check any hash.`;

for (const app of data.apps) {
  const tile = el("div", "tile");
  const head = el("div", "tile-head");
  head.append(el("div", "tile-name", app.name), el("div", "tile-kind", app.kind));
  tile.append(head);
  tile.append(el("div", "tile-note", app.note));
  if (app.contract) {
    const mainnet = data.networks.mainnet.explorer;
    tile.append(el("div", "tile-contract",
      `<span class="tile-kind">calls</span><br>
       <a class="hash" href="${mainnet}/contract/${app.contract}">${short(app.contract, 8, 6)}</a>
       <code>${app.entrypoint}</code>
       <div style="color:var(--text-faint);margin-top:4px">${app.contractLabel} — the protocol's own mainnet contract, not a copy</div>`));
  }
  const state = app.tolerates_delay
    ? el("div", "tile-state pending", `${app.action} · awaiting mainnet contracts`)
    : el("div", "tile-state later", `${app.action} · last, by design`);
  tile.append(state);
  $("app-tiles").append(tile);
}

/* ---------- live values ---------- */

try {
  const head = await chain.head(net);
  setStatus("live", `${data.networks[net].label.toLowerCase()} · block ${head.number.toLocaleString()} · ${ago(head.timestamp)}`);
  for (const facet of data.facets) {
    const cls = await chain.classHashAt(facet.network, facet.address);
    $(`${facet.id}-class`).textContent =
      BigInt(cls) === BigInt(facet.classHash) ? `yes · ${short(cls, 6, 4)}` : `class differs: ${short(cls, 6, 4)}`;
    const bal = await chain.balanceOf(facet.network, data.strk, facet.address);
    $(`${facet.id}-bal`).textContent = bal === 0n ? "0 — swept back into the shield" : strk(bal);
    for (const tx of facet.transactions) {
      const r = await chain.receipt(facet.network, tx.hash);
      $(`${facet.id}-${tx.role}-status`).textContent =
        ` · ${r.execution_status} · block ${Number(r.block_number).toLocaleString()}`;
    }
  }
} catch (err) {
  setStatus("stale", `chain unreachable — values below were recorded 25 August 2026 (${err.message})`);
  document.querySelectorAll(".skeleton").forEach((s) => s.replaceWith(document.createTextNode("unavailable")));
}
