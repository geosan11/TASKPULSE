#!/usr/bin/env bash
# Local-only: the full SQL suite (run-local.sh), then 014 twice and its tests
# on the same throwaway database. Kept separate from run-local.sh so 014 does
# not touch the lines feat/fast-approvals (011) and feat/spots-left (013) add.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-taskpulse_localtest}
bash tests/run-local.sh
# 014 must not redefine anything from 011 or 013 (when those files exist).
names() { grep -oiE 'FUNCTION public\.[a-z0-9_]+' "$1" | tr 'A-Z' 'a-z' | sort -u; }
for f in 011_fast_approvals.sql 013_task_spots.sql; do
  if [[ -f "$f" ]]; then
    clash=$(comm -12 <(names 014_admin_dashboard.sql) <(names "$f") || true)
    if [[ -n "$clash" ]]; then echo "FAILED: 014 redefines functions from $f: $clash" >&2; exit 1; fi
    echo "== 014 redefines nothing from $f"
  fi
done
cmp -s 014_admin_dashboard.sql migrations/20261018000014_admin_dashboard.sql \
  || { echo "FAILED: migrations/20261018000014_admin_dashboard.sql differs from 014_admin_dashboard.sql" >&2; exit 1; }
PSQL=(sudo -u postgres psql -q -v ON_ERROR_STOP=1)
echo "== 014_admin_dashboard.sql"
"${PSQL[@]}" -d "$DB" -f 014_admin_dashboard.sql
echo "== 014_admin_dashboard.sql (must be safe to re-run)"
"${PSQL[@]}" -d "$DB" -f 014_admin_dashboard.sql
echo "== tests/90_admin_dashboard_014.sql"
"${PSQL[@]}" -d "$DB" -f tests/90_admin_dashboard_014.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
