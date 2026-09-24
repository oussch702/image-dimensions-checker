// Finds <img> tags in HTML with their attributes and line numbers. Comments, scripts, styles and
// templates are skipped, and the line numbers still match the original file.

const blank = (s) => s.replace(/[^\n]/g, ' ');

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };
const decode = (s) => s.replace(/&(amp|quot|#39|apos|lt|gt);/g, (m) => ENTITIES[m]);

/** Attributes of a tag body as a plain object with lower-case names. A bare attribute gets an empty string. */
export function parseAttributes(body) {
  const attrs = {};
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of body.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Every <img> in the document: { line, attrs }. */
export function findImages(html) {
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, blank);
  const newlines = [];
  for (let i = visible.indexOf('\n'); i !== -1; i = visible.indexOf('\n', i + 1)) newlines.push(i);
  const lineAt = (index) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  const images = [];
  for (const m of visible.matchAll(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    images.push({ line: lineAt(m.index), attrs: parseAttributes(m[1]) });
  }
  return images;
}
