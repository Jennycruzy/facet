#!/usr/bin/env bash
# Publish packages/web to the nginx document root. The web pages stay dependency-free at runtime;
# deployment emits one browser bundle from the SDK before staging the static release.
#
# Test files and the package manifest are excluded: they are part of the repository, not of the
# public site, and serving them puts filenames on the origin that nothing links to.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SRC="${FACET_WEB_SRC:-$REPO_ROOT/packages/web}"
DEST="${FACET_WEB_DEST:-/var/www/facet}"
ALLOW_DIRTY="${FACET_ALLOW_DIRTY:-0}"
SKIP_CHOWN="${FACET_SKIP_CHOWN:-0}"
BUILD_SDK_BUNDLE="${FACET_BUILD_SDK_BUNDLE:-1}"

case "$DEST" in
  ""|/|/var|/var/www)
    echo "refusing unsafe destination: ${DEST:-<empty>}" >&2
    exit 1
    ;;
esac
if [[ "$DEST" != /* ]]; then
  echo "destination must be an absolute path: $DEST" >&2
  exit 1
fi
if [[ "$BUILD_SDK_BUNDLE" == "1" ]]; then
  if [[ ! -f "$REPO_ROOT/packages/sdk/package.json" || ! -f "$REPO_ROOT/packages/sdk/scripts/build-browser-bundle.mjs" ]]; then
    echo "SDK bundle source is missing from this checkout" >&2
    exit 1
  fi
  npm --prefix "$REPO_ROOT/packages/sdk" run build
  node "$REPO_ROOT/packages/sdk/scripts/build-browser-bundle.mjs"
elif [[ "$BUILD_SDK_BUNDLE" != "0" ]]; then
  echo "FACET_BUILD_SDK_BUNDLE must be 0 or 1" >&2
  exit 1
fi

for required in index.html data/facets.json assets/js/executor.js assets/js/facet-sdk.js; do
  if [[ ! -f "$SRC/$required" ]]; then
    echo "source is not a Facet web tree; missing $SRC/$required" >&2
    exit 1
  fi
done

if [[ "$ALLOW_DIRTY" != "1" ]] && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]]; then
    echo "refusing to deploy a dirty worktree; commit first or set FACET_ALLOW_DIRTY=1" >&2
    exit 1
  fi
fi

DEST_PARENT="$(dirname -- "$DEST")"
DEST_NAME="$(basename -- "$DEST")"
mkdir -p "$DEST_PARENT"
STAGE="$(mktemp -d "$DEST_PARENT/.${DEST_NAME}.stage.XXXXXX")"
cleanup() { [[ ! -d "$STAGE" ]] || rm -r -- "$STAGE"; }
trap cleanup EXIT

rsync -a \
  --exclude ".*" \
  --exclude "tests/" \
  --exclude "package.json" \
  --exclude "README.md" \
  "$SRC"/ "$STAGE"/

if [[ "$SKIP_CHOWN" != "1" ]]; then
  chown -R www-data:www-data "$STAGE"
fi
find "$STAGE" -type d -exec chmod 755 {} +
find "$STAGE" -type f -exec chmod 644 {} +

BACKUP=""
if [[ -e "$DEST" || -L "$DEST" ]]; then
  BACKUP="${DEST}.backup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mv -- "$DEST" "$BACKUP"
fi
if ! mv -- "$STAGE" "$DEST"; then
  [[ -z "$BACKUP" || -e "$DEST" ]] || mv -- "$BACKUP" "$DEST"
  exit 1
fi
trap - EXIT

echo "published $(find "$DEST" -type f | wc -l | tr -d ' ') files from $SRC to $DEST"
[[ -z "$BACKUP" ]] || echo "previous deployment retained at $BACKUP"
