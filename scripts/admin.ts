// Usage: node scripts/admin.ts "Name" [--local|--remote] [--url https://your-site]
// Creates an admin and writes their personal sign-in link to admin-links.local.txt (git-ignored).
// The link is the only copy of the code: the database stores just its SHA-256 hash.
// Use this for the first admin; after that, admins add each other in Settings.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSql, lit, targetFromArgs } from './d1.ts';

const args = process.argv.slice(2);
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--url')?.trim();
if (!name) {
  console.error('Usage: node scripts/admin.ts "Name" [--local|--remote] [--url https://your-site]');
  process.exit(1);
}
const target = targetFromArgs(args);
const urlIdx = args.indexOf('--url');
const base = (urlIdx >= 0 ? args[urlIdx + 1] : target === '--local' ? 'http://localhost:5173' : '').replace(/\/$/, '');

const code = randomBytes(24).toString('base64url');
const hash = createHash('sha256').update(code).digest('hex');
execSql(
  `INSERT INTO admins (id, name, code_hash, created_at) VALUES (${lit(randomUUID())}, ${lit(name.slice(0, 60))}, ${lit(hash)}, ${lit(new Date().toISOString())});`,
  target,
);

const file = resolve('admin-links.local.txt');
const link = `${base || '<your-site>'}/signin#${code}`;
appendFileSync(file, `${new Date().toISOString()}  ${target.slice(2)}  ${name}\n${link}\n\n`, 'utf8');
console.log(`Admin "${name}" created (${target.slice(2)}). Their sign-in link was saved to ${file}`);
console.log('Open it on the admin’s phone once; treat it like a password.');
