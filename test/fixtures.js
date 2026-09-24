// Smallest valid headers for each format the tool reads. Enough bytes to measure, nothing more.

export function png(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'latin1');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

export function gif(width, height) {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'latin1');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

/** A JPEG with an optional EXIF orientation tag, big-endian like most cameras. */
export function jpeg(width, height, orientation = 0) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation) {
    const tiff = Buffer.alloc(26);
    tiff.write('MM', 0, 'latin1');
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(orientation, 18);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const head = Buffer.from([0xff, 0xe1, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    parts.push(head, payload);
  }
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  parts.push(sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function riff(chunk, body) {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write(chunk, 12, 'latin1');
  buf.writeUInt32LE(10, 16);
  body(buf);
  return buf;
}

export const webpExtended = (width, height) =>
  riff('VP8X', (buf) => {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  });

export const webpLossless = (width, height) =>
  riff('VP8L', (buf) => {
    buf[20] = 0x2f;
    buf.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 21);
  });

export const webpLossy = (width, height) =>
  riff('VP8 ', (buf) => {
    buf[23] = 0x9d;
    buf[24] = 0x01;
    buf[25] = 0x2a;
    buf.writeUInt16LE(width, 26);
    buf.writeUInt16LE(height, 28);
  });

/** An AVIF with one image spatial extent box, and a rotation box when quarterTurns is given. */
export function avif(width, height, quarterTurns = 0) {
  const ftyp = Buffer.alloc(20);
  ftyp.writeUInt32BE(20, 0);
  ftyp.write('ftypavif', 4, 'latin1');
  ftyp.write('avif', 16, 'latin1');
  const ispe = Buffer.alloc(20);
  ispe.writeUInt32BE(20, 0);
  ispe.write('ispe', 4, 'latin1');
  ispe.writeUInt32BE(width, 12);
  ispe.writeUInt32BE(height, 16);
  const parts = [ftyp, ispe];
  if (quarterTurns) {
    const irot = Buffer.alloc(9);
    irot.writeUInt32BE(9, 0);
    irot.write('irot', 4, 'latin1');
    irot[8] = quarterTurns;
    parts.push(irot);
  }
  return Buffer.concat(parts);
}
