// Intrinsic width and height of an image, read from the file header. No image libraries.
// Formats are detected from their bytes, not from the file extension.

/** EXIF orientation of a JPEG APP1 segment starting at `start` (after marker and length), or 1. */
function exifOrientation(buf, start, end) {
  if (buf.toString('latin1', start, start + 6) !== 'Exif\0\0') return 1;
  const tiff = start + 6;
  if (tiff + 8 > end) return 1;
  const little = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (i) => (little ? buf.readUInt16LE(i) : buf.readUInt16BE(i));
  const u32 = (i) => (little ? buf.readUInt32LE(i) : buf.readUInt32BE(i));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const count = u16(ifd);
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return 1;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(buf) {
  let orientation = 1;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (marker === 0xe1) orientation = exifOrientation(buf, i + 4, Math.min(buf.length, i + 2 + length));
    if (SOF.has(marker)) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      // Orientations 5 to 8 rotate the picture a quarter turn, and browsers apply them by default.
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
    }
    i += 2 + length;
  }
  return null;
}

function webp(buf) {
  const chunk = buf.toString('latin1', 12, 16);
  if (chunk === 'VP8X' && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function avif(buf) {
  let best = null;
  for (let j = buf.indexOf('ispe'); j !== -1 && j + 16 <= buf.length; j = buf.indexOf('ispe', j + 4)) {
    const size = { width: buf.readUInt32BE(j + 8), height: buf.readUInt32BE(j + 12) };
    if (!best || size.width * size.height > best.width * best.height) best = size;
  }
  if (!best) return null;
  const irot = buf.indexOf('irot');
  const quarterTurns = irot !== -1 && irot + 5 <= buf.length ? buf[irot + 4] & 0x03 : 0;
  return quarterTurns % 2 === 1 ? { width: best.height, height: best.width } : best;
}

const px = (value) => {
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(value ?? '');
  return m ? Number(m[1]) : null;
};

function svg(text) {
  const tag = /<svg\b([^>]*)>/i.exec(text);
  if (!tag) return null;
  const attr = (name) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag[1]);
    return m ? (m[1] ?? m[2]) : null;
  };
  const width = px(attr('width'));
  const height = px(attr('height'));
  const box = (attr('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box[2] > 0 && box[3] > 0;
  if (width && height) return { width, height };
  if (hasBox && width) return { width, height: (width * box[3]) / box[2] };
  if (hasBox && height) return { width: (height * box[2]) / box[3], height };
  if (hasBox) return { width: box[2], height: box[3] };
  return null;
}

/** { width, height, type } for a PNG, JPEG, GIF, WebP, AVIF or SVG buffer, or null. */
export function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  let size = null;
  let type = null;
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.length >= 24 && buf.toString('latin1', 12, 16) === 'IHDR') {
    type = 'png';
    size = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } else if (buf[0] === 0xff && buf[1] === 0xd8) {
    type = 'jpeg';
    size = jpeg(buf);
  } else if (/^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) {
    type = 'gif';
    size = { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  } else if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    type = 'webp';
    size = webp(buf);
  } else if (buf.toString('latin1', 4, 8) === 'ftyp' && /avi[fs]/.test(buf.toString('latin1', 8, 40))) {
    type = 'avif';
    size = avif(buf);
  } else {
    const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
    if (/<svg\b/i.test(head)) {
      type = 'svg';
      size = svg(buf.toString('utf8'));
    }
  }
  return size && size.width > 0 && size.height > 0 ? { ...size, type } : null;
}
