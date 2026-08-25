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

/* ---------- act 0: the status line ------------------------------------- */

function setStatus(state, text) {
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}

async function liveHead() {
  try {
    const head = await chain.head(net);
    setStatus(
      "live",
      `verified against ${data.networks[net].label.toLowerCase()} · block ${head.number.toLocaleString()} · ${ago(head.timestamp)}`,
    );
    return true;
  } catch (err) {
    setStatus("stale", `chain unreachable — showing values recorded 25 August 2026 (${err.message})`);
    document.querySelectorAll(".skeleton").forEach((s) => { s.classList.remove("skeleton"); });
    return false;
  }
}

/* ---------- act 1: the stone ------------------------------------------- */

const gem = createGem($("stone"), {
  onSelect(facet) {
    document.getElementById("facets").scrollIntoView({ behavior: "smooth", block: "start" });
    const card = document.getElementById(`card-${facet.id}`);
    if (card) card.animate(
      [{ boxShadow: "0 0 0 0 rgba(127,215,255,.7)" }, { boxShadow: "0 0 0 14px rgba(127,215,255,0)" }],
      { duration: 900 },
    );
  },
});
gem.setFacets(data.facets);
gem.start();
// The face count is a property of the render, not of the system — saying "1 of 49" would
// state a cap that does not exist. Show what is cut, and that the supply is not the limit.
const cutCount = data.facets.length;
$("stone-hint").textContent =
  `drag to turn · ${cutCount} facet${cutCount === 1 ? "" : "s"} cut · the supply is unlimited`;

/* ---------- act 2: the facet cards ------------------------------------- */

function facetCard(facet) {
  const card = el("div", "card lit");
  card.id = `card-${facet.id}`;
  card.append(el("h3", null, `<span class="pip"></span>Facet ${facet.id.split("-")[1]}`));
  const kv = el("dl", "kv");
  const row = (k, v) => { kv.append(el("dt", null, k), el("dd", null, v)); };
  row("address", `<a class="hash" href="${explorer}/contract/${facet.address}">${short(facet.address, 10, 8)}</a>`);
  row("deployed", `<span class="hash" id="${facet.id}-class"><span class="skeleton"></span></span>`);
  row("balance", `<span class="hash" id="${facet.id}-bal"><span class="skeleton"></span></span>`);
  for (const tx of facet.transactions) {
    row(tx.role, `<a class="hash" href="${explorer}/tx/${tx.hash}">${short(tx.hash, 10, 8)}</a>
      <span id="${facet.id}-${tx.role}-status" style="color:var(--text-faint)"> · <span class="skeleton"></span></span>
      <div style="color:var(--text-dim);font-size:.86rem;margin-top:4px">${tx.summary}</div>`);
  }
  card.append(kv);
  return card;
}

const cards = $("facet-cards");
data.facets.forEach((f) => cards.append(facetCard(f)));
const uncut = el("div", "card uncut");
uncut.append(el("h3", null, `<span class="pip"></span>Not yet cut`));
uncut.append(el("p", null, `${data.uncutNote} Nothing on this page pretends otherwise.`));
cards.append(uncut);

async function fillFacets() {
  for (const facet of data.facets) {
    try {
      const cls = await chain.classHashAt(facet.network, facet.address);
      const ok = BigInt(cls) === BigInt(facet.classHash);
      $(`${facet.id}-class`).innerHTML = ok
        ? `yes · class ${short(cls, 6, 4)}`
        : `class differs: ${short(cls, 6, 4)}`;
      const bal = await chain.balanceOf(facet.network, data.strk, facet.address);
      $(`${facet.id}-bal`).textContent = `${strk(bal)}${bal === 0n ? " — swept, nothing stranded" : ""}`;
      for (const tx of facet.transactions) {
        const r = await chain.receipt(facet.network, tx.hash);
        $(`${facet.id}-${tx.role}-status`).textContent =
          ` · ${r.execution_status} · block ${Number(r.block_number).toLocaleString()}`;
      }
    } catch (err) {
      document.querySelectorAll(`[id^="${facet.id}-"] .skeleton`).forEach((s) => {
        s.replaceWith(document.createTextNode("unavailable"));
      });
    }
  }
}

/* ---------- act 3: the funding comparison ------------------------------ */

const privateLegs = [
  ["hidden", "UseNote", "A note inside the shielded pool is spent. Which note, and whose, stays inside the proof."],
  ["hidden", "Withdraw", "0.5 STRK leaves the pool for the facet's address. The pool is the sender — no personal address appears."],
  ["hidden", "ComputeAndInvoke", "The dapp call runs as the facet. The remainder returns to the shield in the same transaction."],
];

const publicLegs = [
  ["open", "approve", "A funded wallet publicly approves the shadow account as spender. Its address is in the clear."],
  ["open", "transfer_from", "The account's first call pulls the funds from that wallet — funder and facet in one receipt."],
  ["open", "CollectPolicy::Diff", "The gained balance settles into a note. The link upstream has already been made."],
];

function renderLegs(target, legs) {
  const box = $(target);
  legs.forEach(([kind, name, text], i) => {
    const leg = el("div", "leg");
    leg.append(el("div", "leg-n", String(i + 1)));
    const body = el("div", "leg-body");
    body.append(el("div", `leg-tag ${kind === "hidden" ? "hidden-leg" : "open-leg"}`,
      kind === "hidden" ? "inside the proof" : "public on chain"));
    body.append(el("div", null, `<strong>${name}</strong> — ${text}`));
    leg.append(body);
    box.append(leg);
  });
}

renderLegs("private-legs", privateLegs);
renderLegs("public-legs", publicLegs);

$("col-private").append(el("p", null,
  `<span class="hash"><a href="${explorer}/tx/${data.facets[0].transactions[1].hash}">${short(data.facets[0].transactions[1].hash, 10, 8)}</a></span>
   <span id="private-status" style="color:var(--text-faint)"><span class="skeleton"></span></span>
   <div style="color:var(--text-dim);font-size:.86rem;margin-top:8px">The pool is the sender. No personal address appears in the funding leg.</div>`));
$("col-public").append(el("p", null,
  `<span class="hash"><a href="${data.networks[data.linkable.network].explorer}/tx/${data.linkable.hash}">${short(data.linkable.hash, 10, 8)}</a></span>
   <span id="public-status" style="color:var(--text-faint)"><span class="skeleton"></span></span>
   <div style="color:var(--text-dim);font-size:.86rem;margin-top:8px">Funder <span class="hash">${short(data.linkable.funder, 8, 6)}</span> → facet <span class="hash">${short(data.linkable.shadow, 8, 6)}</span>, ${data.linkable.amount}.</div>`));

async function fillPublic() {
  try {
    const own = await chain.receipt(net, data.facets[0].transactions[1].hash);
    $("private-status").textContent =
      ` · ${own.execution_status} · block ${Number(own.block_number).toLocaleString()} · sepolia`;
  } catch {
    $("private-status").textContent = " · recorded in FINDINGS.md §6.17";
  }
  try {
    const r = await chain.receipt(data.linkable.network, data.linkable.hash);
    $("public-status").textContent = ` · ${r.execution_status} · block ${Number(r.block_number).toLocaleString()} · mainnet`;
  } catch {
    $("public-status").textContent = " · recorded in FINDINGS.md §6.5";
  }
}

/* ---------- act 4: how it works ---------------------------------------- */

const steps = [
  ["UseNote", "Spend a note you already hold inside the shielded pool. Nothing about it becomes public."],
  ["Withdraw", "Send the amount to the facet's address — derivable before the account exists, which is what makes the whole pattern work."],
  ["ComputeAndInvoke", "Deploy the facet if needed, run the dapp call as that identity, collect the change back into the shield."],
];
steps.forEach(([name, text], i) => {
  const c = el("div", "card");
  c.append(el("h3", null, `<span class="pip"></span>${i + 1}. <code>${name}</code>`));
  c.append(el("p", null, text));
  $("how-steps").append(c);
});

/* ---------- act 5: verify ---------------------------------------------- */

const f0 = data.facets[0];
const rpcUrl = data.networks[net].rpc;
const checks = [
  ["the facet is deployed", `curl -s ${rpcUrl} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt",
       "params":["latest","${f0.address}"]}'
# ${f0.classHash}`],
  ["the sequence succeeded", `curl -s ${rpcUrl} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt",
       "params":["${f0.transactions[1].hash}"]}'
# execution_status: SUCCEEDED, block ${f0.transactions[1].block}`],
  ["nothing is stranded", `curl -s ${rpcUrl} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_call","params":[
       {"contract_address":"${data.strk}",
        "entry_point_selector":"0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e",
        "calldata":["${f0.address}"]},"latest"]}'
# ["0x0","0x0"] — the collect is exact`],
  ["the public-funding comparison", `curl -s ${data.networks[data.linkable.network].rpc} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getTransactionReceipt",
       "params":["${data.linkable.hash}"]}'
# mainnet: funder ${short(data.linkable.funder, 8, 6)} in the clear`],
];

let active = 0;
function renderVerify() {
  $("verify-tabs").replaceChildren(...checks.map(([label], i) => {
    const b = el("button", "tab", label);
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(i === active));
    b.onclick = () => { active = i; renderVerify(); };
    return b;
  }));
  $("verify-body").textContent = checks[active][1];
}
renderVerify();
$("verify-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(checks[active][1]);
    $("verify-copy").textContent = "copied";
    setTimeout(() => { $("verify-copy").textContent = "copy"; }, 1400);
  } catch { $("verify-copy").textContent = "select and copy"; }
};

/* ---------- go --------------------------------------------------------- */

if (await liveHead()) {
  await fillFacets();
  await fillPublic();
}
