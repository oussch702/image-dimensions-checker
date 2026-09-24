import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { audit, dimension } from '../src/audit.js';
import { gif, jpeg, png, webpExtended } from './fixtures.js';

/** A small built site: two pages and a handful of images, each line testing one case. */
function site() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-audit-'));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.mkdirSync(path.join(dir, 'blog'));
  fs.writeFileSync(path.join(dir, 'img/wide.png'), png(1200, 800));
  fs.writeFileSync(path.join(dir, 'img/tall.webp'), webpExtended(1080, 1920));
  fs.writeFileSync(path.join(dir, 'img/small.gif'), gif(400, 300));
  fs.writeFileSync(path.join(dir, 'img/photo.jpg'), jpeg(4000, 3000, 6));
  fs.writeFileSync(path.join(dir, 'img/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>');
  const pixel = `data:image/gif;base64,${gif(1, 1).toString('base64')}`;
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    [
      '<img src="/img/wide.png" width="1200" height="800" alt="">',
      '<img src="/img/tall.webp" width="1200" height="800" alt="">',
      '<img src="img/small.gif?v=3" alt="">',
      '<img src="https://cdn.example.com/x.png" alt="">',
      '<img src="https://example.com/img/wide.png" alt="">',
      '<img src="/img/photo.jpg" width="3000" height="4000" alt="">',
      `<img src="${pixel}" width="1" height="1" alt="">`,
      '<img src="/img/icon.svg" style="width: 2rem; aspect-ratio: 1" alt="">',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'blog/index.html'), '<main>\n  <img src="../img/wide.png" alt="">\n</main>');
  return dir;
}

test('reads width and height the way browsers do', () => {
  assert.equal(dimension('800'), 800);
  assert.equal(dimension(' 800px'), 800);
  assert.equal(dimension('100%'), null);
  assert.equal(dimension(undefined), null);
  assert.equal(dimension('auto'), null);
});

test('finds missing sizes and wrong shapes, and nothing else', () => {
  const dir = site();
  const result = audit(dir, { siteUrl: 'https://example.com/' });
  assert.equal(result.pages, 2);
  assert.equal(result.images, 9);
  const found = result.issues.map((i) => [i.kind, `${i.file}:${i.line}`, i.actual && [i.actual.width, i.actual.height]]);
  assert.deepEqual(found, [
    ['missing', 'blog/index.html:2', [1200, 800]],
    ['ratio', 'index.html:2', [1080, 1920]],
    ['missing', 'index.html:3', [400, 300]],
    ['missing', 'index.html:4', null],
    ['missing', 'index.html:5', [1200, 800]],
  ]);
  assert.equal(result.issues.find((i) => i.line === 4 && i.file === 'index.html').reason, 'remote file');
});

test('without --site-url, your own absolute URLs count as remote', () => {
  const result = audit(site());
  const own = result.issues.find((i) => i.file === 'index.html' && i.line === 5);
  assert.equal(own.actual, null);
  assert.equal(own.reason, 'remote file');
});

test('a looser tolerance accepts small rounding differences', () => {
  const dir = site();
  fs.writeFileSync(path.join(dir, 'index.html'), '<img src="/img/wide.png" width="1200" height="801" alt="">');
  const shapeIssues = (options) => audit(dir, options).issues.filter((i) => i.kind === 'ratio').length;
  assert.equal(shapeIssues(), 0);
  assert.equal(shapeIssues({ tolerance: 0 }), 1);
});
