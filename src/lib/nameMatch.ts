// Forgiving match between a TaskPulse profile name and the account name a
// bank returns for a NUBAN (via Paystack /bank/resolve). Pure, no imports.
//
// KEEP IN SYNC: api/link-bank.ts and api/admin-identity.ts carry a verbatim
// copy of the block between the <name-match> markers (Vercel handlers here
// are self-contained; see the header of api/link-bank.ts).
// scripts/tests/name-match.test.ts fails if the copies drift.
// <name-match>
const NAME_TITLES = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'MASTER', 'MADAM', 'MDM', 'DR', 'DOC', 'PROF', 'SIR', 'LADY', 'DAME',
  'CHIEF', 'HRH', 'OBA', 'ALHAJI', 'ALHAJA', 'ALH', 'HAJIA', 'HAJIYA', 'HAJI', 'MALAM', 'MALLAM',
  'PASTOR', 'PST', 'REV', 'REVD', 'BISHOP', 'EVANG', 'APOSTLE', 'PROPHET', 'PROPHETESS', 'DEACON',
  'DEACONESS', 'DCN', 'ELDER', 'BRO', 'SIS', 'ENGR', 'ENG', 'BARR', 'ARC', 'ARCH', 'PHARM', 'SEN',
  'HON', 'COMR', 'CAPT', 'GEN', 'COL', 'MAJ', 'LT', 'SGT', 'CPL', 'ESQ', 'JR', 'JNR', 'SR', 'SNR',
]);

/** One name, e.g. "GEORGE" or a double-barrelled "SANNI-MUSA" (parts SANNI, MUSA). */
export type NameUnit = { full: string; parts: string[]; initial: boolean };

export type NameMatchResult = {
  match: boolean;
  /** Profile names/initials that were found in the bank name. */
  matched: string[];
  /** How many had to match. */
  required: number;
  profileUnits: string[];
  bankUnits: string[];
  reason: 'match' | 'no_profile_name' | 'no_bank_name' | 'name_mismatch';
};

/** Upper-case, drop accents/punctuation/titles, split into names; hyphenated names stay one unit. */
export function nameUnits(raw: string | null | undefined): NameUnit[] {
  const cleaned = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^A-Z\s-]/g, ' ') // dots, commas, apostrophes, digits...
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-');
  const units: NameUnit[] = [];
  for (const word of cleaned.split(/\s+/)) {
    const parts = word.split('-').filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1 && NAME_TITLES.has(parts[0])) continue;
    const full = parts.join('');
    units.push({ full, parts, initial: full.length === 1 });
  }
  return units;
}

/**
 * True when the bank name plausibly belongs to the profile owner.
 * - case, punctuation, extra spaces and titles are ignored; order does not matter
 * - a hyphenated name matches written joined, split, or with only one of its parts
 * - an initial ("E.") matches any name starting with that letter, and a missing
 *   middle name or initial is fine
 * - match when at least two names match (at least one of them a full name);
 *   when the profile has only one or two names, all of them must appear
 */
export function matchNames(profileName: string | null | undefined, bankName: string | null | undefined): NameMatchResult {
  const p = nameUnits(profileName);
  const b = nameUnits(bankName);
  const base = { profileUnits: p.map(u => u.parts.join('-')), bankUnits: b.map(u => u.parts.join('-')) };
  if (!p.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_profile_name' };
  if (!b.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_bank_name' };

  const used = new Set<number>();
  const take = (pred: (u: NameUnit) => boolean) => {
    const i = b.findIndex((u, k) => !used.has(k) && pred(u));
    if (i >= 0) used.add(i);
    return i >= 0;
  };
  const done = new Set<number>(); // profile units already matched
  const matched: string[] = [];
  let fullMatches = 0;
  const hit = (i: number, full: boolean) => {
    done.add(i);
    matched.push(p[i].parts.join('-'));
    if (full) fullMatches++;
  };
  // 1. Whole names first, so a partial match never steals a name another one needs.
  p.forEach((u, i) => {
    if (!u.initial && take(x => !x.initial && x.full === u.full)) hit(i, true);
  });
  // 2. Hyphenated names: "SANNI-MUSA" vs "SANNI MUSA" / "SANNI", or "SANNI" vs "SANNI-MUSA".
  p.forEach((u, i) => {
    if (u.initial || done.has(i)) return;
    if (u.parts.length > 1) {
      let any = false;
      for (const part of u.parts) any = take(x => !x.initial && x.full === part) || any;
      if (any) return hit(i, true);
    }
    if (take(x => x.parts.length > 1 && x.parts.includes(u.full))) hit(i, true);
  });
  // 3. Initials, either side: "E." vs "EMMANUEL", or "EMMANUEL" vs "E.".
  p.forEach((u, i) => {
    if (done.has(i)) return;
    const letter = u.full[0];
    if (u.initial ? take(x => x.full[0] === letter) : take(x => x.initial && x.full === letter)) hit(i, false);
  });
  const required = Math.min(p.length, 2);
  const match = fullMatches >= 1 && matched.length >= required;
  return { match, matched, required, ...base, reason: match ? 'match' : 'name_mismatch' };
}
// </name-match>
