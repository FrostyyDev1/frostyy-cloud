// Read-only report on data/storage.json vs the uploads/ directory:
// orphaned metadata, orphaned files, duplicates, malformed records.
// Never modifies or deletes anything.
//
//   node scripts/audit-storage.mjs
//   node scripts/audit-storage.mjs /path/to/project-root
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.argv[2] || path.join(__dirname, '..');
const storageFile = path.join(projectRoot, 'data', 'storage.json');
const uploadsRoot = path.join(projectRoot, 'uploads');

if (!fs.existsSync(storageFile)) {
  console.error(`No storage file found at ${storageFile}`);
  process.exit(1);
}

let items;
try {
  items = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
} catch (err) {
  console.error(`storage.json is not valid JSON: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(items)) {
  console.error('storage.json is not an array.');
  process.exit(1);
}

const label = (item, i) => `#${i} id=${JSON.stringify(item.id ?? null)} name=${JSON.stringify(item.name ?? null)} owner=${JSON.stringify(item.owner ?? null)}`;
const section = (title, rows) => {
  console.log(`\n${title}: ${rows.length ? '' : 'none'}`);
  rows.forEach((r) => console.log(`  - ${r}`));
};

const files = items.filter((i) => i.type === 'file');
const folders = items.filter((i) => i.type === 'folder');
const trashed = items.filter((i) => i.trashed);
console.log(`Auditing ${storageFile}`);
console.log(`${items.length} record(s): ${files.length} file(s), ${folders.length} folder(s), ${trashed.length} in trash`);

section(
  'Malformed records (missing id, name, or a valid type)',
  items.map((item, i) => (!item || !item.id || !item.name || !['file', 'folder'].includes(item.type) ? label(item || {}, i) : null)).filter(Boolean)
);

section(
  'Records missing an owner',
  items.map((item, i) => (item.owner ? null : label(item, i))).filter(Boolean)
);

const idCounts = new Map();
items.forEach((item) => {
  if (item.id) idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
});
section(
  'Duplicate file/folder ids',
  [...idCounts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} appears ${n} times`)
);

// File records whose binary is gone from uploads/
section(
  'File records pointing at a missing uploaded file',
  files
    .map((item, i) => {
      if (!item.storagePath) return `${label(item, i)} (no storagePath at all)`;
      const abs = path.resolve(uploadsRoot, item.storagePath);
      if (!abs.startsWith(path.resolve(uploadsRoot))) return `${label(item, i)} (storagePath escapes uploads/)`;
      return fs.existsSync(abs) ? null : `${label(item, i)} -> ${item.storagePath}`;
    })
    .filter(Boolean)
);

// Files on disk with no metadata record (skipping the multer _tmp scratch dir)
function walkFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '_tmp' && dir === base ? [] : walkFiles(full, base);
    }
    return [path.relative(base, full)];
  });
}
const knownPaths = new Set(files.map((item) => item.storagePath && path.normalize(item.storagePath)).filter(Boolean));
section(
  'Uploaded files on disk with no metadata record',
  walkFiles(uploadsRoot).filter((rel) => !knownPaths.has(path.normalize(rel)))
);

section(
  'Records currently in trash',
  trashed.map((item) => `${item.type} ${JSON.stringify(item.name)} (owner ${JSON.stringify(item.owner ?? null)}, trashed ${item.trashedAt || 'unknown date'})`)
);

console.log('\nThis audit is read-only. Back up data/ and uploads/ before cleaning anything up by hand.');
