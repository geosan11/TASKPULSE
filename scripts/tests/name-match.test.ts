/** Profile name vs bank account name matcher. Run: npm run test:name-match */
import { readFileSync } from 'node:fs';
import { matchNames, nameUnits } from '../../src/lib/nameMatch';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};
const yes = (profile: string, bank: string, why: string) => {
  const r = matchNames(profile, bank);
  check(`match: ${why} ("${profile}" vs "${bank}")`, r.match, r);
};
const no = (profile: string, bank: string, why: string, reason = 'name_mismatch') => {
  const r = matchNames(profile, bank);
  check(`no match: ${why} ("${profile}" vs "${bank}")`, !r.match && r.reason === reason, r);
};

// Normalising
check('units drop titles, punctuation, case', JSON.stringify(nameUnits('  Mrs. Chiamaka,  O. Obi ').map(u => u.full)) === '["CHIAMAKA","O","OBI"]');
check('hyphenated name is one unit', JSON.stringify(nameUnits('Sanni-Musa George')[0]) === '{"full":"SANNIMUSA","parts":["SANNI","MUSA"],"initial":false}');
check('accents removed', nameUnits('Adébáyọ̀')[0].full === 'ADEBAYO');

// Typical Nigerian bank-name shapes
yes('Sanni-Musa Emmanuel George', 'GEORGE SANNI-MUSA EMMANUEL', 'reordered with hyphenated surname');
yes('George Sanni', 'SANNI GEORGE', 'surname first (bank order)');
yes('George Sanni', 'SANNI GEORGE EMMANUEL', 'bank has a middle name the profile lacks');
yes('George Emmanuel Sanni', 'SANNI GEORGE', 'profile has a middle name the bank lacks');
yes('Chiamaka Obi', 'OBI CHIAMAKA NGOZI', 'two names, both present');
yes('Mr. Tunde Bakare', 'BAKARE, TUNDE', 'title and comma');
yes('Dr (Mrs) Funmilayo Ransome-Kuti', 'RANSOME KUTI FUNMILAYO', 'hyphenated name split by the bank');
yes('Funmilayo Ransome-Kuti', 'KUTI FUNMILAYO', 'bank kept one half of a hyphenated name');
yes('Funmilayo Kuti', 'RANSOME-KUTI FUNMILAYO', 'profile has one half of a hyphenated name');
yes('Ngozi Okonjo-Iweala', 'OKONJOIWEALA NGOZI', 'hyphen dropped by the bank');
yes('George E. Sanni', 'SANNI GEORGE EMMANUEL', 'middle initial');
yes('G. Sanni', 'SANNI GEORGE', 'first-name initial with surname');
yes('Abubakar Sadiq Musa', 'MUSA ABUBAKAR', 'two of three names');
yes('Alhaji Abubakar Musa', 'ABUBAKAR MUSA', 'Alhaji title');
yes('chinedu   okeke', 'OKEKE  CHINEDU', 'case and extra spaces');
yes('Oluwaseun Adeyemi', "ADEYEMI OLUWASEUN 'TOBI", 'apostrophe nickname');


no('George Sanni', 'SANNI PETER', 'only the surname matches (family member)');
no('Sanni-Musa George', 'SANNI-MUSA PETER', 'same double-barrelled surname, different first name');
no('Chiamaka Obi', 'ADEBAYO TUNDE', 'different person');
no('George Emmanuel Sanni', 'GEORGE ADEYEMI', 'one of three names');
no('G. Sanni', 'SANNI PETER', 'initial does not fit');
no('G. E.', 'GEORGE EMMANUEL', 'initials only, no full name', 'no_profile_name');
no('', 'GEORGE SANNI', 'empty profile name', 'no_profile_name');
no('Mr', 'GEORGE SANNI', 'title only', 'no_profile_name');
no('George Sanni', '', 'empty bank name', 'no_bank_name');
no('Emeka', 'EMEKA NWOSU', 'one-word profile name goes to review', 'single_name');
no('Mr. Emeka', 'EMEKA NWOSU', 'one word after dropping the title', 'single_name');
no('Sanni-Musa', 'SANNI-MUSA GEORGE', 'one hyphenated word only', 'single_name');
no('Ann Ann', 'ANN OBI', 'repeated profile name cannot use one bank name twice');

// The API handlers carry a verbatim copy of the matcher (self-contained Vercel functions)
const block = (file: string) => {
  const t = readFileSync(new URL(file, import.meta.url), 'utf8');
  const a = t.indexOf('// <name-match>');
  const z = t.indexOf('// </name-match>');
  return a >= 0 && z > a ? t.slice(a, z) : null;
};
const canonical = block('../../src/lib/nameMatch.ts');
for (const f of ['../../api/link-bank.ts']) {
  check(`${f.replace('../../', '')} matcher copy is identical`, canonical !== null && block(f) === canonical);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nname match tests: PASS');
