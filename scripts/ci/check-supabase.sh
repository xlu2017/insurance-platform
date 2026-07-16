#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

if supabase status > /dev/null 2>&1; then
  echo "Supabase local stack is already running; reusing existing stack."
else
  echo "Starting Supabase local stack..."
  supabase start
fi
