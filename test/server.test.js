import test from 'node:test';
import assert from 'node:assert/strict';
import {
  app,
  parseAdminEmailList,
  matchesAdminEmail,
  resolveUserQuotaSource,
  resolveUserQuotaMb,
  countActiveAdmins,
  normalizeEmail,
  getPasswordHash,
  findAccountCandidates,
  pickLoginRecord,
  loginIdentifierFrom,
  hashResetToken,
  findValidResetRecord,
  generateTempPassword,
  isValidBackupName
} from '../server.js';

test('server exposes the app', () => {
  assert.ok(app);
});

test('parseAdminEmailList: single email', () => {
  assert.deepEqual(parseAdminEmailList('me@example.com'), ['me@example.com']);
});

test('parseAdminEmailList: comma-separated with spaces', () => {
  assert.deepEqual(
    parseAdminEmailList(' Me@Example.com ,  other@Example.com,third@example.com '),
    ['me@example.com', 'other@example.com', 'third@example.com']
  );
});

test('parseAdminEmailList: empty/unset', () => {
  assert.deepEqual(parseAdminEmailList(''), []);
  assert.deepEqual(parseAdminEmailList(undefined), []);
});

test('matchesAdminEmail: exact match', () => {
  assert.equal(matchesAdminEmail(['me@example.com'], ['me@example.com']), true);
});

test('matchesAdminEmail: case-insensitive match', () => {
  assert.equal(matchesAdminEmail(['ME@EXAMPLE.COM'], ['me@example.com']), true);
});

test('matchesAdminEmail: whitespace-tolerant match', () => {
  assert.equal(matchesAdminEmail(['  me@example.com  '], ['me@example.com']), true);
});

test('matchesAdminEmail: falls back to username candidate', () => {
  assert.equal(matchesAdminEmail(['', 'legacyusername'], ['legacyusername']), true);
});

test('matchesAdminEmail: no match', () => {
  assert.equal(matchesAdminEmail(['someone@else.com'], ['me@example.com']), false);
});

test('matchesAdminEmail: empty admin list never matches', () => {
  assert.equal(matchesAdminEmail(['me@example.com'], []), false);
});

test('resolveUserQuotaSource: custom quota takes priority over role', () => {
  assert.equal(resolveUserQuotaSource({ role: 'admin', quotaMb: 20480 }), 'custom');
  assert.equal(resolveUserQuotaSource({ role: 'user', quotaMb: -1 }), 'custom');
});

test('resolveUserQuotaSource: falls back to role-based tiers', () => {
  assert.equal(resolveUserQuotaSource({ role: 'admin' }), 'admin-default');
  assert.equal(resolveUserQuotaSource({ role: 'user' }), 'user-default');
  assert.equal(resolveUserQuotaSource({}), 'user-default');
});

test('resolveUserQuotaMb: admin gets a larger quota than a plain user by default', () => {
  const adminQuota = resolveUserQuotaMb({ role: 'admin' });
  const userQuota = resolveUserQuotaMb({ role: 'user' });
  assert.ok(adminQuota > userQuota, `expected admin quota (${adminQuota}) > user quota (${userQuota})`);
});

test('resolveUserQuotaMb: custom quota overrides role-based quota', () => {
  assert.equal(resolveUserQuotaMb({ role: 'admin', quotaMb: 1234 }), 1234);
  assert.equal(resolveUserQuotaMb({ role: 'user', quotaMb: 'unlimited' }), Infinity);
  assert.equal(resolveUserQuotaMb({ role: 'user', quotaMb: -1 }), Infinity);
});

test('countActiveAdmins: counts only enabled admins, with optional exclusion', () => {
  const users = [
    { username: 'a', role: 'admin', disabled: false },
    { username: 'b', role: 'admin', disabled: true },
    { username: 'c', role: 'user', disabled: false }
  ];
  assert.equal(countActiveAdmins(users), 1);
  assert.equal(countActiveAdmins(users, 'a'), 0);
});

// A real (cheap) bcrypt hash so getPasswordHash format checks pass.
const FAKE_HASH = '$2a$04$saltsaltsaltsaltsalts.abcdefghijklmnopqrstuvwxyzABCDEF';

test('normalizeEmail: trims, lowercases, never throws on junk', () => {
  assert.equal(normalizeEmail('  Me@Example.COM  '), 'me@example.com');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(42), '42');
});

test('getPasswordHash: reads password, falls back to legacy passwordHash', () => {
  assert.equal(getPasswordHash({ password: FAKE_HASH }), FAKE_HASH);
  assert.equal(getPasswordHash({ passwordHash: FAKE_HASH }), FAKE_HASH);
  assert.equal(getPasswordHash({ password: FAKE_HASH, passwordHash: 'other' }), FAKE_HASH);
});

test('getPasswordHash: rejects plaintext, blank, and missing values', () => {
  assert.equal(getPasswordHash({}), null);
  assert.equal(getPasswordHash({ password: 'hunter2-plaintext' }), null);
  assert.equal(getPasswordHash({ password: '' }), null);
  assert.equal(getPasswordHash({ password: null, passwordHash: undefined }), null);
});

test('findAccountCandidates: matches username or email, case-insensitively, tolerating malformed records', () => {
  const users = [
    { username: 'Jacob@Example.com' },
    { email: 'jacob@example.com' }, // swapped/partial record: no username
    { username: 'other@example.com' },
    {} // fully malformed record must not crash the lookup
  ];
  assert.equal(findAccountCandidates(users, ' JACOB@example.COM ').length, 2);
  assert.equal(findAccountCandidates(users, 'missing@example.com').length, 0);
  assert.equal(findAccountCandidates(users, '').length, 0);
});

test('pickLoginRecord: prefers the enabled record with a hash over malformed duplicates', () => {
  const hashless = { username: 'jacob@example.com' };
  const good = { username: 'jacob@example.com', password: FAKE_HASH };
  // Hashless duplicate listed first - the old code picked it and crashed.
  assert.equal(pickLoginRecord([hashless, good], 'jacob@example.com'), good);
});

test('pickLoginRecord: falls back to a disabled record with a hash (so the disabled error is shown)', () => {
  const disabled = { username: 'jacob@example.com', password: FAKE_HASH, disabled: true };
  const hashless = { username: 'jacob@example.com' };
  assert.equal(pickLoginRecord([hashless, disabled], 'jacob@example.com'), disabled);
});

test('pickLoginRecord: returns null when no candidate has a usable hash', () => {
  const users = [
    { username: 'jacob@example.com' },
    { username: 'jacob@example.com', password: 'plaintext-junk' }
  ];
  assert.equal(pickLoginRecord(users, 'jacob@example.com'), null);
});

test('pickLoginRecord: finds accounts via the email field when username is swapped', () => {
  const swapped = { username: 'Jacob Wiseman', email: 'jacob@example.com', password: FAKE_HASH };
  assert.equal(pickLoginRecord([swapped], 'jacob@example.com'), swapped);
});

test('loginIdentifierFrom: email-only body works (the UI sends email, not username)', () => {
  assert.equal(loginIdentifierFrom({ email: 'frostyythedevv@gmail.com', password: 'x' }), 'frostyythedevv@gmail.com');
  assert.equal(loginIdentifierFrom({ email: '  Frostyythedevv@Gmail.COM ' }), 'frostyythedevv@gmail.com');
});

test('loginIdentifierFrom: username still accepted as a legacy fallback', () => {
  assert.equal(loginIdentifierFrom({ username: 'old@example.com' }), 'old@example.com');
  // email wins when both are present
  assert.equal(loginIdentifierFrom({ email: 'new@example.com', username: 'old@example.com' }), 'new@example.com');
});

test('loginIdentifierFrom: empty for missing/blank/malformed bodies', () => {
  assert.equal(loginIdentifierFrom({}), '');
  assert.equal(loginIdentifierFrom(undefined), '');
  assert.equal(loginIdentifierFrom({ email: '   ' }), '');
});

test('hashResetToken: deterministic sha256, never the raw token', () => {
  const token = 'abc123-example-token';
  const hash = hashResetToken(token);
  assert.equal(hash, hashResetToken(token));
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.ok(!hash.includes(token));
});

test('findValidResetRecord: matches only unused, unexpired records with the right hash', () => {
  const now = Date.now();
  const future = new Date(now + 60000).toISOString();
  const past = new Date(now - 60000).toISOString();
  const hash = hashResetToken('good-token');
  const valid = { username: 'a@example.com', tokenHash: hash, used: false, expiresAt: future };

  assert.equal(findValidResetRecord([valid], hash, now), valid);
  assert.equal(findValidResetRecord([{ ...valid, used: true }], hash, now), null);
  assert.equal(findValidResetRecord([{ ...valid, expiresAt: past }], hash, now), null);
  assert.equal(findValidResetRecord([valid], hashResetToken('wrong-token'), now), null);
  assert.equal(findValidResetRecord([], hash, now), null);
});

test('generateTempPassword: long enough to pass the password policy, and random', () => {
  const a = generateTempPassword();
  const b = generateTempPassword();
  assert.ok(a.length >= 8, `expected >= 8 chars, got ${a.length}`);
  assert.notEqual(a, b);
});

test('isValidBackupName: accepts only timestamped backup archives', () => {
  assert.equal(isValidBackupName('frostyy-backup-2026-07-07-153000.tar.gz'), true);
  assert.equal(isValidBackupName('frostyy-backup-2026-1-1-1.tar.gz'), false);
  assert.equal(isValidBackupName('other-file.tar.gz'), false);
  assert.equal(isValidBackupName(''), false);
  assert.equal(isValidBackupName(undefined), false);
});

test('isValidBackupName: blocks path traversal and lookalike names', () => {
  assert.equal(isValidBackupName('../frostyy-backup-2026-07-07-153000.tar.gz'), false);
  assert.equal(isValidBackupName('..\\frostyy-backup-2026-07-07-153000.tar.gz'), false);
  assert.equal(isValidBackupName('frostyy-backup-2026-07-07-153000.tar.gz/../../.env'), false);
  assert.equal(isValidBackupName('frostyy-backup-2026-07-07-153000.tar.gz.exe'), false);
  assert.equal(isValidBackupName('/etc/passwd'), false);
});
