// Spins up a throwaway copy of the server (own temp data dir, random port),
// hammers it with concurrent requests, and verifies the JSON data files stay
// valid and no writes were silently lost. Never touches real project data.
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}`;

function log(msg) { console.log(`[concurrency-test] ${msg}`); }

async function waitForHealth(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server did not become healthy in time');
}

function extractCookie(res) {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

async function run() {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'frostyy-concurrency-'));
  log(`Using throwaway server dir: ${tempDir}`);
  for (const item of ['server.js', 'package.json', 'package-lock.json', 'public', 'node_modules']) {
    cpSync(path.join(projectRoot, item), path.join(tempDir, item), { recursive: true });
  }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: tempDir,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', (d) => { serverOutput += d.toString(); });
  child.stderr.on('data', (d) => { serverOutput += d.toString(); });

  let failures = 0;
  try {
    await waitForHealth();
    log('Server is up. Running concurrency scenarios...');

    // --- Scenario 1: N concurrent registrations must all persist ---
    const REGISTER_COUNT = 25;
    const registerResults = await Promise.all(
      Array.from({ length: REGISTER_COUNT }, (_, i) =>
        fetch(`${BASE}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: `stress_user_${i}@example.com`, password: 'password123' })
        })
      )
    );
    const registerOk = registerResults.filter((r) => r.ok).length;
    log(`Concurrent registrations: ${registerOk}/${REGISTER_COUNT} succeeded`);

    const usersFile = path.join(tempDir, 'data', 'users.json');
    const users = JSON.parse(readFileSync(usersFile, 'utf8')); // throws if corrupt
    const stressUsers = users.filter((u) => u.username.startsWith('stress_user_'));
    if (stressUsers.length !== REGISTER_COUNT) {
      failures += 1;
      console.error(`FAIL: expected ${REGISTER_COUNT} persisted users, found ${stressUsers.length} (writes were lost)`);
    } else {
      log(`PASS: all ${REGISTER_COUNT} concurrent registrations persisted correctly`);
    }

    // --- Scenario 2: concurrent folder creates + uploads + renames + favorites + deletes ---
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'stress_user_0@example.com', password: 'password123' })
    });
    const cookie = extractCookie(loginRes);
    const authHeaders = { Cookie: cookie };

    const FOLDER_COUNT = 15;
    const folderResults = await Promise.all(
      Array.from({ length: FOLDER_COUNT }, (_, i) =>
        fetch(`${BASE}/api/folders`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Folder${i}` })
        })
      )
    );
    log(`Concurrent folder creates: ${folderResults.filter((r) => r.ok).length}/${FOLDER_COUNT} succeeded`);

    const UPLOAD_COUNT = 20;
    const uploadResults = await Promise.all(
      Array.from({ length: UPLOAD_COUNT }, (_, i) => {
        const form = new FormData();
        form.append('file', new Blob([`content ${i}`], { type: 'text/plain' }), `stress-${i}.txt`);
        return fetch(`${BASE}/api/files/upload`, { method: 'POST', headers: authHeaders, body: form });
      })
    );
    const uploadOk = uploadResults.filter((r) => r.ok).length;
    log(`Concurrent uploads: ${uploadOk}/${UPLOAD_COUNT} succeeded`);

    const storageFile = path.join(tempDir, 'data', 'storage.json');
    const storageItems = JSON.parse(readFileSync(storageFile, 'utf8')); // throws if corrupt
    const persistedFolders = storageItems.filter((i) => i.type === 'folder' && i.name.startsWith('Folder')).length;
    const persistedUploads = storageItems.filter((i) => i.type === 'file' && i.name.startsWith('stress-')).length;

    if (persistedFolders !== FOLDER_COUNT) {
      failures += 1;
      console.error(`FAIL: expected ${FOLDER_COUNT} folders, found ${persistedFolders}`);
    } else {
      log(`PASS: all ${FOLDER_COUNT} concurrent folders persisted correctly`);
    }
    if (persistedUploads !== UPLOAD_COUNT) {
      failures += 1;
      console.error(`FAIL: expected ${UPLOAD_COUNT} uploaded files, found ${persistedUploads}`);
    } else {
      log(`PASS: all ${UPLOAD_COUNT} concurrent uploads persisted correctly`);
    }

    // Mixed concurrent mutations on the same items (rename + favorite + move) shouldn't corrupt the file.
    const fileIds = storageItems.filter((i) => i.type === 'file' && i.name.startsWith('stress-')).map((i) => i.id);
    await Promise.all(
      fileIds.map((id, i) =>
        Promise.all([
          fetch(`${BASE}/api/files/${id}/favorite`, { method: 'POST', headers: authHeaders }),
          fetch(`${BASE}/api/files/${id}/rename`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: `renamed-${i}.txt` })
          })
        ])
      )
    );
    const afterMutations = JSON.parse(readFileSync(storageFile, 'utf8')); // throws if corrupt
    log(`PASS: storage.json still valid JSON after ${fileIds.length * 2} concurrent mixed mutations (${afterMutations.length} total items)`);
  } catch (err) {
    failures += 1;
    console.error('FAIL:', err.message);
    console.error('--- server output ---');
    console.error(serverOutput);
  } finally {
    child.kill();
    // On Windows, killed child processes can hold file handles open briefly
    // after kill() returns, so give the OS a moment before removing the dir.
    await new Promise((r) => setTimeout(r, 400));
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (cleanupErr) {
      console.warn(`[concurrency-test] Could not fully clean up ${tempDir}: ${cleanupErr.message}`);
    }
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll concurrency checks passed.');
}

run();
