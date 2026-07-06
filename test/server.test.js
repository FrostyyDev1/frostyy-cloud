import test from 'node:test';
import assert from 'node:assert/strict';
import { app, parseAdminEmailList, matchesAdminEmail } from '../server.js';

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
