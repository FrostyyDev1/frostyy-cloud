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
  pickLoginRecord
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
