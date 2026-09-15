const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { snapshot, compare, assessVerification } = require('./release-snapshot.cjs');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const desktop = process.argv.includes('--desktop');
const assetProfile = desktop ? 'existing-macos-assets' : 'original-release-assets';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const release = path.join(root, 'output', 'releases', `${version}-${stamp}`);
const source = path.join(release, 'source'), staticDir = path.join(release, 'static');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const verificationPath = path.join(root, 'docs/frontend/release-verification.json');
const verification = fs.existsSync(verificationPath) ? JSON.parse(fs.readFileSync(verificationPath, 'utf8')) : null;
const docs = ['README.md', 'LICENSE', 'COPYING', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt', 'CHANGELOG.md', 'CONTRIBUTING.md'];
const selected = [
  ...docs, 'AGENTS.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.gitignore', '.dockerignore', '.github', 'Dockerfile', 'deploy',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'packages/mac-ui-core/src', 'packages/mac-ui-core/tests', 'packages/mac-ui-core/package.json', 'packages/mac-ui-core/tsconfig.json',
  'packages/sub2-console/src', 'packages/sub2-console/public-release', 'packages/sub2-console/package.json',
  'packages/sub2-console/tsconfig.json', 'packages/sub2-console/vite.config.ts', 'packages/sub2-console/tailwind.config.js',
  'packages/sub2-console/postcss.config.js', 'packages/sub2-console/index.html', 'packages/sub2-console/.env.example',
  'docs/frontend/DESIGN.md', 'docs/frontend/EXECUTION_PLAN.md', 'docs/frontend/DELIVERY_REVIEW_2026-09-11.md',
  'docs/frontend/verification.json',
  'scripts/package-release.cjs', 'scripts/release-snapshot.cjs', 'scripts/generate-release-art.cjs', 'scripts/settings-form.test.cjs',
  'scripts/version-browser-check.js', 'scripts/settings-closeout-check.js', 'scripts/delivery-browser-check.js',
  'scripts/all-apps-browser-check.js', 'scripts/keychain-browser-check.js', 'scripts/activity-browser-check.js',
  'scripts/production-browser-check.js',
  'scripts/frontend-browser-check.js', 'scripts/frontend-polish-interactions.js',
  'scripts/start-desktop.ps1', 'scripts/p0-integration-browser-check.js', 'scripts/build-semantic-icons.cjs',
];
if (desktop) selected.push('packages/sub2-console/public');
selected.push('docs/RELEASE_ACCOUNTS.md', 'scripts/upload-limits-nginx.cjs');
selected.push('scripts/payment-write-fixture.cjs');
selected.push('scripts/prepublish-nginx.cjs');
selected.push('scripts/start-all.ps1', 'scripts/runtime-operations.ps1', 'scripts/upgrade-transaction.ps1', 'scripts/runtime-operations.test.ps1', 'docs/LOCAL_OPERATIONS.md');
if (verification) selected.push('docs/frontend/release-verification.json');
for (const name of fs.readdirSync(path.join(root, 'docs/frontend'))) {
  if (/^RELEASE_[A-Z_0-9]+\.md$/.test(name)) selected.push('docs/frontend/' + name);
}
selected.push('scripts/build-shop-icon.cjs', 'scripts/account-editor-browser-check.js', 'docs/frontend/SHOP_ICON_FINAL.md', 'docs/frontend/CURRENT_UPSTREAM_20260912.md', 'docs/frontend/UPSTREAM_GAP_FIXES_20260913.md');
selected.push('docs/frontend/ACCOUNT_EXPERIENCE_FINAL_20260913.md');
selected.push('docs/frontend/RELEASE_FIXES_20260913.md', 'scripts/r07-main-browser.js', 'scripts/r07-readers-ops-browser.js', 'scripts/r07-commerce-browser.cjs', 'scripts/r07-settings-browser.cjs');
selected.push('docs/frontend/RELEASE_R08_20260913.md', 'scripts/r08-shop-browser.js', 'scripts/r08-payment-browser.cjs', 'scripts/r08-drafts-browser.cjs');
selected.push('scripts/test-parity.cjs', 'scripts/collect-licenses.cjs', 'scripts/setup-browser-check.js', 'scripts/batch-image-browser-check.js', 'scripts/advanced-settings-browser-check.js', 'scripts/parity-payment-browser.js', 'scripts/desktop-experience-browser-check.js');
if (fs.existsSync(path.join(root, 'scripts/test-support'))) selected.push('scripts/test-support');
selected.push('docs/BRAND.md');
for (const name of fs.readdirSync(path.join(root, 'scripts'))) {
  if (/^[\w-]+\.test\.cjs$/.test(name)) selected.push('scripts/' + name);
}
for (const name of fs.readdirSync(path.join(root, 'docs/frontend'))) {
  if (/^(PARITY_[A-Z_]+|REVIEW_[A-Z_]+_20260912|DESKTOP_[A-Z_0-9]+)\.md$/.test(name)) selected.push('docs/frontend/' + name);
}
for (const optional of ['docs/frontend/UPSTREAM_PARITY.md', 'docs/frontend/M01-RESULT.md', 'docs/frontend/M02-RESULT.md', 'docs/frontend/M03-RESULT.md', 'docs/frontend/M04-RESULT.md', 'docs/frontend/M05-RESULT.md', 'scripts/m04-version.test.cjs', 'scripts/m03-auth.test.cjs']) {
  if (fs.existsSync(path.join(root, optional))) selected.push(optional);
}
function copy(from, to) {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) throw new Error('Release input must not be a symlink: ' + from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, {recursive:true});
    for (const item of fs.readdirSync(from)) copy(path.join(from,item),path.join(to,item));
  } else { fs.mkdirSync(path.dirname(to), {recursive:true}); fs.copyFileSync(from,to); }
}
function inventory(dir, base=dir) {
  return fs.readdirSync(dir).sort().flatMap(name => {
    const file=path.join(dir,name);
    return fs.statSync(file).isDirectory()?inventory(file,base):[{path:path.relative(base,file).split(path.sep).join('/'),bytes:fs.statSync(file).size,sha256:sha(file)}];
  });
}
if (!fs.existsSync(path.join(root,'packages/sub2-console/dist/index.html'))) throw new Error('Run pnpm build first');
const buildSnapshotPath = path.join(root, 'packages/sub2-console/dist/build-snapshot.json');
if (!fs.existsSync(buildSnapshotPath)) throw new Error('Build snapshot missing; rebuild current sources before packaging');
const buildSnapshot = JSON.parse(fs.readFileSync(buildSnapshotPath, 'utf8'));
if (buildSnapshot.assetProfile !== assetProfile) throw new Error('Build asset profile differs from requested package');
const currentSnapshot = snapshot(root, assetProfile);
const buildMatch = compare(buildSnapshot.sourceFiles, currentSnapshot);
if (!buildMatch.matched) throw new Error('Built files are stale; rebuild before packaging: ' + buildMatch.differences.join(', '));
const evidenceMatch = assessVerification(verification, currentSnapshot);
const builtIcon = path.join(root, 'packages/sub2-console/dist/assets/app-icons/finder.png');
const releaseIcon = path.join(root, 'packages/sub2-console/public-release/assets/app-icons/finder.png');
if (!desktop && (!fs.existsSync(builtIcon) || sha(builtIcon) !== sha(releaseIcon))) throw new Error('Run pnpm build:release before packaging redistributable assets');
fs.mkdirSync(source,{recursive:true}); fs.mkdirSync(staticDir,{recursive:true});
for(const item of selected) copy(path.join(root,item),path.join(source,item));
if (!compare(buildSnapshot.sourceFiles, snapshot(source, assetProfile)).matched) throw new Error('Packaged source does not match build snapshot');
// Preserve the reviewed task record instead of replacing it with an obsolete summary.
copy(path.join(root,'packages/sub2-console/dist'),path.join(staticDir,'html'));
for(const item of ['LICENSE','COPYING','NOTICE.md','THIRD_PARTY_NOTICES.md','THIRD_PARTY_LICENSES.txt']) copy(path.join(root,item),path.join(staticDir,item));
copy(path.join(root,'deploy'),path.join(staticDir,'deploy'));
fs.writeFileSync(path.join(staticDir,'README.md'), '# Sub2 Desk static frontend\n\nServe only html/ as the web root. Proxy /api/, /v1/ and /health to your compatible Sub2API backend. Never serve the source workspace. The matching source archive is supplied next to this archive; see the release manifest for its SHA-256. No backend or live configuration is included.\n');
for(const [name,folder] of [['source',source],['static',staticDir]]) {
  const files=inventory(folder);
  if(files.some(f => /(^|\/)(node_modules|server|data|output|archive-prototype)(\/|$)|(^|\/)\.env$|\.env\.(?!example$)|\.(exe|db|dump|pem|key|log|bak|backup)$/i.test(f.path))) throw new Error('Unexpected private/runtime input in release');
  fs.writeFileSync(path.join(folder,'FILES.json'),JSON.stringify(files,null,2)+'\n');
  execFileSync('tar',['-czf',path.join(release,`sub2-desk-${version}-${desktop ? 'desktop-' : ''}${name}.tar.gz`),'-C',folder,'.'],{stdio:'inherit'});
}
const archives=inventory(release).filter(f=>!f.path.includes('/')&&f.path.endsWith('.tar.gz'));
const manifest={version,createdAt:new Date().toISOString(),kind:desktop?'desktop-preview':'frontend',assetProfile,realBackendAccepted:false,coreBackendAccepted:evidenceMatch.coreBackendAccepted,sourceMatchesBuild:true,verificationSourceMatch:evidenceMatch,verification:evidenceMatch.matched?verification:null,historicalVerification:evidenceMatch.matched?null:verification,archives};
fs.writeFileSync(path.join(release,'release.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(release,'SHA256SUMS'),archives.map(f=>`${f.sha256}  ${f.path}`).join('\n')+'\n');
fs.writeFileSync(path.join(root,'output/releases/latest.json'),JSON.stringify({directory:path.relative(root,release),...manifest},null,2)+'\n');
console.log(JSON.stringify({directory:release,...manifest},null,2));
