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

Cloudflare Pages. It builds on its own infrastructure and needs only read access to the
repository, so the page ships without depending on a CI runner.

- Framework preset: **None**
- Build command: *(empty)*
- Output directory: `packages/web`

## Structure

| File | Contents |
|---|---|
| `index.html` | The seven acts, in order, as plain semantic markup |
| `assets/css/facet.css` | Design tokens and layout. Dark, single accent, no framework |
| `assets/js/gem.js` | The stone: a procedural brilliant cut rendered with canvas 2D — painter's algorithm, flat shading, exact face picking. 49 faces at 8 segments; the count is a parameter |
| `assets/js/chain.js` | The only module that talks to an RPC node. `sessionStorage` cache, five-minute TTL |
| `assets/js/app.js` | Wires chain data into the acts |
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
