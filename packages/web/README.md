# `packages/web`

The public page. A judge arrives with about ninety seconds of patience: understand it in
three seconds, believe it in fifteen, verify it in sixty.

**Every value on the page is read from chain in the visitor's own browser.** Nothing is a
screenshot and nothing is hard-coded except the identifiers being checked, which live in
`data/facets.json` — the single source of truth for addresses and transaction hashes. Update
that file when a new facet is cut; no code change is needed.

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

There is no build step, no runtime dependency, and no upstream: nginx serves the files, and the
page reads Starknet RPC from the visitor's browser. Nothing else on the host is reachable through
the site.

The staged wallet-binding boundary is available at `launch.html`. It can connect to an injected
EIP-1193 EOA provider, request one origin/network/pool-bound `personal_sign` message, derive the
pool viewing key in memory using the same two-limb recipe as the SDK, and open the selected
Ekubo or Endur review route. The signature and key are never persisted. The reviewed
Mainnet pages use Ready X's native STRK20 proving/screening API; they only request a transaction
after the user checks the exact route and amount.

The current reviewed execution path is `bind` → choose an app → exact route review → Ready X
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
| `index.html` | **The app** — Facet's launcher surface: private account contexts, live on-chain state, and compatible application tiles |
| `launch.html` | Staged launcher — wallet binding, persistent app-context selection, and reviewed route links |
| `ready-probe.html` | Internal read-only Ready X capability check for the mainnet Wallet API path |
| `mainnet-ekubo.html` | Reviewed wallet-mediated Mainnet Ekubo swap using the deployed privacy helper |
| `mainnet-defi.html` | Reviewed wallet-mediated Mainnet Endur xSTRK deposit route |
| `proof.html` | How it works and the evidence, in seven acts. One click behind the app, for the reader who wants to verify rather than use |
| `assets/css/app.css` | Design tokens and layout. Dark, single accent, no framework |
| `assets/js/gem.js` | The stone: a procedural brilliant cut rendered with canvas 2D — painter's algorithm, flat shading, exact face picking. 49 faces at 8 segments; the count is a parameter |
| `assets/js/chain.js` | Homepage chain reader with a `sessionStorage` cache and five-minute TTL; reviewed route modules use their own guarded RPC reads |
| `assets/js/app-ui.js` | The app: live strip, identity cards, app tiles, and dated RPC fallbacks |
| `assets/js/launcher.js` | The staged browser wallet boundary, persistent app-context preview, and in-memory session state |
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
- **The launcher states its stage.** A wallet signature is not a transaction approval, and no
  private key, viewing key, or signature is persisted by the page.
- **The launcher must state its execution boundary.** The current reviewed routes delegate
  proving, screening, and submission to Ready X; the browser never receives proof material.
  A direct Facet queue remains roadmap-only until it is wired and receipt-tested.

## Testing

The static page has no build step. The browser-boundary helpers have dependency-free Node tests:

```bash
npm test
```
