import test from 'node:test';
import assert from 'node:assert/strict';
import { app, parseAdminEmailList, matchesAdminEmail, resolveUserQuotaSource, resolveUserQuotaMb, countActiveAdmins } from '../server.js';

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
