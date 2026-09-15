#!/usr/bin/env node
// Read-only, dependency-free wallpaper inventory. Never resizes/replaces artwork.
// node scripts/wallpaper-audit.cjs [--history] [--json] [--strict-4k]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const NAMES = ['tahoe', 'tahoe-night', 'sequoia', 'sonoma', 'monterey', 'ventura', 'galaxy', 'monaco-f1'];

function dimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < buffer.length) {
      if (buffer[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
      while (buffer[offset] === 0xff) offset++;
      const marker = buffer[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) throw new Error('Invalid JPEG segment');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { format: 'jpeg', width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw new Error('Unsupported image header (JPEG/PNG required)');
}

function inspect(file) {
  const data = fs.readFileSync(file);
  const size = dimensions(data);
  if (!size.width || !size.height) throw new Error('Invalid dimensions');
  return {
    path: path.relative(ROOT, file).replaceAll('\\', '/'), ...size,
    bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'),
    // CSS cover must fill both axes, including devicePixelRatio. Target here is physical UHD.
    coverScale4k: +Math.max(3840 / size.width, 2160 / size.height).toFixed(4),
    native4k: size.width >= 3840 && size.height >= 2160,
    extensionMismatch: !({jpeg: ['.jpg', '.jpeg'], png: ['.png']}[size.format].includes(path.extname(file).toLowerCase()))
  };
}

function inventory(history = false) {
  const files = new Set();
  for (const dir of ['assets', 'packages/sub2-console/public/assets', 'packages/sub2-console/public-release/assets', 'packages/sub2-console/dist/assets']) {
    for (const name of NAMES) {
      const file = path.join(ROOT, dir, name + '.jpg');
      if (fs.existsSync(file)) files.add(file);
    }
  }
  if (history) {
    // No broad content scans: enumerate wallpaper basenames only, ignoring vendor trees.
    const output = execFileSync('rg', ['--files', '-g', '!node_modules', '-g', '!.pnpm-store', '-g', '!server',
      ...NAMES.flatMap(name => ['-g', `${name}.jpg`])], {cwd: ROOT, encoding: 'utf8'});
    for (const file of output.split(/\r?\n/).filter(Boolean)) files.add(path.resolve(ROOT, file));
  }
  return [...files].sort().map(inspect);
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const rows = inventory(args.includes('--history'));
    if (args.includes('--json')) console.log(JSON.stringify({target: '3840x2160 physical pixels', rows}, null, 2));
    else console.table(rows.map(({path, width, height, format, bytes, coverScale4k, native4k, extensionMismatch}) =>
      ({path, width, height, format, bytes, coverScale4k, native4k, extensionMismatch})));
    if (args.includes('--strict-4k') && rows.some(row => row.path.includes('/public/') && !row.native4k)) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = {dimensions, inspect, inventory};
