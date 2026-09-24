// Checks every <img> in a built site: a width and height must be declared, and they must match the
// shape of the file, or the browser reserves the wrong space and the page moves when the image loads.
import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './dimensions.js';
import { posixRelative, walk } from './files.js';
import { findImages } from './html.js';

/** Leading digits of a width or height attribute, as browsers read them. Percentages do not count. */
export function dimension(value) {
  if (value === undefined || /%/.test(value)) return null;
  const m = /^\s*(\d+)/.exec(value);
  return m ? Number(m[1]) : null;
}

function readDataUri(src) {
  const m = /^data:image\/[\w.+-]+(;[^,]*)?,(.*)$/is.exec(src);
  if (!m) return null;
  const base64 = /;base64/i.test(m[1] ?? '');
  return base64 ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]), 'utf8');
}

/** Resolves an image src to its size: local files, data URIs, and your own domain with siteUrl. */
export function sizeForSrc(src, { htmlFile, roots, siteUrl, cache }) {
  if (!src) return { size: null, reason: 'no src' };
  if (/^data:/i.test(src)) {
    const buf = readDataUri(src);
    return { size: buf && imageSize(buf), reason: 'data URI' };
  }
  let ref = src.split('#')[0].split('?')[0];
  if (siteUrl && ref.startsWith(siteUrl)) ref = ref.slice(siteUrl.length) || '/';
  if (/^(https?:)?\/\//i.test(ref)) return { size: null, reason: 'remote file' };
  let decoded;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    decoded = ref;
  }
  const candidates = decoded.startsWith('/')
    ? roots.map((root) => path.join(root, decoded))
    : [path.join(path.dirname(htmlFile), decoded)];
  for (const file of candidates) {
    if (!cache.has(file)) cache.set(file, fs.existsSync(file) && fs.statSync(file).isFile() ? imageSize(fs.readFileSync(file)) : undefined);
    const size = cache.get(file);
    if (size !== undefined) return { size, reason: size ? 'local file' : 'unreadable image' };
  }
  return { size: null, reason: 'file not found' };
}

/**
 * Audits every .html file under `dir`.
 * Returns { pages, images, issues, unmeasured } where each issue is
 * { kind: 'missing' | 'ratio', file, line, src, declared, actual, reason }.
 */
export function audit(dir, { roots = [dir], siteUrl = null, tolerance = 0.02, ignore = [] } = {}) {
  const cleanSiteUrl = siteUrl ? siteUrl.replace(/\/+$/, '') : null;
  const cache = new Map();
  const htmlFiles = walk(dir).filter((f) => /\.html?$/i.test(f)).sort();
  const issues = [];
  const unmeasured = [];
  let images = 0;
  let ignored = 0;
  for (const htmlFile of htmlFiles) {
    for (const { line, attrs } of findImages(fs.readFileSync(htmlFile, 'utf8'))) {
      const src = attrs.src || attrs['data-src'] || '';
      if (ignore.some((text) => text && src.includes(text))) {
        ignored += 1;
        continue;
      }
      images += 1;
      const { size, reason } = sizeForSrc(src, { htmlFile, roots, siteUrl: cleanSiteUrl, cache });
      const where = { file: posixRelative(dir, htmlFile), line, src: src.startsWith('data:') ? `${src.slice(0, 30)}...` : src };
      const width = dimension(attrs.width);
      const height = dimension(attrs.height);
      const styledRatio = /aspect-ratio\s*:/i.test(attrs.style || '');
      if (!size) unmeasured.push({ ...where, reason });
      if ((width === null || height === null) && !styledRatio) {
        issues.push({ kind: 'missing', ...where, declared: { width, height }, actual: size, reason });
      } else if (width && height && size) {
        const declared = width / height;
        const actual = size.width / size.height;
        if (Math.abs(declared - actual) / actual > tolerance) {
          issues.push({ kind: 'ratio', ...where, declared: { width, height }, actual: size, reason });
        }
      }
    }
  }
  return { pages: htmlFiles.length, images, ignored, issues, unmeasured };
}
