#!/usr/bin/env bash
# Local-only: the full suite through 015 (run-local-015.sh), then 016 twice
# and its tests on the same throwaway database. Never run against production.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-taskpulse_localtest}
bash tests/run-local-015.sh
cmp -s 016_fee_15.sql migrations/20261030000016_fee_15.sql \
  || { echo "FAILED: migrations/20261030000016_fee_15.sql differs from 016_fee_15.sql" >&2; exit 1; }
PSQL=(sudo -u postgres psql -q -v ON_ERROR_STOP=1)
echo "== 016_fee_15.sql"
"${PSQL[@]}" -d "$DB" -f 016_fee_15.sql
echo "== 016_fee_15.sql (must be safe to re-run)"
"${PSQL[@]}" -d "$DB" -f 016_fee_15.sql
echo "== tests/98_fee_15_016.sql"
"${PSQL[@]}" -d "$DB" -f tests/98_fee_15_016.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
