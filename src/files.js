import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git']);

/** Every file under `dir`, recursively, skipping node_modules and .git. */
export function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

/** Path with forward slashes, relative to `from`. */
export const posixRelative = (from, to) => path.relative(from, to).split(path.sep).join('/');
