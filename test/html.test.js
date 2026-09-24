import assert from 'node:assert/strict';
import test from 'node:test';
import { findImages, parseAttributes } from '../src/html.js';

test('reads quoted, unquoted and bare attributes', () => {
  assert.deepEqual(parseAttributes(` SRC='/a.png' width=10 alt="Tom &amp; Jerry" hidden`), {
    src: '/a.png',
    width: '10',
    alt: 'Tom & Jerry',
    hidden: '',
  });
});

test('finds images with their line numbers, and skips comments and scripts', () => {
  const html = [
    '<!doctype html>',
    '<!-- <img src="/commented.png"> -->',
    '<img src="/a.png" alt="x > y" width="10" height="20">',
    '<script>const t = \'<img src="/in-script.png">\';</script>',
    '<p>',
    '  <IMG',
    '    SRC="/b.png"',
    '  >',
    '</p>',
  ].join('\n');
  const images = findImages(html);
  assert.deepEqual(
    images.map((i) => [i.line, i.attrs.src]),
    [
      [3, '/a.png'],
      [6, '/b.png'],
    ],
  );
  assert.equal(images[0].attrs.alt, 'x > y');
});
