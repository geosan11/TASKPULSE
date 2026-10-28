/**
 * Every numbered migration has two copies that must be byte-identical:
 *   supabase/NNN_name.sql                       (pasted into the SQL editor)
 *   supabase/migrations/<date>000NNN_name.sql   (used by `supabase db push`)
 * Run: npm run check:migrations
 *
 * 001-007 predate the rule (their headers differ), so they are skipped.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'supabase');
const MIGRATIONS = join(ROOT, 'migrations');
const LEGACY_BEFORE = 8;

const migrationFiles = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'));
let failed = 0;
let checked = 0;

for (const f of readdirSync(ROOT).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort()) {
  const num = Number(f.slice(0, 3));
  if (num < LEGACY_BEFORE) continue;
  const rest = f.slice(4);
  const matches = migrationFiles.filter(m => m.endsWith(`${String(num).padStart(6, '0')}_${rest}`));
  if (matches.length !== 1) {
    console.error(`FAIL ${f}: expected 1 copy in supabase/migrations, found ${matches.length}`);
    failed++;
    continue;
  }
  const a = readFileSync(join(ROOT, f));
  const b = readFileSync(join(MIGRATIONS, matches[0]));
  if (!a.equals(b)) {
    console.error(`FAIL ${f} differs from migrations/${matches[0]}`);
    failed++;
  } else {
    checked++;
  }
}

if (failed) {
  console.error(`${failed} migration copy problem(s).`);
  process.exit(1);
}
console.log(`PASS: ${checked} migrations have byte-identical copies.`);
