#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

START_TIME=$(date +%s)
FAIL=0

pnpm ci:static || FAIL=1
pnpm ci:database || FAIL=1
pnpm ci:e2e || FAIL=1

if [ "$FAIL" -eq 0 ]; then
  LOCAL_CI_RESULT=PASS pnpm test:private-policy-import
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "All local CI checks passed in ${DURATION}s."
else
  echo ""
  echo "Some local CI checks failed after ${DURATION}s." >&2
  exit 1
fi
