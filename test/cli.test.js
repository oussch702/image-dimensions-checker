import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HELP, run } from '../src/cli.js';
import { png, webpExtended } from './fixtures.js';

const sink = () => {
  const out = { text: '', write: (s) => { out.text += s; return true; } };
  return out;
};

function site(html) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-cli-'));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.writeFileSync(path.join(dir, 'img/a.png'), png(1600, 900));
  fs.writeFileSync(path.join(dir, 'img/b.webp'), webpExtended(1080, 1920));
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return dir;
}

test('prints help with no command', async () => {
  const stdout = sink();
  assert.equal(await run([], { stdout }), 0);
  assert.equal(stdout.text, HELP);
});

test('audit fails the build on a problem and prints the fix', async () => {
  const dir = site('<img src="/img/a.png" alt="">\n<img src="/img/b.webp" width="1200" height="800" alt="">');
  const stdout = sink();
  assert.equal(await run(['audit', dir], { stdout }), 1);
  assert.match(stdout.text, / {2}\/img\/a\.png {2}add width="1600" height="900"\n {4}index\.html:1\n/);
  // A wrong shape keeps the declared width and gets the height that matches the file.
  assert.match(stdout.text, /declared 1200x800, the file is 1080x1920: use width="1200" height="2133"/);
  assert.match(stdout.text, /2 images need a fix\./);
});

test('the same image repeated on every page is reported once', async () => {
  const dir = site('<img src="/img/a.png" width="32" height="32" alt="">');
  for (const page of ['about', 'contact', 'pricing']) {
    fs.mkdirSync(path.join(dir, page));
    fs.writeFileSync(path.join(dir, page, 'index.html'), '<header><img src="/img/a.png" width="32" height="32" alt=""></header>');
  }
  const stdout = sink();
  await run(['audit', dir], { stdout });
  assert.equal(stdout.text.match(/declared 32x32/g).length, 1);
  assert.match(stdout.text, /use width="32" height="18"/);
  assert.match(stdout.text, /4 images on 4 pages: about\/index\.html:1, contact\/index\.html:1, index\.html:1, and 1 more/);
});

test('audit passes a clean site, and --warn never fails', async () => {
  const clean = site('<img src="/img/a.png" width="1600" height="900" alt="">');
  const stdout = sink();
  assert.equal(await run(['audit', clean], { stdout }), 0);
  assert.match(stdout.text, /Every image has a width and height that match the file\./);
  const broken = site('<img src="/img/a.png" alt="">');
  assert.equal(await run(['audit', broken, '--warn'], { stdout: sink() }), 0);
});

test('audit --json is machine-readable', async () => {
  const stdout = sink();
  await run(['audit', site('<img src="/img/a.png" alt="">'), '--json'], { stdout });
  const result = JSON.parse(stdout.text);
  assert.equal(result.issues[0].kind, 'missing');
});

test('measure writes JSON or a typed module', async () => {
  const dir = site('');
  const stdout = sink();
  assert.equal(await run(['measure', dir], { stdout }), 0);
  assert.deepEqual(JSON.parse(stdout.text), { '/img/a.png': [1600, 900], '/img/b.webp': [1080, 1920] });
  const out = path.join(dir, 'generated', 'sizes.ts');
  assert.equal(await run(['measure', path.join(dir, 'img'), '--out', out, '--prefix', '/img'], { stdout: sink(), stderr: sink() }), 0);
  const ts = fs.readFileSync(out, 'utf8');
  assert.match(ts, /export const IMAGE_SIZES: Record<string, \[number, number\]> = \{/);
  assert.match(ts, /"\/img\/a\.png": \[1600, 900\],/);
});

test('--ignore skips images you have checked by hand', async () => {
  const dir = site('<img src="/img/a.png" width="32" height="32" alt="">\n<img src="/img/b.webp" alt="">');
  const stdout = sink();
  assert.equal(await run(['audit', dir, '--ignore', '/img/a.png', '--ignore', 'b.webp'], { stdout }), 0);
  assert.match(stdout.text, /0 images · 2 ignored/);
});

test('rejects an unknown command or a missing folder', async () => {
  assert.equal(await run(['resize', '.'], { stderr: sink() }), 2);
  assert.equal(await run(['audit', '/no/such/folder'], { stderr: sink() }), 2);
});
