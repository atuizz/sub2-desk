const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Build inputs only: never include local .env values or runtime configuration.
const inputs = [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'Dockerfile', 'deploy',
  'packages/mac-ui-core/src', 'packages/mac-ui-core/package.json', 'packages/mac-ui-core/tsconfig.json',
  'packages/sub2-console/src', 'packages/sub2-console/package.json', 'packages/sub2-console/tsconfig.json',
  'packages/sub2-console/index.html', 'packages/sub2-console/vite.config.ts',
  'packages/sub2-console/tailwind.config.js', 'packages/sub2-console/postcss.config.js',
  'scripts/release-snapshot.cjs',
];
function snapshot(root, assetProfile) {
  if (!['existing-macos-assets', 'original-release-assets'].includes(assetProfile)) throw new Error('Unknown asset profile');
  const files = [];
  function visit(relative) {
    if (/^\.env(?:\.|$)/.test(path.basename(relative)) && path.basename(relative) !== '.env.example') return;
    const file = path.join(root, relative);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Build input must not be a symlink: ' + relative);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(relative + '/' + name);
    else files.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
  for (const item of [...inputs, 'packages/sub2-console/' + (assetProfile === 'existing-macos-assets' ? 'public' : 'public-release')]) visit(item);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function compare(expected, actual) {
  if (!Array.isArray(expected) || !expected.length) return { matched: false, differences: ['missing source snapshot'] };
  const indexed = new Map(), differences = [];
  for (const entry of expected) {
    const key = typeof entry?.path === 'string' ? entry.path.replaceAll('\\', '/') : '';
    if (!key || indexed.has(key) || !/^[a-f0-9]{64}$/.test(entry.sha256)) return { matched: false, differences: ['invalid source snapshot'] };
    indexed.set(key, entry.sha256);
  }
  for (const entry of actual) {
    if (indexed.get(entry.path) !== entry.sha256) differences.push(entry.path);
    indexed.delete(entry.path);
  }
  differences.push(...indexed.keys());
  return { matched: differences.length === 0, differences };
}
function assessVerification(verification, actual) {
  const result = compare(verification?.sourceFiles, actual);
  return { ...result, coreBackendAccepted: result.matched && verification?.coreBackendAccepted === true };
}
function buildSnapshotPlugin(root, assetProfile) {
  let sourceFiles;
  return {
    name: 'sub2-build-snapshot', apply: 'build',
    buildStart() { sourceFiles = snapshot(root, assetProfile); },
    generateBundle() {
      if (!compare(sourceFiles, snapshot(root, assetProfile)).matched) this.error('Source changed during build; build again after edits finish');
      this.emitFile({ type: 'asset', fileName: 'build-snapshot.json', source: JSON.stringify({ schema: 1, assetProfile, sourceFiles }, null, 2) + '\n' });
    },
  };
}
module.exports = { snapshot, compare, assessVerification, buildSnapshotPlugin };
