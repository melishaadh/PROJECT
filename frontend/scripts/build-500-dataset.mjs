
import { readFileSync, writeFileSync } from 'node:fs';

const [input] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outFlag = process.argv.find(a => a.startsWith('--out='));
const outPath = outFlag ? outFlag.slice('--out='.length) : 'scripts/data/trekeasy-users-500.json';

if (!input) {
  console.error('Usage: node scripts/build-500-dataset.mjs <accumulator.jsonl> [--out=path.json]');
  process.exit(1);
}

const rows = readFileSync(input, 'utf8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => JSON.parse(line));

const problems = [];
const seenEmail = new Map();
const seenUsername = new Map();

/** Real calendar date, not just the right shape — 31-02 must not pass. */
function isRealDate(dob) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dob);
  if (!m) return false;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

for (const row of rows) {
  const where = `p${row.page} ${row.username}`;

  if (!/^[a-z0-9]+$/.test(row.username)) {
    problems.push(`${where}: username has unexpected characters`);
  }
  if (!/^[a-z]+\.[a-z]+\d+@gmail\.com$/.test(row.email)) {
    problems.push(`${where}: unexpected email "${row.email}"`);
  }
  if (!isRealDate(row.dob)) {
    problems.push(`${where}: "${row.dob}" is not a real DD-MM-YYYY date`);
  }
  if (!Number.isInteger(row.age) || row.age < 15 || row.age > 60) {
    problems.push(`${where}: implausible age ${row.age}`);
  }

  // The cross-check: password "SumanRai" ⇒ email "suman.rai<digits>@…" and
  // username "sumanrai…". A mismatch means a misread name, not a data quirk.
  const fromPassword = row.password.toLowerCase();
  const emailName = row.email.split('@')[0].replace(/\./g, '').replace(/\d+$/, '');
  if (emailName !== fromPassword) {
    problems.push(`${where}: email "${row.email}" does not match password "${row.password}"`);
  }
  if (!row.username.startsWith(fromPassword)) {
    problems.push(`${where}: username "${row.username}" does not match password "${row.password}"`);
  }

  if (seenEmail.has(row.email)) {
    problems.push(`${where}: duplicate email ${row.email} (also ${seenEmail.get(row.email)})`);
  } else {
    seenEmail.set(row.email, where);
  }
  if (seenUsername.has(row.username)) {
    problems.push(`${where}: duplicate username ${row.username} (also ${seenUsername.get(row.username)})`);
  } else {
    seenUsername.set(row.username, where);
  }
}

const byCohort = {};
const byPage = {};
for (const r of rows) {
  byCohort[r.cohort] = (byCohort[r.cohort] ?? 0) + 1;
  byPage[r.page] = (byPage[r.page] ?? 0) + 1;
}

console.log(`rows transcribed: ${rows.length}`);
for (const [cohort, count] of Object.entries(byCohort)) {
  console.log(`  ${cohort.padEnd(22)} ${count}`);
}
const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
console.log(`pages covered: ${pages.length} (${pages[0]}–${pages[pages.length - 1]})`);

const missing = [];
for (let p = pages[0]; p <= pages[pages.length - 1]; p++) {
  if (!byPage[p]) missing.push(p);
}
if (missing.length) console.log(`  GAPS at pages: ${missing.join(', ')}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
  if (problems.length > 60) console.log(`  … and ${problems.length - 60} more`);
}

const users = rows.map(({ page: _page, ...user }) => user);
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      _comment:
        'Transcribed from the 42 page images of "Trekeasy - 500 Seed Users" (the .docx was deleted before it could be parsed). Validated by scripts/build-500-dataset.mjs: email shape, real calendar dates, and email/username cross-checked against each password. The random 5-digit email suffixes and the DOB digits cannot be validated by anything — they are transcription, so treat a sign-in failure for a single row as a likely misread.',
      users,
    },
    null,
    2
  )}\n`
);
console.log(`\nwrote ${users.length} users → ${outPath}`);
if (problems.length) process.exitCode = 1;
