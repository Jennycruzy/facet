# `packages/web`

The public page. A judge arrives with about ninety seconds of patience: understand it in
three seconds, believe it in fifteen, verify it in sixty.

**Every value on the page is read from chain in the visitor's own browser.** Nothing is a
screenshot and nothing is hard-coded except the identifiers being checked, which live in
`data/facets.json` — the single source of truth for addresses and transaction hashes. Update
that file when a new facet is cut; no code change is needed.

The homepage keeps the evidence types separate: the live Mainnet route cards show receipt-backed
app actions, while the direct Facet identity cards are currently Sepolia proof accounts and are
labeled as test accounts. A Mainnet receipt is not silently presented as a direct Facet identity.

## Running it

The runtime remains dependency-free static output. Deployment builds the SDK source into one
browser ESM bundle at `assets/js/facet-sdk.js`; the route-facing `executor.js` only re-exports that
bundle, so the browser and SDK no longer maintain separate executor implementations.

```bash
python3 -m http.server 8899 --bind 127.0.0.1   # from this directory
```

**Serve it — do not open `index.html` from the file system.** The pages use ES modules and
`fetch` for `data/facets.json`, and browsers block both over `file://`, so a double-clicked
copy renders the static text with none of the route cards or live values. That is a browser
restriction, not a fault in the page.

Every internal link is a relative filename (`mainnet-defi.html`), so a checkout served from any
directory works. The deployed host maps those filenames to the clean public URLs (`/endur`) with
a redirect, so both forms resolve.

## Deploying

The page is static, so it is served directly from the project's own host on its own domain —
`demo_url` in the sprint registry should be that domain, not a platform subdomain.

```bash
# from the repository root on the deployment host
FACET_WEB_DEST=/var/www/facet ./infra/deploy-web.sh
ln -s /etc/nginx/sites-available/facet /etc/nginx/sites-enabled/facet
certbot --nginx -d <domain>    # certificate and the HTTPS redirect
```

The public pages use clean URLs: `/launch`, `/ekubo`, `/endur`, and `/proof`. Nginx maps those
paths to their static HTML files and redirects the old `.html` paths to the clean addresses.

There is no runtime dependency and no upstream: nginx serves the files, and the page reads
Starknet RPC from the visitor's browser. Deployment performs the one local SDK build needed to
emit `assets/js/facet-sdk.js`; nothing else on the host is reachable through the site.

The launcher at `/launch` connects Ready X on Starknet Mainnet and opens the selected Ekubo or
Endur review route. It stores app/version/lifecycle state, confirmed transaction hashes, and held
position labels in browser local storage. Its transitions mirror the SDK lifecycle and the Ekubo
exit clears the Endur xSTRK position in that local record. It exposes guarded local recovery and
retirement controls: persistent positions must be exited first. The map does not create or control
an on-chain facet, store recovery secrets, or execute a generic recovery sweep. The reviewed Mainnet pages use Ready X's native STRK20 proving/screening API;
they request a transaction only after the user checks the exact route and user-selected amount.

The current reviewed execution path is connect Ready X → choose an app → exact route review → Ready X
wallet approval → receipt. A future direct Facet queue may add resumable job polling around the
five-to-seven-minute development proof; that is not presented as a live browser feature. See
[`../../docs/ASYNC_PROVING.md`](../../docs/ASYNC_PROVING.md) for the contract and security
requirements.

The internal Ready X capability check is available at `ready-probe.html` but is intentionally not
linked from the public product navigation. It uses the injected Starknet Wallet
API to read the connected account, chain, advertised Wallet API versions, and shielded STRK
balance. It never requests a private key, proof, signature, or transaction. Use it to verify the
wallet's read and action capabilities before relying on optional shadow-account discovery.

## Structure

| File | Contents |
|---|---|
| `index.html` | **The app** — Facet's launcher surface: live Mainnet route receipts, clearly labeled Sepolia proof identities, and compatible application tiles |
| `launch.html` | Mainnet launcher, served at `/launch` — Ready X connection, local app-context metadata, and reviewed route links |
| `ready-probe.html` | Internal read-only Ready X capability check for the mainnet Wallet API path |
| `mainnet-ekubo.html` | Reviewed wallet-mediated Mainnet Ekubo swap, served publicly at `/ekubo` |
| `mainnet-defi.html` | Reviewed wallet-mediated Mainnet Endur xSTRK deposit route, served publicly at `/endur` |
| `proof.html` | How it works and the evidence, served publicly at `/proof` |
| `assets/css/app.css` | Design tokens and layout. Dark, single accent, no framework |
| `assets/js/gem.js` | The stone: a procedural brilliant cut rendered with canvas 2D — painter's algorithm, flat shading, exact face picking. 49 faces at 8 segments; the count is a parameter |
| `assets/js/chain.js` | Homepage chain reader with a `sessionStorage` cache and five-minute TTL; reviewed route modules use their own guarded RPC reads |
| `assets/js/app-ui.js` | The app: live strip, identity cards, app tiles, and dated RPC fallbacks |
| `assets/js/launcher.js` | Ready X connection, chain-backed portfolio reconciliation, local activity cache, route selection, and in-memory session state |
| `assets/js/portfolio.js` | Private balance reads, optional shadow-account discovery, public position reads, and cache reconciliation |
| `assets/js/chain.js` | Cached Starknet RPC reads, shadow-account view decoding, receipts, and token balances |
| `assets/js/ready-probe.js` | Read-only Ready X account, chain, STRK20 balance, and API capability check |
| `assets/js/wallet-binding.js` | Canonical binding message, EIP-1193 account handling, and signature validation |
| `assets/js/wallet-derivation.js` | Dependency-free Keccak and bridge-compatible viewing-key derivation |
| `assets/js/proof.js` | Wires chain data and receipt checks into the proof page's acts |
| `data/facets.json` | Addresses, transaction hashes, RPC endpoints |

## Rules this page follows

- **A dark face is an identity that has not been cut.** The page shows the facets that exist,
  never a placeholder dressed as one.
- **Every live value has three states** — skeleton, resolved, and unavailable. A visitor must
  never meet a spinner that does not end. If the RPC is unreachable the status line says so
  with a date rather than showing stale numbers as fresh.
- **`prefers-reduced-motion` is honoured.** No auto-rotation; the narrative reads as a static
  document.
- **The frame rate is capped and rendering stops when the canvas is off screen.** The stone
  must not heat a laptop.
- **The limits section is not optional.** Among sixty submissions, the one that states its
  own limits is the one believed on everything else.
- **The launcher states its stage.** Connecting Ready X is not a transaction approval. The page
  does not receive a private key, viewing key, screening attestation, or proof.
- **Evidence types stay separate.** Mainnet route receipts and Sepolia identity rehearsals have
  different labels and are never counted as the same thing.
- **The launcher must state its execution boundary.** The current reviewed routes delegate
  proving, screening, and submission to Ready X; the browser never receives proof material.
  A direct Facet queue remains roadmap-only until it is wired and receipt-tested.

## Testing

The runtime is static; the browser-boundary helpers have Node tests and the test command builds the
SDK browser artifact first:

```bash
npm test
```
