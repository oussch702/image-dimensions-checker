import assert from 'node:assert/strict';
import test from 'node:test';
import { imageSize } from '../src/dimensions.js';
import { avif, gif, jpeg, png, webpExtended, webpLossless, webpLossy } from './fixtures.js';

const size = (buf) => {
  const s = imageSize(buf);
  return s && [s.width, s.height, s.type];
};

test('PNG', () => assert.deepEqual(size(png(1200, 800)), [1200, 800, 'png']));
test('GIF', () => assert.deepEqual(size(gif(320, 240)), [320, 240, 'gif']));
test('JPEG', () => assert.deepEqual(size(jpeg(4000, 3000)), [4000, 3000, 'jpeg']));

test('JPEG turned a quarter by EXIF reports the size the browser shows', () => {
  assert.deepEqual(size(jpeg(4000, 3000, 6)), [3000, 4000, 'jpeg']);
  assert.deepEqual(size(jpeg(4000, 3000, 3)), [4000, 3000, 'jpeg']);
});

test('WebP, all three encodings', () => {
  assert.deepEqual(size(webpExtended(1080, 1920)), [1080, 1920, 'webp']);
  assert.deepEqual(size(webpLossless(640, 480)), [640, 480, 'webp']);
  assert.deepEqual(size(webpLossy(800, 600)), [800, 600, 'webp']);
});

test('AVIF, with and without rotation', () => {
  assert.deepEqual(size(avif(1600, 900)), [1600, 900, 'avif']);
  assert.deepEqual(size(avif(1600, 900, 1)), [900, 1600, 'avif']);
});

test('SVG from width and height, or from the viewBox', () => {
  const svg = (attrs) => Buffer.from(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`);
  assert.deepEqual(size(svg('width="120" height="60px"')), [120, 60, 'svg']);
  assert.deepEqual(size(svg('viewBox="0 0 24 12"')), [24, 12, 'svg']);
  assert.deepEqual(size(svg('width="48" viewBox="0 0 24 12"')), [48, 24, 'svg']);
  assert.deepEqual(size(svg('width="100%" height="100%" viewBox="0 0 16 9"')), [16, 9, 'svg']);
  assert.equal(imageSize(svg('width="100%"')), null);
});

test('anything else is unknown, not a guess', () => {
  assert.equal(imageSize(Buffer.from('definitely not an image')), null);
  assert.equal(imageSize(Buffer.alloc(0)), null);
});
