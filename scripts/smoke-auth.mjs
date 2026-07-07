// End-to-end auth smoke test against a running instance:
// logs in, captures the session cookie, and calls /api/auth/me with it.
// Prints PASS/FAIL per step and diagnoses the classic LAN pitfall where a
// Secure cookie is served over plain HTTP (browser would drop it).
//
//   node scripts/smoke-auth.mjs http://localhost:3000 user@example.com password
//   node scripts/smoke-auth.mjs http://192.168.0.216:3002 user@example.com password
const [baseUrl, email, password] = process.argv.slice(2);

if (!baseUrl || !email || !password) {
  console.error('Usage: node scripts/smoke-auth.mjs <baseUrl> <email> <password>');
  process.exit(1);
}

const base = baseUrl.replace(/\/+$/, '');
let failures = 0;

function report(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures += 1;
}

try {
  const health = await fetch(`${base}/api/health`);
  report(health.ok, 'GET /api/health', `HTTP ${health.status}`);

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const loginData = await loginRes.json().catch(() => ({}));
  report(loginRes.ok, 'POST /api/auth/login', `HTTP ${loginRes.status}${loginData.error ? ` (${loginData.error})` : ''}`);

  const setCookie = loginRes.headers.get('set-cookie') || '';
  report(setCookie.includes('token='), 'Set-Cookie contains a session token');

  const secureOverHttp = /;\s*secure/i.test(setCookie) && base.startsWith('http://');
  report(
    !secureOverHttp,
    'Cookie flags match the URL scheme',
    secureOverHttp
      ? 'cookie is marked Secure but this URL is plain HTTP - browsers will DROP it and every login will look expired. Unset COOKIE_SECURE / check APP_URL.'
      : 'ok'
  );

  const cookie = setCookie.split(';')[0];
  const meRes = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  const meData = await meRes.json().catch(() => ({}));
  report(
    meRes.ok,
    'GET /api/auth/me with the login cookie',
    meRes.ok ? `signed in as ${meData.user?.username} (admin: ${!!meData.user?.isAdmin})` : `HTTP ${meRes.status}`
  );
} catch (err) {
  report(false, 'Request failed', err.message);
}

console.log(failures ? `\n${failures} check(s) FAILED.` : '\nAll auth checks passed.');
process.exit(failures ? 1 : 0);
