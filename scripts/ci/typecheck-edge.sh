#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

export PATH="$HOME/.deno/bin:$PATH"

if ! command -v deno >/dev/null 2>&1; then
  echo "Deno not found; installing to $HOME/.deno..."
  curl -fsSL https://deno.land/install.sh | DENO_INSTALL="$HOME/.deno" sh
  export PATH="$HOME/.deno/bin:$PATH"
fi

cd supabase/functions

deno check \
  recommendation-generator/index.ts \
  save-case-quote/index.ts \
  save-household-mandate/index.ts \
  upload-document/index.ts \
  create-checkout-session/index.ts \
  stripe-webhook/index.ts \
  send-quote-request/index.ts \
  extract-policy-entities/index.ts \
  approve-policy-candidates/index.ts \
  cleanup-provider-files/index.ts \
  delete-document/index.ts \
  document-processing-batch/index.ts \
  dangerous-mode-setting/index.ts
