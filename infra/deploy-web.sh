#!/usr/bin/env bash
# Publish packages/web to the nginx document root. Static files only — no build step.
#
# Test files and the package manifest are excluded: they are part of the repository, not of the
# public site, and serving them puts filenames on the origin that nothing links to.
set -euo pipefail
SRC="${FACET_WEB_SRC:-/root/facet/packages/web}"
DEST="${FACET_WEB_DEST:-/var/www/facet}"
rsync -a --delete \
  --exclude ".*" \
  --exclude "tests/" \
  --exclude "package.json" \
  "$SRC"/ "$DEST"/
chown -R www-data:www-data "$DEST"
find "$DEST" -type d -exec chmod 755 {} +
find "$DEST" -type f -exec chmod 644 {} +
echo "published $(find "$DEST" -type f | wc -l) files to $DEST"
