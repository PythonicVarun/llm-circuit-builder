// Zero-dependency ZIP builder (STORE method - no compression).
// Good enough for tiny text projects (a few KB of source + diagram.json).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodeUtf8(s) { return new TextEncoder().encode(s); }

function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Build a ZIP file from a flat map of { "path/name.ext": "text contents" }.
 * Returns a Blob (application/zip).
 */
export function buildZip(files) {
  const { time, date } = dosDateTime();
  const parts = [];           // raw byte chunks for the final blob
  const central = [];         // central directory entries
  let offset = 0;             // running offset of the next local file header

  for (const [path, content] of Object.entries(files)) {
    const nameBytes = encodeUtf8(path);
    const dataBytes = typeof content === 'string'
      ? encodeUtf8(content)
      : (content instanceof Uint8Array ? content : encodeUtf8(String(content)));
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 + name + data)
    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0,  0x04034b50, true);  // sig
    lfh.setUint16(4,  20, true);          // version needed
    lfh.setUint16(6,  0x0800, true);      // flags (UTF-8 filename)
    lfh.setUint16(8,  0, true);           // method = store
    lfh.setUint16(10, time, true);
    lfh.setUint16(12, date, true);
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, size, true);
    lfh.setUint32(22, size, true);
    lfh.setUint16(26, nameBytes.length, true);
    lfh.setUint16(28, 0, true);           // extra len
    parts.push(new Uint8Array(lfh.buffer), nameBytes, dataBytes);

    // Central directory entry
    const cdh = new DataView(new ArrayBuffer(46));
    cdh.setUint32(0,  0x02014b50, true);
    cdh.setUint16(4,  20, true);          // version made by
    cdh.setUint16(6,  20, true);          // version needed
    cdh.setUint16(8,  0x0800, true);      // flags
    cdh.setUint16(10, 0, true);           // method
    cdh.setUint16(12, time, true);
    cdh.setUint16(14, date, true);
    cdh.setUint32(16, crc, true);
    cdh.setUint32(20, size, true);
    cdh.setUint32(24, size, true);
    cdh.setUint16(28, nameBytes.length, true);
    cdh.setUint16(30, 0, true);
    cdh.setUint16(32, 0, true);
    cdh.setUint16(34, 0, true);
    cdh.setUint16(36, 0, true);
    cdh.setUint32(38, 0, true);           // external attrs
    cdh.setUint32(42, offset, true);
    central.push(new Uint8Array(cdh.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const cdStart = offset;
  const cdBytes = central.reduce((n, p) => n + p.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0,  0x06054b50, true);
  eocd.setUint16(4,  0, true);
  eocd.setUint16(6,  0, true);
  eocd.setUint16(8,  Object.keys(files).length, true);
  eocd.setUint16(10, Object.keys(files).length, true);
  eocd.setUint32(12, cdBytes, true);
  eocd.setUint32(16, cdStart, true);
  eocd.setUint16(20, 0, true);

  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Group flat paths into a nested tree for UI display.
 * Returns: { folders: { name: <tree> }, files: { name: path } }
 */
export function buildTree(paths) {
  const root = { folders: {}, files: {} };
  for (const path of paths) {
    const parts = path.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      node.folders[p] ??= { folders: {}, files: {} };
      node = node.folders[p];
    }
    node.files[parts[parts.length - 1]] = path;
  }
  return root;
}
