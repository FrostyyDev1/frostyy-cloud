import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
// MAX_UPLOAD_MB is the current name; MAX_FILE_SIZE_MB is kept as a fallback for existing .env files.
const MAX_FILE_SIZE_MB = Number(process.env.MAX_UPLOAD_MB || process.env.MAX_FILE_SIZE_MB) || 20;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
/** Parses a quota env var / stored value. Accepts a positive number of MB, or
 * "unlimited"/"-1" for no limit (returned as Infinity). Falls back to
 * `fallback` if the value is missing or not a valid positive number. */
function parseQuotaMb(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed === 'unlimited' || trimmed === '-1') return Infinity;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Converts an internal quota (possibly Infinity) to a JSON-safe value for
 * API responses, since JSON has no representation for Infinity. */
function quotaMbForClient(quotaMb) {
  return quotaMb === Infinity ? -1 : quotaMb;
}

/** Formats a quota in MB as a human-readable string (e.g. "5 GB", "500 MB"). */
function formatMb(mb) {
  if (mb === Infinity) return 'unlimited storage';
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

// DEFAULT_USER_QUOTA_MB is the current name; STORAGE_QUOTA_MB is kept as a fallback for existing .env files.
const STORAGE_QUOTA_MB = parseQuotaMb(process.env.DEFAULT_USER_QUOTA_MB || process.env.STORAGE_QUOTA_MB, 5120);
// Quota for accounts with the admin role (or listed in ADMIN_EMAILS). Accepts "unlimited" or "-1" for no cap.
const ADMIN_USER_QUOTA_MB = parseQuotaMb(process.env.ADMIN_USER_QUOTA_MB, 102400);
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS) || 30;
/** Parses a comma-separated email list (ADMIN_EMAILS-style): trims whitespace
 * around each entry and each comma, lowercases for case-insensitive matching,
 * and drops empty entries. Works for a single email or many. */
function parseAdminEmailList(raw) {
  return String(raw || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True if any of the given candidate identifiers (email, username, etc.)
 * case-insensitively matches an entry in the admin list. Checking the
 * username too makes admin detection work even for accounts that never set
 * a separate email address. */
function matchesAdminEmail(candidates, adminList) {
  if (!adminList.length) return false;
  const normalized = candidates.filter(Boolean).map((c) => String(c).trim().toLowerCase());
  return normalized.some((c) => adminList.includes(c));
}

const ADMIN_EMAILS = parseAdminEmailList(process.env.ADMIN_EMAILS);
console.log(ADMIN_EMAILS.length
  ? `[admin] ADMIN_EMAILS configured with ${ADMIN_EMAILS.length} address(es).`
  : '[admin] ADMIN_EMAILS not set - only the first registered account will be admin.');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PREVIEWABLE_TYPES = ['image/', 'application/pdf'];
const SESSION_SECRET = process.env.SESSION_SECRET || null;
const TRUST_PROXY = process.env.TRUST_PROXY !== undefined ? process.env.TRUST_PROXY : '1';
const APP_URL = process.env.APP_URL || '';
const REGISTRATION_MODE = ['open', 'invite', 'disabled'].includes(process.env.REGISTRATION_MODE) ? process.env.REGISTRATION_MODE : 'open';
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0';

if (IS_PRODUCTION && !SESSION_SECRET) {
  console.warn('[security] SESSION_SECRET is not set. Set it in production so session cookies are signed and tamper-evident.');
}
if (IS_PRODUCTION && REGISTRATION_MODE === 'open') {
  console.warn('[security] REGISTRATION_MODE=open in production - anyone can create an account. Set REGISTRATION_MODE=invite or disabled for a public/beta deployment.');
}

const dataDir = path.join(__dirname, 'data');
const uploadsRoot = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');
const usersFile = path.join(dataDir, 'users.json');
const storageFile = path.join(dataDir, 'storage.json');
const activityFile = path.join(dataDir, 'activity.json');
const ticketsFile = path.join(dataDir, 'tickets.json');
const invitesFile = path.join(dataDir, 'invites.json');
const passwordResetsFile = path.join(dataDir, 'password-resets.json');

for (const dir of [dataDir, uploadsRoot, publicDir, path.join(uploadsRoot, '_tmp')]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, JSON.stringify([], null, 2));
}
if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify([], null, 2));
}
if (!fs.existsSync(activityFile)) {
  fs.writeFileSync(activityFile, JSON.stringify([], null, 2));
}
if (!fs.existsSync(ticketsFile)) {
  fs.writeFileSync(ticketsFile, JSON.stringify([], null, 2));
}
if (!fs.existsSync(invitesFile)) {
  fs.writeFileSync(invitesFile, JSON.stringify([], null, 2));
}
if (!fs.existsSync(passwordResetsFile)) {
  fs.writeFileSync(passwordResetsFile, JSON.stringify([], null, 2));
}

// Seed any codes listed in INVITE_CODES (comma-separated) into invites.json on
// startup, without touching codes that already exist there (so re-deploying
// doesn't reset who has used a code).
{
  const seedCodes = (process.env.INVITE_CODES || '').split(',').map((c) => c.trim()).filter(Boolean);
  if (seedCodes.length) {
    const existing = JSON.parse(fs.readFileSync(invitesFile, 'utf8'));
    const existingCodes = new Set(existing.map((i) => i.code));
    const additions = seedCodes.filter((code) => !existingCodes.has(code)).map((code) => ({ code, used: false, usedBy: null, createdAt: new Date().toISOString() }));
    if (additions.length) {
      fs.writeFileSync(invitesFile, JSON.stringify([...existing, ...additions], null, 2));
    }
  }
}

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.dll', '.bat', '.cmd', '.com', '.scr', '.msi', '.msp',
  '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.jar', '.sh',
  '.app', '.apk', '.gadget', '.wsf', '.hta'
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(uploadsRoot, '_tmp'),
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`);
    }
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error('This file type is not allowed for security reasons'));
    }
    const allowed = ['image/', 'application/pdf', 'text/', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    const isAllowed = allowed.some((type) => file.mimetype.startsWith(type) || file.mimetype.includes('json') || file.mimetype.includes('xml'));
    if (isAllowed || file.mimetype === '') {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  }
});

app.set('trust proxy', TRUST_PROXY === 'false' ? false : (Number.isNaN(Number(TRUST_PROXY)) ? TRUST_PROXY : Number(TRUST_PROXY)));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(SESSION_SECRET || undefined));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

const MAINTENANCE_ALLOWLIST = new Set(['/api/health', '/api/config', '/api/auth/login', '/api/auth/me', '/api/auth/logout']);
app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();
  if (!req.path.startsWith('/api/') || MAINTENANCE_ALLOWLIST.has(req.path)) return next();
  const user = getUserFromCookie(req);
  if (user && user.role === 'admin') return next();
  return res.status(503).json({ error: 'Frostyy Cloud is currently in maintenance mode. Please check back soon.', maintenance: true });
});

app.use(express.static(publicDir));

const rateLimitBuckets = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    next();
  };
}
const authRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 50 });

/* ==========================================================================
   Safe JSON persistence
   - readJsonSafe: never throws; falls back and logs on corrupt/missing files.
   - writeJsonAtomic: writes to a temp file then renames over the target, so a
     crash mid-write can never leave a half-written/corrupt JSON file behind
     (rename is atomic on the same filesystem, both on Linux and Windows).
   - KeyedMutex/withUsersLock/withStorageLock: serialize whole
     read-modify-write sequences (including ones with an `await` in the
     middle, like bcrypt) per data file, so two concurrent requests can never
     both read the "before" state and then clobber each other's write.
   ========================================================================== */

function readJsonSafe(filePath, fallback = []) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[data] Failed to read ${path.basename(filePath)}: ${err.message}. Falling back to default.`);
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    console.error(`[data] Failed to write ${path.basename(filePath)}: ${err.message}`);
    throw err;
  }
}

class KeyedMutex {
  constructor() {
    this.chains = new Map();
  }
  run(key, fn) {
    const previous = this.chains.get(key) || Promise.resolve();
    const result = previous.then(fn, fn);
    // Keep the chain alive even after a failure, but swallow the error here
    // so it doesn't become an unhandled rejection - the real error still
    // propagates to the caller via `result`.
    this.chains.set(key, result.then(() => {}, () => {}));
    return result;
  }
}
const fileMutex = new KeyedMutex();

/**
 * Runs `updater(users)` with exclusive access to users.json for the duration
 * of the call (including any awaits inside updater, e.g. bcrypt). `updater`
 * mutates the array in place (push/splice/property edits) or returns a
 * `{ users, result }` object to fully replace the persisted array. Whatever
 * `updater` returns is passed back to the caller.
 */
async function withUsersLock(updater) {
  return fileMutex.run('users', async () => {
    const users = readJsonSafe(usersFile, []);
    const outcome = await updater(users);
    const nextUsers = outcome && outcome.users ? outcome.users : users;
    writeJsonAtomic(usersFile, nextUsers);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'result') ? outcome.result : outcome;
  });
}

/** Same as withUsersLock but for storage.json (files/folders metadata). */
async function withStorageLock(updater) {
  return fileMutex.run('storage', async () => {
    const items = readJsonSafe(storageFile, []);
    const outcome = await updater(items);
    const nextItems = outcome && outcome.items ? outcome.items : items;
    writeJsonAtomic(storageFile, nextItems);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'result') ? outcome.result : outcome;
  });
}

function readUsers() {
  return readJsonSafe(usersFile, []);
}

function readStorage() {
  return readJsonSafe(storageFile, []);
}

function readActivity() {
  return readJsonSafe(activityFile, []);
}

function writeActivity(items) {
  writeJsonAtomic(activityFile, items);
}

function readTickets() {
  return readJsonSafe(ticketsFile, []);
}

function writeTickets(items) {
  writeJsonAtomic(ticketsFile, items);
}

function readInvites() {
  return readJsonSafe(invitesFile, []);
}

/** Same locking pattern as withUsersLock/withStorageLock, for invites.json. */
async function withInvitesLock(updater) {
  return fileMutex.run('invites', async () => {
    const invites = readJsonSafe(invitesFile, []);
    const outcome = await updater(invites);
    const nextInvites = outcome && outcome.invites ? outcome.invites : invites;
    writeJsonAtomic(invitesFile, nextInvites);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'result') ? outcome.result : outcome;
  });
}

/** Same locking pattern, for password-resets.json. */
async function withResetsLock(updater) {
  return fileMutex.run('password-resets', async () => {
    const resets = readJsonSafe(passwordResetsFile, []);
    const outcome = await updater(resets);
    const nextResets = outcome && outcome.resets ? outcome.resets : resets;
    writeJsonAtomic(passwordResetsFile, nextResets);
    return outcome && Object.prototype.hasOwnProperty.call(outcome, 'result') ? outcome.result : outcome;
  });
}

function getUserFromCookie(req) {
  const token = SESSION_SECRET ? req.signedCookies?.token : req.cookies?.token;
  if (!token) return null;
  const users = readUsers();
  const user = users.find((entry) => entry.token === token) || null;
  // A disabled account's existing session is invalidated immediately, not
  // just blocked at the next login.
  if (user && user.disabled) return null;
  return user;
}

function generateToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeName(value) {
  return String(value || 'item')
    .trim()
    .replace(/[\\/]/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'item';
}

function createUniqueName(baseName, existingNames) {
  const ext = path.extname(baseName);
  const name = path.basename(baseName, ext);
  const safeName = sanitizeName(name);
  const rawExt = ext.replace(/^\./, '');
  const safeExt = rawExt ? sanitizeName(rawExt) : '';
  let candidate = safeExt ? `${safeName}.${safeExt}` : safeName;
  let counter = 1;
  while (existingNames.includes(candidate)) {
    candidate = safeExt ? `${safeName}-${counter}.${safeExt}` : `${safeName}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function getUserStorageDir(user) {
  const safeUser = sanitizeName(user.username);
  const dir = path.join(uploadsRoot, safeUser);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolves a stored relative path to an absolute path, rejecting anything
 * that would escape the uploads directory (defense in depth against path
 * traversal even though storagePath is always server-generated, never
 * taken verbatim from client input). */
function resolveUploadPath(relativePath) {
  const absolute = path.resolve(uploadsRoot, relativePath);
  if (!absolute.startsWith(uploadsRoot + path.sep) && absolute !== uploadsRoot) {
    return null;
  }
  return absolute;
}

/**
 * Resolves the effective storage quota (in MB, possibly Infinity) for a
 * user. Priority: a per-user custom quota (`user.quotaMb`, if ever set)
 * always wins; otherwise admins get ADMIN_USER_QUOTA_MB and everyone else
 * gets the default DEFAULT_USER_QUOTA_MB.
 */
function resolveUserQuotaMb(user) {
  if (user.quotaMb !== undefined && user.quotaMb !== null) {
    const custom = parseQuotaMb(user.quotaMb, null);
    if (custom !== null) return custom;
  }
  return (user.role || 'user') === 'admin' ? ADMIN_USER_QUOTA_MB : STORAGE_QUOTA_MB;
}

/** 'custom' if a per-user override is set, otherwise which default tier applies. */
function resolveUserQuotaSource(user) {
  if (user.quotaMb !== undefined && user.quotaMb !== null && parseQuotaMb(user.quotaMb, null) !== null) {
    return 'custom';
  }
  return (user.role || 'user') === 'admin' ? 'admin-default' : 'user-default';
}

/** True if this account's admin status comes from ADMIN_EMAILS (permanent/
 * recoverable via env var) rather than a manual promotion via the Admin panel. */
function isAdminByEnv(user) {
  return matchesAdminEmail([user.email, user.username], ADMIN_EMAILS);
}

/** Number of accounts that are currently admin AND not disabled, optionally
 * excluding one username - used to prevent locking yourself out of admin. */
function countActiveAdmins(users, excludeUsername = null) {
  return users.filter((u) => (u.role || 'user') === 'admin' && !u.disabled && u.username !== excludeUsername).length;
}

function getStorageSummary(user) {
  const items = getUserItems(user);
  const allItems = getUserItems(user, { includeTrashed: true });
  const totalSize = allItems.reduce((sum, item) => sum + (item.size || 0), 0);
  const fileCount = items.filter((item) => item.type === 'file').length;
  const trashedCount = allItems.filter((item) => item.trashed).length;
  return { totalSize, fileCount, trashedCount, items };
}

function getDescendantIds(allItems, folderId) {
  const ids = [];
  const children = allItems.filter((item) => item.parentId === folderId);
  for (const child of children) {
    ids.push(child.id);
    if (child.type === 'folder') ids.push(...getDescendantIds(allItems, child.id));
  }
  return ids;
}

function addActivity(user, action, details = {}) {
  const activities = readActivity();
  activities.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    username: user.username,
    action,
    details,
    createdAt: new Date().toISOString()
  });
  writeActivity(activities.slice(0, 100));
}

function toUserSafe(user) {
  const role = user.role || 'user';
  return {
    username: user.username,
    displayName: user.displayName || user.username,
    email: user.email || '',
    theme: user.theme || 'dark',
    role,
    isAdmin: role === 'admin',
    storageQuotaMb: quotaMbForClient(resolveUserQuotaMb(user))
  };
}

function ensureUserProfile(user) {
  if (!user.displayName) user.displayName = user.username;
  if (!user.theme) user.theme = 'dark';
  if (!user.role) user.role = 'user';
  // Match against both email and username, since some accounts (especially
  // older ones) never set a separate email address.
  if (matchesAdminEmail([user.email, user.username], ADMIN_EMAILS)) {
    user.role = 'admin';
  }
  return user;
}

function getEntryByIdOrName(user, entryName) {
  const items = getUserItems(user);
  return items.find((item) => item.id === entryName || item.name === entryName || item.displayName === entryName) || null;
}

function deleteEntryFiles(item) {
  if (!item || item.type !== 'file') return;
  const absolutePath = resolveUploadPath(item.storagePath);
  if (absolutePath && fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
}

function getUserItems(user, { includeTrashed = false } = {}) {
  return readStorage().filter((item) => item.owner === user.username && (includeTrashed || !item.trashed));
}

function buildFolderTree(items, parentId = null) {
  return items
    .filter((item) => item.type === 'folder' && item.parentId === parentId)
    .map((item) => ({ id: item.id, name: item.name, parentId: item.parentId, children: buildFolderTree(items, item.id) }));
}

function buildBreadcrumb(items, parentId) {
  const crumbPath = [];
  let currentId = parentId;
  while (currentId) {
    const folder = items.find((item) => item.id === currentId && item.type === 'folder');
    if (!folder) break;
    crumbPath.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parentId;
  }
  return crumbPath;
}

/** True if `candidateId` is `ancestorId` itself or a descendant of it. */
function isSameOrDescendant(items, candidateId, ancestorId) {
  let current = items.find((item) => item.id === candidateId);
  while (current) {
    if (current.id === ancestorId) return true;
    current = items.find((item) => item.id === current.parentId);
  }
  return false;
}

function purgeExpiredTrash(allItems) {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = allItems.filter((item) => item.trashed && item.trashedAt && new Date(item.trashedAt).getTime() < cutoff);
  if (!expired.length) return { items: allItems, result: 0 };
  const expiredIds = new Set(expired.map((item) => item.id));
  for (const item of expired) deleteEntryFiles(item);
  const remaining = allItems.filter((item) => !expiredIds.has(item.id));
  return { items: remaining, result: expired.length };
}

async function runTrashPurgeSweep() {
  try {
    const purgedCount = await withStorageLock((items) => purgeExpiredTrash(items));
    if (purgedCount) console.log(`[trash] Purged ${purgedCount} item(s) past the ${TRASH_RETENTION_DAYS}-day retention window.`);
  } catch (err) {
    console.error('[trash] Purge sweep failed:', err.message);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, message: 'Frostyy Cloud is running' });
});

// Plain, non-namespaced health check for reverse proxies / uptime monitors
// that expect it at the conventional /health path.
app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'Frostyy Cloud is running' });
});

app.get('/api/config', (_req, res) => {
  res.json({
    appName: 'Frostyy Cloud',
    version: APP_VERSION,
    registrationMode: REGISTRATION_MODE,
    maintenanceMode: MAINTENANCE_MODE
  });
});

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 7 * 24 * 60 * 60 * 1000, signed: !!SESSION_SECRET };
}

/** Lowercased, trimmed identifier for account comparisons. Never throws,
 * even when the field is missing on a malformed record. */
function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** Returns the account's bcrypt hash wherever it lives, or null.
 * The app writes `password`; manually-repaired or imported records sometimes
 * use `passwordHash`. Anything that doesn't look like a bcrypt hash (e.g. an
 * old plaintext password field) is treated as missing - never compared. */
function getPasswordHash(user) {
  for (const value of [user.password, user.passwordHash]) {
    if (typeof value === 'string' && /^\$2[abxy]\$/.test(value)) return value;
  }
  return null;
}

/** All records matching an email/username, case-insensitively, checking both
 * fields since some legacy records have them swapped or only one set. */
function findAccountCandidates(users, identifier) {
  const target = normalizeEmail(identifier);
  if (!target) return [];
  return users.filter((u) => normalizeEmail(u.username) === target || normalizeEmail(u.email) === target);
}

/** The account identifier from an auth request body. The UI sends `email`;
 * `username` is accepted as a backwards-compatible fallback for older
 * clients and scripts. Normalized (trim + lowercase), '' when absent. */
function loginIdentifierFrom(body) {
  return normalizeEmail(body?.email || body?.username);
}

/** Picks which record should authenticate when duplicates exist:
 * enabled-with-hash wins, then disabled-with-hash (so the user sees the
 * "account disabled" message instead of "invalid credentials"). Records
 * without a usable hash can never authenticate. */
function pickLoginRecord(users, identifier) {
  const candidates = findAccountCandidates(users, identifier);
  return (
    candidates.find((u) => !u.disabled && getPasswordHash(u)) ||
    candidates.find((u) => getPasswordHash(u)) ||
    null
  );
}

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  if (REGISTRATION_MODE === 'disabled') {
    return res.status(403).json({ error: 'Registration is currently disabled on this instance.' });
  }
  const { password, displayName, inviteCode } = req.body || {};
  // Email is the account identifier; `username` is a legacy alias for it.
  const username = loginIdentifierFrom(req.body);
  const email = username;
  if (!username || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check for an existing account BEFORE consuming an invite code, so a
    // duplicate signup doesn't burn the code. The authoritative re-check
    // still happens under the users lock below.
    if (findAccountCandidates(readUsers(), username).length) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    if (REGISTRATION_MODE === 'invite') {
      const code = String(inviteCode || '').trim();
      if (!code) return res.status(403).json({ error: 'An invite code is required to sign up.' });
      const inviteOutcome = await withInvitesLock((invites) => {
        const record = invites.find((i) => i.code === code);
        if (!record) return { result: { error: 'Invalid invite code.' } };
        if (record.used) return { result: { error: 'This invite code has already been used.' } };
        record.used = true;
        record.usedBy = username;
        record.usedAt = new Date().toISOString();
        return { result: { ok: true } };
      });
      if (inviteOutcome.error) return res.status(403).json({ error: inviteOutcome.error });
    }

    const outcome = await withUsersLock(async (users) => {
      if (findAccountCandidates(users, username).length) {
        return { result: { error: 'An account with this email already exists' } };
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const token = generateToken();
      const isFirstUser = users.length === 0;
      const createdUser = {
        username,
        password: hashedPassword,
        token,
        displayName: displayName || email.split('@')[0],
        email,
        theme: 'dark',
        role: isFirstUser || matchesAdminEmail([email, username], ADMIN_EMAILS) ? 'admin' : 'user'
      };
      users.push(createdUser);
      return { result: { user: createdUser } };
    });

    if (outcome.error) return res.status(409).json({ error: outcome.error });
    res.cookie('token', outcome.user.token, cookieOptions());
    res.json({ ok: true, user: toUserSafe(outcome.user) });
  } catch (err) {
    console.error('Register failed:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const { password } = req.body || {};
  const identifier = loginIdentifierFrom(req.body);
  if (!identifier) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const outcome = await withUsersLock(async (users) => {
      const user = pickLoginRecord(users, identifier);
      if (!user) return { result: { error: 'Invalid credentials' } };
      const hash = getPasswordHash(user);
      const valid = await bcrypt.compare(password, hash);
      if (!valid) return { result: { error: 'Invalid credentials' } };
      if (user.disabled) return { result: { error: 'This account has been disabled. Contact an administrator.', status: 403 } };
      // Converge the record: hashes belong in `password`. This self-heals
      // accounts that were repaired by hand using a `passwordHash` field.
      user.password = hash;
      delete user.passwordHash;
      const token = generateToken();
      user.token = token;
      ensureUserProfile(user);
      return { result: { user } };
    });

    if (outcome.error) return res.status(outcome.status || 401).json({ error: outcome.error });
    res.cookie('token', outcome.user.token, cookieOptions());
    res.json({ ok: true, user: toUserSafe(outcome.user) });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const user = getUserFromCookie(req);
  if (user) {
    await withUsersLock((users) => {
      const match = users.find((entry) => entry.username === user.username);
      if (match) match.token = null;
    });
  }
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const profile = toUserSafe(ensureUserProfile(user));
  const summary = getStorageSummary(user);
  res.json({ ok: true, user: profile, summary, maxFileSizeMb: MAX_FILE_SIZE_MB, storageQuotaMb: quotaMbForClient(resolveUserQuotaMb(user)), trashRetentionDays: TRASH_RETENTION_DAYS });
});

app.put('/api/auth/profile', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { displayName, email, theme } = req.body;
  try {
    const outcome = await withUsersLock((users) => {
      const current = users.find((entry) => entry.username === user.username);
      if (!current) return { result: { error: 'User not found' } };
      if (displayName) current.displayName = displayName;
      if (email !== undefined) current.email = email;
      if (theme) current.theme = theme;
      return { result: { user: current } };
    });
    if (outcome.error) return res.status(404).json({ error: outcome.error });
    addActivity(outcome.user, 'updated profile', { theme: outcome.user.theme });
    res.json({ ok: true, user: toUserSafe(outcome.user) });
  } catch (err) {
    res.status(500).json({ error: 'Could not update profile. Please try again.' });
  }
});

app.post('/api/auth/password', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { currentPassword, newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ error: 'New password is required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  try {
    const outcome = await withUsersLock(async (users) => {
      const current = users.find((entry) => entry.username === user.username);
      if (!current) return { result: { error: 'User not found', status: 404 } };
      if (currentPassword) {
        const hash = getPasswordHash(current);
        const valid = hash ? await bcrypt.compare(currentPassword, hash) : false;
        if (!valid) return { result: { error: 'Current password is incorrect', status: 401 } };
      }
      current.password = await bcrypt.hash(newPassword, 10);
      delete current.passwordHash;
      return { result: { user: current } };
    });
    if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
    addActivity(outcome.user, 'updated password', {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not update password. Please try again.' });
  }
});

// ---- Password reset (self-hosted: no email sending) -----------------------
// Reset links are printed to the server log only. Tokens are stored hashed,
// single-use, and short-lived.

const RESET_TOKEN_TTL_MS = 20 * 60 * 1000;

/** SHA-256 of a reset token - only this hash is ever written to disk. */
function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** The matching, unused, unexpired reset record for a token hash, or null. */
function findValidResetRecord(records, tokenHash, now = Date.now()) {
  return records.find((r) =>
    r.tokenHash === tokenHash && !r.used && Date.parse(r.expiresAt) > now
  ) || null;
}

/** Random temporary password for admin resets: URL-safe, 12+ chars. */
function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

app.post('/api/auth/forgot', authRateLimit, async (req, res) => {
  const genericReply = { ok: true, message: 'If that account exists, a reset request was created.' };
  try {
    const identifier = normalizeEmail(req.body?.email || req.body?.username);
    if (!identifier) return res.json(genericReply);

    const account = pickLoginRecord(readUsers(), identifier);
    // Disabled accounts can't log in, so they can't reset either.
    if (!account || account.disabled) return res.json(genericReply);

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    await withResetsLock((resets) => {
      // Prune dead records while we're here so the file can't grow forever.
      const alive = resets.filter((r) => !r.used && Date.parse(r.expiresAt) > now);
      alive.push({
        username: account.username,
        tokenHash: hashResetToken(token),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + RESET_TOKEN_TTL_MS).toISOString(),
        used: false
      });
      return { resets: alive, result: { ok: true } };
    });

    // No SMTP on a homelab box: surface the link where only the operator can
    // see it. The plaintext token exists nowhere else.
    const base = APP_URL || `http://localhost:${PORT}`;
    console.log(`[password-reset] Reset link for ${account.username} (valid 20 min): ${base}/?resetToken=${token}`);
    res.json(genericReply);
  } catch (err) {
    console.error('Forgot-password failed:', err.message);
    // Still generic - never leak whether the account exists.
    res.json(genericReply);
  }
});

app.post('/api/auth/reset', authRateLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: 'Reset token and new password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const tokenHash = hashResetToken(token);
    const claimed = await withResetsLock((resets) => {
      const record = findValidResetRecord(resets, tokenHash);
      if (!record) return { result: null };
      record.used = true;
      record.usedAt = new Date().toISOString();
      return { result: { username: record.username } };
    });
    if (!claimed) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

    const outcome = await withUsersLock(async (users) => {
      const user = findUserByUsername(users, claimed.username);
      if (!user) return { result: { error: 'This reset link is invalid or has expired.' } };
      user.password = await bcrypt.hash(String(password), 10);
      delete user.passwordHash;
      user.token = null; // any existing sessions are signed out
      return { result: { user } };
    });
    if (outcome.error) return res.status(400).json({ error: outcome.error });

    addActivity(outcome.user, 'reset password via reset link', {});
    console.log(`[password-reset] Password reset completed for ${outcome.user.username}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Password reset failed:', err.message);
    res.status(500).json({ error: 'Password reset failed. Please try again.' });
  }
});

app.post('/api/auth/request-delete', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  addActivity(user, 'requested account deletion', { note: 'Deletion is not executed in this demo build' });
  res.json({ ok: true, message: 'Account deletion is not enabled in this demo build.' });
});

app.get('/api/files', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const items = getUserItems(user);
  const parentId = req.query.parentId || null;
  const folderItems = items.filter((item) => item.parentId === parentId);
  const breadcrumb = buildBreadcrumb(items, parentId);
  res.json({
    items: folderItems,
    breadcrumb,
    parentId,
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    storageQuotaMb: quotaMbForClient(resolveUserQuotaMb(user))
  });
});

app.get('/api/folders/tree', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const items = getUserItems(user);
  res.json({ tree: buildFolderTree(items) });
});

app.get('/api/search', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const query = String(req.query.q || '').trim().toLowerCase();
  if (!query) return res.json({ items: [] });
  const items = getUserItems(user);
  const matches = items
    .filter((item) => (item.displayName || item.name || '').toLowerCase().includes(query))
    .slice(0, 50)
    .map((item) => {
      const crumbs = buildBreadcrumb(items, item.parentId);
      const location = crumbs.length ? `Home / ${crumbs.map((c) => c.name).join(' / ')}` : 'Home';
      return { ...item, location };
    });
  res.json({ items: matches });
});

app.post('/api/folders', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, parentId } = req.body;
  if (!name) return res.status(400).json({ error: 'Folder name is required' });

  try {
    const outcome = await withStorageLock((allItems) => {
      const items = allItems.filter((item) => item.owner === user.username && !item.trashed);
      if (parentId && !items.some((item) => item.id === parentId && item.type === 'folder')) {
        return { result: { error: 'Destination folder not found' } };
      }
      const existingNames = items.filter((item) => item.parentId === (parentId || null)).map((item) => item.name);
      const folderName = createUniqueName(name, existingNames);
      const folder = {
        id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        owner: user.username,
        type: 'folder',
        name: folderName,
        parentId: parentId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        size: 0,
        favorite: false,
        trashed: false,
        trashedAt: null
      };
      allItems.push(folder);
      return { result: { folder } };
    });
    if (outcome.error) return res.status(400).json({ error: outcome.error });
    addActivity(user, 'created folder', { folder: outcome.folder.name });
    res.json({ ok: true, item: outcome.folder });
  } catch (err) {
    res.status(500).json({ error: 'Could not create folder. Please try again.' });
  }
});

app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const folderId = req.body.folderId || null;
  try {
    const outcome = await withStorageLock((allItems) => {
      const items = allItems.filter((item) => item.owner === user.username && !item.trashed);
      if (folderId && !items.some((item) => item.id === folderId && item.type === 'folder')) {
        return { result: { error: 'Destination folder not found' } };
      }

      const quotaMb = resolveUserQuotaMb(user);
      if (quotaMb !== Infinity) {
        const allOwned = allItems.filter((item) => item.owner === user.username);
        const currentUsage = allOwned.reduce((sum, item) => sum + (item.size || 0), 0);
        const quotaBytes = quotaMb * 1024 * 1024;
        if (currentUsage + req.file.size > quotaBytes) {
          return { result: { error: `This upload would exceed your storage quota of ${formatMb(quotaMb)}.` } };
        }
      }

      const existingNames = items.filter((item) => item.parentId === folderId).map((item) => item.name);
      const safeName = createUniqueName(req.file.originalname, existingNames);
      const userDir = getUserStorageDir(user);
      const storedPath = path.join(userDir, safeName);
      fs.renameSync(req.file.path, storedPath);

      const item = {
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        owner: user.username,
        type: 'file',
        name: safeName,
        displayName: safeName,
        parentId: folderId || null,
        size: req.file.size,
        mimeType: req.file.mimetype || 'application/octet-stream',
        storagePath: path.relative(uploadsRoot, storedPath),
        uploadedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        shared: false,
        shareToken: null,
        favorite: false,
        trashed: false,
        trashedAt: null
      };
      allItems.push(item);
      return { result: { item } };
    });
    if (outcome.error) {
      try { fs.unlinkSync(req.file.path); } catch { /* already moved or missing */ }
      return res.status(400).json({ error: outcome.error });
    }
    addActivity(user, 'uploaded file', { file: outcome.item.name, size: outcome.item.size });
    res.json({ ok: true, item: outcome.item });
  } catch (err) {
    console.error('Upload failed:', err.message);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

app.post('/api/files/:id/rename', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'New name is required' });

  try {
    const outcome = await withStorageLock((allItems) => {
      const items = allItems.filter((entry) => entry.owner === user.username);
      const item = items.find((entry) => entry.id === req.params.id || entry.name === req.params.id);
      if (!item) return { result: { error: 'File not found', status: 404 } };
      const existingNames = items.filter((entry) => entry.parentId === item.parentId && entry.id !== item.id).map((entry) => entry.name);
      const nextName = createUniqueName(name, existingNames);
      item.name = nextName;
      item.displayName = nextName;
      item.updatedAt = new Date().toISOString();
      return { result: { item } };
    });
    if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
    addActivity(user, 'renamed item', { item: outcome.item.name });
    res.json({ ok: true, item: outcome.item });
  } catch (err) {
    res.status(500).json({ error: 'Rename failed. Please try again.' });
  }
});

app.post('/api/files/:id/move', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const destinationId = req.body.parentId || null;

  try {
    const outcome = await withStorageLock((allItems) => {
      const items = allItems.filter((entry) => entry.owner === user.username && !entry.trashed);
      const item = items.find((entry) => entry.id === req.params.id);
      if (!item) return { result: { error: 'File not found', status: 404 } };

      if (destinationId) {
        const destination = items.find((entry) => entry.id === destinationId);
        if (!destination || destination.type !== 'folder') {
          return { result: { error: 'Destination folder not found', status: 404 } };
        }
        if (destinationId === item.id) {
          return { result: { error: 'Cannot move an item into itself', status: 400 } };
        }
        if (item.type === 'folder' && isSameOrDescendant(items, destinationId, item.id)) {
          return { result: { error: 'Cannot move a folder into one of its own subfolders', status: 400 } };
        }
      }
      if ((destinationId || null) === item.parentId) {
        return { result: { item } };
      }

      const existingNames = items.filter((entry) => entry.parentId === destinationId && entry.id !== item.id).map((entry) => entry.name);
      if (existingNames.includes(item.name)) {
        return { result: { error: 'An item with this name already exists in the destination folder', status: 409 } };
      }

      item.parentId = destinationId;
      item.updatedAt = new Date().toISOString();
      return { result: { item } };
    });
    if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
    addActivity(user, 'moved item', { item: outcome.item.name, folder: destinationId || 'root' });
    res.json({ ok: true, item: outcome.item });
  } catch (err) {
    res.status(500).json({ error: 'Move failed. Please try again.' });
  }
});

app.post('/api/files/bulk-delete', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { ids = [] } = req.body;

  const count = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username);
    const now = new Date().toISOString();
    let trashedCount = 0;
    for (const id of ids) {
      const item = items.find((entry) => entry.id === id);
      if (!item || item.trashed) continue;
      const idsToTrash = item.type === 'folder' ? [id, ...getDescendantIds(items, id)] : [id];
      for (const trashId of idsToTrash) {
        const target = items.find((entry) => entry.id === trashId);
        if (target && !target.trashed) {
          target.trashed = true;
          target.trashedAt = now;
          trashedCount += 1;
        }
      }
    }
    return { result: trashedCount };
  });
  addActivity(user, 'moved files to trash', { count });
  res.json({ ok: true, count });
});

app.post('/api/files/:id/share', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const expiresInDays = Number(req.body?.expiresInDays) || null;

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username && !entry.trashed);
    const item = items.find((entry) => entry.id === req.params.id || entry.name === req.params.id);
    if (!item) return { result: { error: 'File not found' } };
    item.shared = true;
    item.shareToken = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    item.shareExpiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null;
    item.updatedAt = new Date().toISOString();
    return { result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  addActivity(user, 'shared file', { file: outcome.item.name });
  res.json({ ok: true, shareLink: `/api/share/${outcome.item.shareToken}` });
});

app.delete('/api/files/:id/share', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username);
    const item = items.find((entry) => entry.id === req.params.id || entry.name === req.params.id);
    if (!item) return { result: { error: 'File not found' } };
    item.shared = false;
    item.shareToken = null;
    item.shareExpiresAt = null;
    item.updatedAt = new Date().toISOString();
    return { result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  addActivity(user, 'disabled share link', { file: outcome.item.name });
  res.json({ ok: true });
});

app.get('/api/shared', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const items = getUserItems(user).filter((item) => item.shared);
  res.json({ items });
});

app.get('/api/share/:token', (req, res) => {
  const items = readStorage();
  const item = items.find((entry) => entry.shareToken === req.params.token && !entry.trashed);
  if (!item) return res.status(404).json({ error: 'Share not found' });
  if (item.shareExpiresAt && new Date(item.shareExpiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: 'This share link has expired' });
  }
  const filePath = resolveUploadPath(item.storagePath);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath, item.name);
});

app.get('/api/activity', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const activities = readActivity().filter((item) => item.username === user.username);
  res.json({ activities });
});

app.post('/api/support/ticket', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const { subject, message } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required' });
  const tickets = readTickets();
  const ticket = { id: `ticket-${Date.now()}`, username: user.username, subject, message, createdAt: new Date().toISOString() };
  tickets.push(ticket);
  writeTickets(tickets);
  addActivity(user, 'submitted support ticket', { subject });
  res.json({ ok: true, ticket });
});

function requireAdmin(req, res) {
  const user = getUserFromCookie(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  // Honor ADMIN_EMAILS directly: /api/auth/me promotes env admins in memory
  // only, so the stored role can lag until their next login. Without this
  // check an env admin sees the Admin nav but every admin API returns 403.
  if ((user.role || 'user') !== 'admin' && !isAdminByEnv(user)) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return user;
}

app.get('/api/admin/summary', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = readUsers();
  const storageItems = readStorage();
  const summary = {
    totalUsers: users.length,
    totalFiles: storageItems.filter((item) => item.type === 'file' && !item.trashed).length,
    totalStorageUsed: storageItems.reduce((sum, item) => sum + (item.size || 0), 0),
    recentActivity: readActivity().slice(0, 5)
  };
  res.json(summary);
});

app.get('/api/admin/invites', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ invites: readInvites(), registrationMode: REGISTRATION_MODE });
});

app.post('/api/admin/invites', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const code = (req.body?.code && String(req.body.code).trim()) || Math.random().toString(36).slice(2, 10).toUpperCase();
  const outcome = await withInvitesLock((invites) => {
    if (invites.some((i) => i.code === code)) return { result: { error: 'That invite code already exists' } };
    invites.push({ code, used: false, usedBy: null, createdAt: new Date().toISOString() });
    return { result: { code } };
  });
  if (outcome.error) return res.status(409).json({ error: outcome.error });
  res.json({ ok: true, code: outcome.code });
});

app.get('/api/admin/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const users = readUsers();
  const storageItems = readStorage();
  const activities = readActivity();
  const rows = users.map((u) => {
    const owned = storageItems.filter((item) => item.owner === u.username && !item.trashed);
    const lastActivity = activities.find((entry) => entry.username === u.username);
    const role = u.role || 'user';
    return {
      username: u.username,
      displayName: u.displayName || u.username,
      email: u.email || '',
      role,
      isAdmin: role === 'admin',
      adminSource: role === 'admin' ? (isAdminByEnv(u) ? 'env' : 'manual') : null,
      disabled: !!u.disabled,
      fileCount: owned.filter((item) => item.type === 'file').length,
      storageUsed: owned.reduce((sum, item) => sum + (item.size || 0), 0),
      quotaMb: quotaMbForClient(resolveUserQuotaMb(u)),
      quotaSource: resolveUserQuotaSource(u),
      lastActivityAt: lastActivity ? lastActivity.createdAt : null
    };
  });
  res.json({ users: rows });
});

/** Finds a user by username, case-insensitively. Returns null if not found.
 * Tolerates malformed records with a missing username field. */
function findUserByUsername(users, username) {
  const target = normalizeEmail(username);
  return users.find((u) => normalizeEmail(u.username) === target) || null;
}

const ALLOWED_QUOTA_PRESETS_MB = [5120, 20480, 51200, 102400];

app.post('/api/admin/users/:username/quota', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const { quotaMb } = req.body || {};

  const outcome = await withUsersLock((users) => {
    const target = findUserByUsername(users, req.params.username);
    if (!target) return { result: { error: 'User not found', status: 404 } };

    // A falsy/omitted value (or the literal string "default") clears the
    // override so the account falls back to its role-based quota.
    if (quotaMb === null || quotaMb === undefined || quotaMb === '' || quotaMb === 'default') {
      delete target.quotaMb;
      return { result: { user: target, cleared: true } };
    }

    const trimmed = String(quotaMb).trim().toLowerCase();
    const isPreset = ALLOWED_QUOTA_PRESETS_MB.includes(Number(quotaMb));
    const isUnlimited = trimmed === 'unlimited' || trimmed === '-1';
    const isCustomPositive = Number.isFinite(Number(quotaMb)) && Number(quotaMb) > 0;
    if (!isPreset && !isUnlimited && !isCustomPositive) {
      return { result: { error: 'Quota must be a positive number of MB, or "unlimited"', status: 400 } };
    }
    target.quotaMb = isUnlimited ? -1 : Number(quotaMb);
    return { result: { user: target } };
  });

  if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
  const resolved = quotaMbForClient(resolveUserQuotaMb(outcome.user));
  addActivity(admin, outcome.cleared ? 'cleared custom quota' : 'set custom quota', { targetUser: outcome.user.username, quotaMb: resolved });
  console.log(`[admin] ${admin.username} ${outcome.cleared ? 'cleared' : 'set'} quota for ${outcome.user.username}${outcome.cleared ? '' : ` -> ${formatMb(resolved === -1 ? Infinity : resolved)}`}`);
  res.json({ ok: true, quotaMb: resolved, quotaSource: resolveUserQuotaSource(outcome.user) });
});

app.post('/api/admin/users/:username/role', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const nextRole = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'user' ? 'user' : null;
  if (!nextRole) return res.status(400).json({ error: 'role must be "admin" or "user"' });

  const outcome = await withUsersLock((users) => {
    const target = findUserByUsername(users, req.params.username);
    if (!target) return { result: { error: 'User not found', status: 404 } };
    if (target.username === admin.username) {
      return { result: { error: 'You cannot change your own role. Ask another admin, or use ADMIN_EMAILS.', status: 400 } };
    }
    if (nextRole === 'user' && (target.role || 'user') === 'admin' && countActiveAdmins(users, target.username) === 0) {
      return { result: { error: 'Cannot demote the last remaining admin.', status: 400 } };
    }
    target.role = nextRole;
    const envLocked = isAdminByEnv(target);
    return { result: { user: target, envLocked: nextRole === 'user' && envLocked } };
  });

  if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
  addActivity(admin, `${nextRole === 'admin' ? 'promoted' : 'demoted'} user`, { targetUser: outcome.user.username, role: nextRole });
  console.log(`[admin] ${admin.username} set role=${nextRole} for ${outcome.user.username}`);
  res.json({
    ok: true,
    role: outcome.user.role,
    note: outcome.envLocked ? 'This account is listed in ADMIN_EMAILS and will automatically become admin again on next login.' : null
  });
});

app.post('/api/admin/users/:username/disable', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const outcome = await withUsersLock((users) => {
    const target = findUserByUsername(users, req.params.username);
    if (!target) return { result: { error: 'User not found', status: 404 } };
    if (target.username === admin.username) {
      return { result: { error: 'You cannot disable your own account.', status: 400 } };
    }
    if ((target.role || 'user') === 'admin' && countActiveAdmins(users, target.username) === 0) {
      return { result: { error: 'Cannot disable the last remaining admin.', status: 400 } };
    }
    target.disabled = true;
    target.token = null;
    return { result: { user: target } };
  });
  if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
  addActivity(admin, 'disabled user', { targetUser: outcome.user.username });
  console.log(`[admin] ${admin.username} disabled ${outcome.user.username}`);
  res.json({ ok: true, disabled: true });
});

app.post('/api/admin/users/:username/enable', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const outcome = await withUsersLock((users) => {
    const target = findUserByUsername(users, req.params.username);
    if (!target) return { result: { error: 'User not found', status: 404 } };
    target.disabled = false;
    return { result: { user: target } };
  });
  if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
  addActivity(admin, 'enabled user', { targetUser: outcome.user.username });
  console.log(`[admin] ${admin.username} enabled ${outcome.user.username}`);
  res.json({ ok: true, disabled: false });
});

app.post('/api/admin/users/:username/reset-password', async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const tempPassword = generateTempPassword();
  const outcome = await withUsersLock(async (users) => {
    const target = findUserByUsername(users, req.params.username);
    if (!target) return { result: { error: 'User not found', status: 404 } };
    if (target.username === admin.username) {
      return { result: { error: 'Use Settings to change your own password.', status: 400 } };
    }
    target.password = await bcrypt.hash(tempPassword, 10);
    delete target.passwordHash;
    target.token = null; // sign out their existing sessions
    return { result: { user: target } };
  });

  if (outcome.error) return res.status(outcome.status || 400).json({ error: outcome.error });
  addActivity(admin, 'reset user password', { targetUser: outcome.user.username });
  // Deliberately NOT logged: the temp password is returned once in this
  // response and exists nowhere else in plaintext.
  console.log(`[admin] ${admin.username} reset password for ${outcome.user.username}`);
  res.json({ ok: true, tempPassword });
});

app.get('/api/files/:id/preview', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const item = getEntryByIdOrName(user, req.params.id);
  if (!item || item.type !== 'file') return res.status(404).json({ error: 'File not found' });
  const isPreviewable = PREVIEWABLE_TYPES.some((type) => item.mimeType?.startsWith(type));
  if (!isPreviewable) return res.status(415).json({ error: 'Preview not supported for this file type' });
  const filePath = resolveUploadPath(item.storagePath);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', item.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/api/files/:id/download', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const item = getEntryByIdOrName(user, req.params.id);
  if (!item) return res.status(404).json({ error: 'File not found' });
  const filePath = resolveUploadPath(item.storagePath);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.download(filePath, item.name);
});

app.delete('/api/files/:id', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username);
    const item = items.find((entry) => entry.id === req.params.id || entry.name === req.params.id);
    if (!item) return { result: { error: 'File not found' } };
    const now = new Date().toISOString();
    const idsToTrash = item.type === 'folder' ? [item.id, ...getDescendantIds(items, item.id)] : [item.id];
    for (const trashId of idsToTrash) {
      const target = items.find((entry) => entry.id === trashId);
      if (target) {
        target.trashed = true;
        target.trashedAt = now;
      }
    }
    return { result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  addActivity(user, 'moved item to trash', { item: outcome.item.name });
  res.json({ ok: true });
});

app.get('/api/trash', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const purgeMs = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const items = getUserItems(user, { includeTrashed: true })
    .filter((item) => item.trashed)
    .map((item) => ({ ...item, purgeAt: item.trashedAt ? new Date(new Date(item.trashedAt).getTime() + purgeMs).toISOString() : null }));
  res.json({ items, retentionDays: TRASH_RETENTION_DAYS });
});

app.post('/api/files/:id/restore', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item || !item.trashed) return { result: { error: 'Item not found in trash' } };
    const idsToRestore = item.type === 'folder' ? [item.id, ...getDescendantIds(items, item.id)] : [item.id];
    for (const restoreId of idsToRestore) {
      const target = items.find((entry) => entry.id === restoreId);
      if (target) {
        target.trashed = false;
        target.trashedAt = null;
      }
    }
    return { result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  addActivity(user, 'restored item from trash', { item: outcome.item.name });
  res.json({ ok: true, item: outcome.item });
});

app.delete('/api/files/:id/permanent', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item || !item.trashed) return { result: { error: 'Item not found in trash' } };
    const idsToDelete = item.type === 'folder' ? [item.id, ...getDescendantIds(items, item.id)] : [item.id];
    for (const deleteId of idsToDelete) {
      const target = allItems.find((entry) => entry.id === deleteId);
      if (target) deleteEntryFiles(target);
    }
    const idsSet = new Set(idsToDelete);
    const remaining = allItems.filter((entry) => !idsSet.has(entry.id));
    return { items: remaining, result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  addActivity(user, 'permanently deleted item', { item: outcome.item.name });
  res.json({ ok: true });
});

app.post('/api/trash/empty', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const count = await withStorageLock((allItems) => {
    const trashed = allItems.filter((item) => item.owner === user.username && item.trashed);
    for (const item of trashed) deleteEntryFiles(item);
    const trashedIds = new Set(trashed.map((item) => item.id));
    const remaining = allItems.filter((item) => !trashedIds.has(item.id));
    return { items: remaining, result: trashed.length };
  });
  addActivity(user, 'emptied trash', { count });
  res.json({ ok: true, count });
});

app.post('/api/files/:id/favorite', async (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const outcome = await withStorageLock((allItems) => {
    const items = allItems.filter((entry) => entry.owner === user.username && !entry.trashed);
    const item = items.find((entry) => entry.id === req.params.id);
    if (!item) return { result: { error: 'File not found' } };
    item.favorite = !item.favorite;
    item.updatedAt = new Date().toISOString();
    return { result: { item } };
  });
  if (outcome.error) return res.status(404).json({ error: outcome.error });
  res.json({ ok: true, item: outcome.item });
});

app.get('/api/favorites', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const items = getUserItems(user).filter((item) => item.favorite);
  res.json({ items });
});

app.get('/api/files/recent', (req, res) => {
  const user = getUserFromCookie(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const items = getUserItems(user)
    .filter((item) => item.type === 'file')
    .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0))
    .slice(0, 30);
  res.json({ items });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds the ${MAX_FILE_SIZE_MB} MB limit` : err.message;
    return res.status(400).json({ error: message });
  }
  if (err) {
    console.error(err);
    const safeMessage = IS_PRODUCTION ? 'Request failed' : (err.message || 'Request failed');
    return res.status(400).json({ error: safeMessage });
  }
  res.status(500).json({ error: 'Something went wrong' });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTrashPurgeSweep();
  setInterval(runTrashPurgeSweep, 6 * 60 * 60 * 1000).unref();
  app.listen(PORT, () => {
    console.log(`Frostyy Cloud is listening on http://localhost:${PORT}`);
  });
}

export {
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
  generateTempPassword
};
