#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# .tmp/ is gitignored; avoids the non-portable /tmp so this works for
# Windows contributors running through Git Bash/WSL as well.
mkdir -p .tmp
supabase gen types typescript --local --schema public > .tmp/database.types.ts
pnpm prettier --config .prettierrc --write .tmp/database.types.ts
diff -u packages/database/src/database.types.ts .tmp/database.types.ts
