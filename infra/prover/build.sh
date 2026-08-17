#!/usr/bin/env bash
#
# Builds the STRK20 transaction prover for a chosen CPU target.
#
# The published linux/amd64 image is compiled for Zen 5 and aborts with SIGILL (exit 132) on
# older AMD hosts, before it reads any configuration. Rebuilding the identical upstream
# revision for your own target fixes it. See docs/PROVER.md for the full diagnosis.
#
# Usage:
#   ./build.sh                 # portable build, runs anywhere amd64
#   TARGET_CPU=znver2 ./build.sh
#   TARGET_CPU=znver4 ./build.sh
#
# Roughly 20 minutes on 4 vCPU. Do not run this on a small production host.

set -euo pipefail

REVISION="${REVISION:-e6b6fd2e9932909107833579e5b6efd6c75fa0af}"
TARGET_CPU="${TARGET_CPU:-}"
IMAGE="${IMAGE:-transaction-prover:local}"
WORKDIR="${WORKDIR:-$(mktemp -d)}"

echo "==> upstream revision $REVISION"
echo "==> target cpu       ${TARGET_CPU:-<portable>}"
echo "==> image tag        $IMAGE"

if [ ! -d "$WORKDIR/sequencer/.git" ]; then
  git clone --filter=blob:none https://github.com/starkware-libs/sequencer.git "$WORKDIR/sequencer"
fi
git -C "$WORKDIR/sequencer" checkout --quiet "$REVISION"

BUILD_ARGS=()
if [ -n "$TARGET_CPU" ]; then
  BUILD_ARGS+=(--build-arg "TARGET_CPU=$TARGET_CPU")
fi

docker build \
  --platform linux/amd64 \
  "${BUILD_ARGS[@]}" \
  -f "$WORKDIR/sequencer/crates/starknet_transaction_prover/Dockerfile" \
  -t "$IMAGE" \
  "$WORKDIR/sequencer"

echo
echo "==> verifying the binary starts on this host"
if docker run --rm "$IMAGE" --help >/dev/null 2>&1; then
  echo "    ok — exit 0"
else
  status=$?
  echo "    FAILED — exit $status"
  [ "$status" -eq 132 ] && echo "    132 is SIGILL: this build is still wrong for this CPU. Try a lower target, or none."
  exit "$status"
fi
