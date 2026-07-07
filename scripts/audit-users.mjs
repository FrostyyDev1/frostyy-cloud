// Read-only report on data/users.json: duplicates, missing password hashes,
// bad emails, disabled accounts. Never modifies anything - fix records by
// hand (or delete/re-invite) after backing up the file.
//
//   node scripts/audit-users.mjs
//   node scripts/audit-users.mjs /path/to/users.json
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usersFile = process.argv[2] || path.join(__dirname, '..', 'data', 'users.json');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_RE = /^\$2[abxy]\$/;

const normalize = (v) => String(v || '').trim().toLowerCase();
const hasUsableHash = (u) =>
  [u.password, u.passwordHash].some((v) => typeof v === 'string' && BCRYPT_RE.test(v));

if (!fs.existsSync(usersFile)) {
  console.error(`No users file found at ${usersFile}`);
  process.exit(1);
}

let users;
try {
  users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
} catch (err) {
  console.error(`users.json is not valid JSON: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(users)) {
  console.error('users.json is not an array.');
  process.exit(1);
}

const label = (u, i) => `#${i} username=${JSON.stringify(u.username ?? null)} email=${JSON.stringify(u.email ?? null)}`;
const section = (title, rows) => {
  console.log(`\n${title}: ${rows.length ? '' : 'none'}`);
  rows.forEach((r) => console.log(`  - ${r}`));
};

console.log(`Auditing ${usersFile} (${users.length} record${users.length === 1 ? '' : 's'})`);

// Duplicate identities: same normalized username OR email on multiple records.
const byIdentity = new Map();
users.forEach((u, i) => {
  const keys = new Set([normalize(u.username), normalize(u.email)].filter(Boolean));
  keys.forEach((key) => {
    if (!byIdentity.has(key)) byIdentity.set(key, []);
    byIdentity.get(key).push(i);
  });
});
const duplicateRows = [];
for (const [key, indexes] of byIdentity) {
  if (indexes.length < 2) continue;
  duplicateRows.push(`${key} appears on ${indexes.length} records:`);
  indexes.forEach((i) => {
    const u = users[i];
    const flags = [
      hasUsableHash(u) ? 'has hash' : 'NO USABLE HASH',
      u.disabled ? 'disabled' : 'enabled',
      u.role === 'admin' ? 'admin' : 'user'
    ].join(', ');
    duplicateRows.push(`    ${label(u, i)} (${flags})`);
  });
}
section('Duplicate emails/usernames', duplicateRows);

section(
  'Records without a usable bcrypt password hash (cannot log in)',
  users.map((u, i) => (hasUsableHash(u) ? null : label(u, i))).filter(Boolean)
);

section(
  'Records with a blank or invalid email (and no email-shaped username)',
  users
    .map((u, i) => {
      const emailOk = EMAIL_RE.test(normalize(u.email));
      const usernameOk = EMAIL_RE.test(normalize(u.username));
      return emailOk || usernameOk ? null : label(u, i);
    })
    .filter(Boolean)
);

section(
  'Records where username and email disagree (possibly swapped fields)',
  users
    .map((u, i) => {
      const un = normalize(u.username);
      const em = normalize(u.email);
      return un && em && un !== em ? `${label(u, i)}` : null;
    })
    .filter(Boolean)
);

section(
  'Disabled accounts',
  users.map((u, i) => (u.disabled ? label(u, i) : null)).filter(Boolean)
);

section(
  'Records using the legacy passwordHash field (self-heals on next login)',
  users.map((u, i) => (typeof u.passwordHash === 'string' ? label(u, i) : null)).filter(Boolean)
);

section(
  'Admin accounts (role=admin in users.json)',
  users.map((u, i) => ((u.role || 'user') === 'admin' ? label(u, i) : null)).filter(Boolean)
);

const envAdmins = String(process.env.ADMIN_EMAILS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const knownIdentities = new Set(users.flatMap((u) => [normalize(u.username), normalize(u.email)]).filter(Boolean));
section(
  'ADMIN_EMAILS entries with no matching user account yet',
  envAdmins.filter((e) => !knownIdentities.has(e))
);

console.log('\nThis audit is read-only. Back up data/users.json before editing it.');
console.log('Note: login prefers the enabled record that has a password hash, so');
console.log('duplicate hashless records are ignored at login but still worth removing.');
