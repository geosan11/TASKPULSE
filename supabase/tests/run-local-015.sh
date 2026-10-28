#!/usr/bin/env bash
# Local-only: the full suite through 014 (run-local-014.sh), then 015 twice
# and its tests on the same throwaway database. Never run against production.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-taskpulse_localtest}
bash tests/run-local-014.sh
cmp -s 015_packages.sql migrations/20261026000015_packages.sql \
  || { echo "FAILED: migrations/20261026000015_packages.sql differs from 015_packages.sql" >&2; exit 1; }
PSQL=(sudo -u postgres psql -q -v ON_ERROR_STOP=1)
echo "== 015_packages.sql"
"${PSQL[@]}" -d "$DB" -f 015_packages.sql
echo "== 015_packages.sql (must be safe to re-run)"
"${PSQL[@]}" -d "$DB" -f 015_packages.sql 2>&1 | grep -v 'already exists, skipping' || true
echo "== tests/95_packages_015.sql"
"${PSQL[@]}" -d "$DB" -f tests/95_packages_015.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
