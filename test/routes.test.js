// Route-level integration tests against a disposable server copy running in
// a temp dir (own data/ and uploads/, random port). Mirrors the pattern used
// by scripts/concurrency-check.mjs; never touches real project data.
//
// Deliberately spawned with NODE_ENV=production, REGISTRATION_MODE=invite
// (deprecated, must behave as open) and a SESSION_SECRET, so the suite proves
// the exact configuration the Raspberry Pi runs with works over plain HTTP.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PORT = 25000 + Math.floor(Math.random() * 10000);
const BASE = `http://localhost:${PORT}`;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let child = null;
let tempDir = null;

async function waitForHealth(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Disposable server did not become healthy in time');
}

function cookieFrom(res) {
  return (res.headers.get('set-cookie') || '').split(';')[0];
}

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'frostyy-routes-'));
  for (const item of ['server.js', 'package.json', 'public', 'node_modules']) {
    cpSync(path.join(projectRoot, item), path.join(tempDir, item), { recursive: true });
  }
  child = spawn(process.execPath, ['server.js'], {
    cwd: tempDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      REGISTRATION_MODE: 'invite', // deprecated - must not block signup
      INVITE_CODES: 'legacy-code-should-be-ignored',
      ADMIN_EMAILS: 'admin@test.local',
      SESSION_SECRET: 'routes-test-secret',
      APP_URL: '' // plain HTTP: cookies must NOT be marked Secure
    },
    stdio: 'ignore'
  });
  await waitForHealth();
});

after(async () => {
  child?.kill();
  // Windows: killed children can hold file handles open briefly.
  await new Promise((r) => setTimeout(r, 400));
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch { /* best effort */ }
});

test('startup creates missing data files safely', () => {
  for (const file of ['users.json', 'storage.json', 'activity.json', 'invites.json', 'password-resets.json']) {
    assert.ok(existsSync(path.join(tempDir, 'data', file)), `${file} should exist`);
  }
});

test('signup works with email + password only - no invite code, even in legacy invite mode', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local', password: 'password123' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.username, 'admin@test.local');
  assert.ok(cookieFrom(res).startsWith('token='), 'signup should set a session cookie');
});

test('duplicate email signup is rejected case-insensitively', async () => {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: '  ADMIN@TEST.LOCAL ', password: 'password123' })
  });
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.match(data.error, /already exists/);
});

test('login validation: missing email and missing password each return a specific 400', async () => {
  let res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ password: 'password123' })
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Email is required');

  res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local' })
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'Password is required');
});

test('email-only login sets a usable, non-Secure session cookie and /api/auth/me works', async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local', password: 'password123' })
  });
  assert.equal(login.status, 200);

  const rawCookie = login.headers.get('set-cookie') || '';
  assert.ok(rawCookie.includes('token='), 'login should set a session cookie');
  // The Raspberry Pi serves plain HTTP: a Secure-flagged cookie would be
  // dropped by browsers and every login would instantly "expire".
  assert.ok(!/;\s*secure/i.test(rawCookie), 'cookie must not be Secure on plain-HTTP deployments');

  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookieFrom(login) } });
  assert.equal(me.status, 200);
  const data = await me.json();
  assert.equal(data.user.username, 'admin@test.local');
  assert.equal(data.user.isAdmin, true);
});

test('env admin (ADMIN_EMAILS) can list users in the admin panel, including themselves', async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local', password: 'password123' })
  });
  const res = await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: cookieFrom(login) } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.users) && data.users.length >= 1);
  assert.ok(data.users.some((u) => u.username === 'admin@test.local'), 'admin should appear in their own users table');
});

async function adminCookie() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local', password: 'password123' })
  });
  return cookieFrom(login);
}

async function nonAdminCookie() {
  // Idempotent: register succeeds the first time, 409s after; login always works.
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'plain@test.local', password: 'password123' })
  });
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'plain@test.local', password: 'password123' })
  });
  return cookieFrom(login);
}

test('health endpoint requires admin and returns only safe fields', async () => {
  // no session -> 401, non-admin -> 403
  assert.equal((await fetch(`${BASE}/api/admin/health`)).status, 401);
  assert.equal((await fetch(`${BASE}/api/admin/health`, { headers: { Cookie: await nonAdminCookie() } })).status, 403);

  const res = await fetch(`${BASE}/api/admin/health`, { headers: { Cookie: await adminCookie() } });
  assert.equal(res.status, 200);
  const body = await res.text();
  const data = JSON.parse(body);

  assert.ok(['healthy', 'warning', 'critical'].includes(data.summary.status));
  assert.ok(Array.isArray(data.checks) && data.checks.length > 0);
  assert.equal(data.info.version !== undefined, true);
  assert.ok(data.info.users.total >= 2);

  // Never leak secrets: the session secret value, bcrypt hashes, or tokens.
  assert.ok(!body.includes('routes-test-secret'), 'health response must not contain the session secret');
  assert.ok(!/\$2[abxy]\$/.test(body), 'health response must not contain password hashes');
  assert.ok(!body.includes('tokenHash'), 'health response must not contain reset token hashes');
});

test('backup endpoints require admin', async () => {
  const cookie = await nonAdminCookie();
  assert.equal((await fetch(`${BASE}/api/admin/backups`, { headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/backups`, { method: 'POST', headers: { Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${BASE}/api/admin/backups/frostyy-backup-2026-07-07-000000.tar.gz`, { headers: { Cookie: cookie } })).status, 403);
});

test('backup lifecycle: create, list, download-name validation, delete', async () => {
  const cookie = await adminCookie();

  const create = await fetch(`${BASE}/api/admin/backups`, { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(create.status, 200, 'backup creation should succeed (requires tar on PATH)');
  const created = await create.json();
  assert.match(created.name, /^frostyy-backup-\d{4}-\d{2}-\d{2}-\d{6}\.tar\.gz$/);
  assert.ok(created.size > 0);

  const list = await fetch(`${BASE}/api/admin/backups`, { headers: { Cookie: cookie } });
  const listed = await list.json();
  assert.ok(listed.backups.some((b) => b.name === created.name), 'new backup should appear in the list');

  // Path traversal attempts must never reach the filesystem.
  for (const evil of ['..%2F..%2F.env', '..%5C..%5Cserver.js', encodeURIComponent('../data/users.json')]) {
    const res = await fetch(`${BASE}/api/admin/backups/${evil}`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404, `traversal name ${evil} should 404`);
    const del = await fetch(`${BASE}/api/admin/backups/${evil}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(del.status, 404, `traversal delete ${evil} should 404`);
  }

  const download = await fetch(`${BASE}/api/admin/backups/${created.name}`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);

  const del = await fetch(`${BASE}/api/admin/backups/${created.name}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal(del.status, 200);
  const after = await (await fetch(`${BASE}/api/admin/backups`, { headers: { Cookie: cookie } })).json();
  assert.ok(!after.backups.some((b) => b.name === created.name), 'deleted backup should be gone');
});

test('upload stores the file and it appears in the file list', async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email: 'admin@test.local', password: 'password123' })
  });
  const cookie = cookieFrom(login);

  const form = new FormData();
  form.append('file', new Blob(['integration test content'], { type: 'text/plain' }), 'routes-test.txt');
  const upload = await fetch(`${BASE}/api/files/upload`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  assert.equal(upload.status, 200);

  const list = await fetch(`${BASE}/api/files`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  const data = await list.json();
  const uploaded = (data.items || []).find((i) => i.type === 'file' && i.name === 'routes-test.txt');
  assert.ok(uploaded, 'uploaded file should appear in the listing');
});
