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

No build step, no dependencies, no bundler.

```bash
python3 -m http.server 8899 --bind 127.0.0.1   # from this directory
```

## Deploying

The page is static, so it is served directly from the project's own host on its own domain —
`demo_url` in the sprint registry should be that domain, not a platform subdomain.

```bash
# from the repository root, with DEPLOY_HOST set to the deployment host
rsync -az --delete packages/web/ "$DEPLOY_HOST:/var/www/facet/"
ln -s /etc/nginx/sites-available/facet /etc/nginx/sites-enabled/facet
certbot --nginx -d <domain>    # certificate and the HTTPS redirect
```

The public pages use clean URLs: `/launch`, `/ekubo`, `/endur`, and `/proof`. Nginx maps those
paths to their static HTML files and redirects the old `.html` paths to the clean addresses.

There is no build step, no runtime dependency, and no upstream: nginx serves the files, and the
page reads Starknet RPC from the visitor's browser. Nothing else on the host is reachable through
the site.

The launcher at `/launch` connects Ready X on Starknet Mainnet and opens the selected Ekubo or
Endur review route. It stores only wallet/app/strategy/version/status metadata in browser local
storage. That map does not create or control an on-chain facet, store recovery secrets, or implement
the SDK lifecycle. The reviewed Mainnet pages use Ready X's native STRK20 proving/screening API;
they request a transaction only after the user checks the exact route and user-selected amount.

The current reviewed execution path is connect Ready X → choose an app → exact route review → Ready X
wallet approval → receipt. A future direct Facet queue may add resumable job polling around the
five-to-seven-minute development proof; that is not presented as a live browser feature. See
[`../../docs/ASYNC_PROVING.md`](../../docs/ASYNC_PROVING.md) for the contract and security
requirements.

The internal Ready X capability check is available at `ready-probe.html` but is intentionally not
linked from the public product navigation. It uses the injected Starknet Wallet
API to read the connected account, chain, advertised Wallet API versions, and shielded STRK
balance. It never requests a private key, proof, signature, or transaction. Use it before wiring
Facet's shadow-account action to the wallet-managed proving path.

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
| `assets/js/launcher.js` | Ready X connection, local metadata map, route selection, and in-memory session state |
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

The static page has no build step. The browser-boundary helpers have dependency-free Node tests:

```bash
npm test
```
