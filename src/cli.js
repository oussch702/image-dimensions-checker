import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { audit } from './audit.js';
import { measure, render } from './measure.js';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export const HELP = `image-dimensions-checker ${VERSION}
Find the images that make your pages jump, and get the real sizes to fix them.

Usage
  image-dimensions-checker audit <built-site-folder> [options]
  image-dimensions-checker measure <image-folder> [--out file] [--format json|js|ts] [--prefix /]

audit options
  --root <dir>        Where paths like /img/a.png live. Defaults to the audited folder. Repeatable.
  --site-url <url>    Read absolute URLs on your own domain from disk, e.g. https://example.com
  --tolerance <n>     Allowed difference between declared and real shape (default: 0.02, i.e. 2%)
  --ignore <text>     Skip images whose src contains this text. Repeatable.
  --json              Machine-readable output
  --verbose           Also list the images that could not be measured
  --warn              Report problems but exit with code 0

measure options
  --out <file>        Write to a file instead of the terminal
  --format <kind>     json, js or ts (default: from the --out extension, else json)
  --prefix <path>     Path prefix for the keys (default: /)

  -h, --help          Show this help
  -v, --version       Show the version
`;

const OPTIONS = {
  root: { type: 'string', multiple: true },
  'site-url': { type: 'string' },
  tolerance: { type: 'string', default: '0.02' },
  ignore: { type: 'string', multiple: true },
  json: { type: 'boolean', default: false },
  verbose: { type: 'boolean', default: false },
  warn: { type: 'boolean', default: false },
  out: { type: 'string' },
  format: { type: 'string' },
  prefix: { type: 'string', default: '/' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

const attrs = (width, height) => `width="${Math.round(width)}" height="${Math.round(height)}"`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The same image with the same problem, usually a shared header or footer, reported once. */
export function groupIssues(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = [issue.kind, issue.src, issue.declared.width, issue.declared.height, issue.actual?.width, issue.actual?.height].join('|');
    if (!groups.has(key)) groups.set(key, { ...issue, locations: [] });
    groups.get(key).locations.push(`${issue.file}:${issue.line}`);
  }
  return [...groups.values()];
}

/** The fix to paste. A wrong shape keeps its declared width, since that is usually the display size. */
function fix(issue) {
  if (issue.kind === 'missing') return issue.actual ? `add ${attrs(issue.actual.width, issue.actual.height)}` : `size unknown (${issue.reason})`;
  const { declared, actual } = issue;
  const height = (declared.width * actual.height) / actual.width;
  return `declared ${declared.width}x${declared.height}, the file is ${Math.round(actual.width)}x${Math.round(actual.height)}: use ${attrs(declared.width, height)}`;
}

function where(locations, verbose) {
  const perLine = new Map();
  for (const l of locations) perLine.set(l, (perLine.get(l) || 0) + 1);
  const unique = [...perLine].map(([l, n]) => (n > 1 ? `${l} (${n} times)` : l));
  const pages = new Set(locations.map((l) => l.slice(0, l.lastIndexOf(':')))).size;
  const shown = verbose ? unique : unique.slice(0, 3);
  const more = unique.length - shown.length;
  const count = locations.length > 1 ? `${plural(locations.length, 'image', 'images')} on ${plural(pages, 'page', 'pages')}: ` : '';
  return `    ${count}${shown.join(', ')}${more ? `, and ${more} more` : ''}`;
}

/** The plain-text report for an audit result. */
export function formatAudit(dir, result, { verbose = false } = {}) {
  const ignored = result.ignored ? ` · ${result.ignored} ignored` : '';
  const lines = [`image-dimensions-checker · ${dir} · ${plural(result.pages, 'page', 'pages')} · ${plural(result.images, 'image', 'images')}${ignored}`];
  const sections = [
    ['missing', 'Missing width or height'],
    ['ratio', 'Declared size does not match the file'],
  ];
  for (const [kind, title] of sections) {
    const issues = result.issues.filter((i) => i.kind === kind);
    if (!issues.length) continue;
    lines.push('', `${title}: ${plural(issues.length, 'image', 'images')}`);
    for (const group of groupIssues(issues)) {
      lines.push(`  ${group.src || '(no src)'}  ${fix(group)}`, where(group.locations, verbose));
    }
  }
  if (verbose && result.unmeasured.length) {
    lines.push('', `Could not measure: ${plural(result.unmeasured.length, 'image', 'images')}`);
    for (const u of result.unmeasured) lines.push(`  ${u.file}:${u.line}  ${u.src || '(no src)'}  ${u.reason}`);
  }
  const n = result.issues.length;
  lines.push('', n ? `${plural(n, 'image needs', 'images need')} a fix.` : 'Every image has a width and height that match the file.');
  return lines.join('\n');
}

export async function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    stderr.write(`${err.message}\n\n${HELP}`);
    return 2;
  }
  const o = parsed.values;
  const [command, dir] = parsed.positionals;
  if (o.help || (!command && !o.version)) {
    stdout.write(HELP);
    return 0;
  }
  if (o.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (!['audit', 'measure'].includes(command)) {
    stderr.write(`Unknown command "${command}". Use audit or measure.\n`);
    return 2;
  }
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    stderr.write(`${command} needs a folder that exists${dir ? `, and ${dir} is not one` : ''}.\n`);
    return 2;
  }

  if (command === 'audit') {
    const tolerance = Number(o.tolerance);
    if (!(tolerance >= 0 && tolerance < 1)) {
      stderr.write('--tolerance must be a number from 0 to 1, for example 0.02.\n');
      return 2;
    }
    const result = audit(dir, { roots: o.root?.length ? o.root : [dir], siteUrl: o['site-url'] ?? null, tolerance, ignore: o.ignore ?? [] });
    stdout.write(o.json ? `${JSON.stringify(result, null, 2)}\n` : `${formatAudit(dir, result, { verbose: o.verbose })}\n`);
    return result.issues.length && !o.warn ? 1 : 0;
  }

  const format = o.format || (o.out && /\.ts$/i.test(o.out) ? 'ts' : o.out && /\.m?js$/i.test(o.out) ? 'js' : 'json');
  if (!['json', 'js', 'ts'].includes(format)) {
    stderr.write('--format must be json, js or ts.\n');
    return 2;
  }
  const { sizes, unreadable } = measure(dir, { prefix: o.prefix });
  const text = render(sizes, format);
  if (o.out) {
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, text);
    stderr.write(`${Object.keys(sizes).length} images measured, written to ${o.out}\n`);
  } else {
    stdout.write(text);
  }
  if (unreadable.length) stderr.write(`Could not read ${unreadable.length}: ${unreadable.slice(0, 5).join(', ')}\n`);
  return 0;
}
