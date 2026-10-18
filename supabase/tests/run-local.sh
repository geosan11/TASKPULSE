#!/usr/bin/env bash
# Local-only regression run for the money functions. Creates a throwaway
# database on the LOCAL Postgres (sudo -u postgres). Never point this at
# production: it refuses if PGHOST is set to anything but localhost.
set -euo pipefail
if [[ -n "${PGHOST:-}" && "${PGHOST}" != "localhost" && "${PGHOST}" != "127.0.0.1" && "${PGHOST}" != /* ]]; then
  echo "Refusing to run against non-local PGHOST=${PGHOST}" >&2; exit 2
fi
cd "$(dirname "$0")/.."
DB=${DB:-taskpulse_localtest}
PSQL=(sudo -u postgres psql -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -c "DROP DATABASE IF EXISTS ${DB}" -c "CREATE DATABASE ${DB}"
run() { echo "== $1"; "${PSQL[@]}" -d "$DB" -f "$1" 2>&1 | grep -v '^psql.*NOTICE:.*skipping' || true; }
for f in tests/00_supabase_stub.sql schema.sql 002_hardening.sql 003_resilience.sql 004_auto_confirm.sql \
         005_daily_reward_450.sql 006_remove_demo_data.sql 007_referral_commission_1k.sql \
         tests/10_seed_stuck_deposits.sql; do run "$f"; done
echo "== tests/20_settle_deposit_pre008_bug.sql (expect updated_at error + amount_mismatch)"
sudo -u postgres psql -q -d "$DB" -f tests/20_settle_deposit_pre008_bug.sql 2>&1 | grep -E 'ERROR|pending' || true
run 008_free_marketplace.sql
echo "== tests/30_settle_after_008.sql"
sudo -u postgres psql -q -d "$DB" -f tests/30_settle_after_008.sql 2>&1 | grep -E 'PASS|ERROR|FAILED|assert' || true
run 009_business_payments.sql
run 009_business_payments.sql   # must be safe to re-run
echo "== tests/40_business_flow.sql"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/40_business_flow.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
# 012 only replaces request_cashout() from 008 and does not depend on 009-011, so
# it runs here (production order is still 010 then 012) to keep this file
# merge-friendly with the 011 block appended by feat/fast-approvals.
run tests/65_seed_shared_banks_pre012.sql
run 012_withdraw_requires_id.sql
run 012_withdraw_requires_id.sql   # must be safe to re-run
echo "== tests/70_withdraw_id_012.sql"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/70_withdraw_id_012.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
# 013 only adds functions/trigger of its own (it does not redefine anything
# from 010 or 011), so it runs here to stay merge-friendly with 011's block.
run 013_task_spots.sql
run 013_task_spots.sql   # must be safe to re-run
echo "== tests/80_task_spots_013.sql"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/80_task_spots_013.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
run 010_task_categories_policy.sql
run 010_task_categories_policy.sql   # must be safe to re-run
echo "== tests/50_categories_010.sql"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/50_categories_010.sql 2>&1 | grep -E 'PASS|ERROR|FAILED'
