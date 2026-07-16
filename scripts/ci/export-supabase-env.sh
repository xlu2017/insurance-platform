#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

OUT_FILE="${1:-/tmp/supabase-env.sh}"
export OUT_FILE

supabase status -o json 2>/dev/null | node -e "
const fs = require('node:fs');
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const data = JSON.parse(input);
  const lines = [
    'SUPABASE_URL=' + data.API_URL,
    'SUPABASE_ANON_KEY=' + data.ANON_KEY,
    'SUPABASE_SERVICE_ROLE_KEY=' + data.SERVICE_ROLE_KEY,
    'SUPABASE_JWT_SECRET=' + data.JWT_SECRET,
  ];
  fs.writeFileSync(process.env.OUT_FILE, lines.join('\n') + '\n', { mode: 0o600 });
});
"

chmod 600 "$OUT_FILE"
echo "Supabase environment exported to $OUT_FILE"
