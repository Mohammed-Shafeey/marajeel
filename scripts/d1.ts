import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** SQL literal for a string/number/null/boolean. */
export function lit(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** Runs SQL against the D1 database via wrangler (`--local` or `--remote`). */
export function execSql(sql: string, target: '--local' | '--remote') {
  const dir = mkdtempSync(join(tmpdir(), 'marajeel-'));
  const file = join(dir, 'run.sql');
  writeFileSync(file, sql, 'utf8');
  try {
    const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
    const r = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'DB', target, '--yes', `--file=${file}`], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      process.stderr.write(r.stdout ?? '');
      throw new Error(`wrangler d1 execute failed (exit ${r.status})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const targetFromArgs = (args: string[]): '--local' | '--remote' => (args.includes('--remote') ? '--remote' : '--local');
