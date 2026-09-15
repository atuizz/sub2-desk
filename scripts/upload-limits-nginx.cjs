/* Isolated real nginx transport test. No production backend or global process cleanup. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'output/release-validation/deploy', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const report = { started: new Date().toISOString(), scope: 'real nginx; echo upstream only; no business acceptance', checks: [], docker: null };
const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
const posix = p => p.replaceAll('\\', '/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function run(exe, args, options = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, ...options });
  if (r.error || r.status !== 0) throw Error(`${exe}: ${r.error || r.stderr || r.stdout}`);
  return r.stdout + r.stderr;
}
async function download(url) {
  const r = await fetch(url);
  assert.equal(r.status, 200);
  assert.equal(new URL(r.url).hostname, 'nginx.org');
  return Buffer.from(await r.arrayBuffer());
}
async function freePort() {
  const s = net.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function request(port, route, { secure = false, size, chunked = false, ca, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (size !== undefined) { headers['Content-Type'] = 'application/json'; if (!chunked) headers['Content-Length'] = size; }
    const req = (secure ? https : http).request({ hostname: 'localhost', family: 4, port, path: route, method: size === undefined ? 'GET' : 'POST', headers, ca, timeout: 120000 }, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), tls: secure ? res.socket?.getProtocol?.() : undefined }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('request timeout')));
    (async () => {
      if (body) req.end(body);
      else if (size !== undefined) {
        const block = Buffer.alloc(1024 * 1024, 32); // valid JSON whitespace after a scalar
        if (size) req.write('0');
        for (let left = size - 1; left > 0 && !req.destroyed; left -= block.length) {
          if (!req.write(block.subarray(0, Math.min(left, block.length)))) await new Promise(resolve => {
            const done = () => { req.off('drain', done); req.off('close', done); resolve(); };
            req.once('drain', done); req.once('close', done);
          });
        }
        req.end();
      } else req.end();
    })().catch(reject);
  });
}
async function check(name, fn) { const start = Date.now(); const detail = await fn(); report.checks.push({ name, passed: true, elapsedMs: Date.now() - start, ...detail }); console.log('PASS', name); }
let upstream, nginx, executable, prefix, nginxChild;
(async () => {
  const docker = spawnSync('docker', ['version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  report.docker = { available: !docker.error && docker.status === 0, detail: docker.error?.code || docker.stderr || docker.stdout, imageBuildTested: false };
  const url = 'https://nginx.org/download/nginx-1.28.0.zip';
  const archive = await download(url); write('nginx-1.28.0.zip', archive);
  const downloadPage = (await download('https://nginx.org/en/download.html')).toString(); write('official-download.html', downloadPage);
  // Verify detached signature against keys published over HTTPS by nginx.org.
  const signature = await download(url + '.asc'); write('nginx-1.28.0.zip.asc', signature);
  report.source = { url, finalOriginVerified: 'https://nginx.org', sha256: sha(archive), signatureSaved: true, pgpVerified: false };
  const keysPage = (await download('https://nginx.org/en/pgp_keys.html')).toString(); write('official-pgp-keys.html', keysPage);
  const keyPaths = [...keysPage.matchAll(/href="(\/keys\/[a-z_]+\.key)"/g)].map(m => m[1]);
  assert.ok(keyPaths.length > 0);
  const gpgHome = path.join(dir, 'gnupg'); fs.mkdirSync(gpgHome);
  const gpg = process.env.UPLOAD_TEST_GPG || 'C:/Program Files/Git/usr/bin/gpg.exe';
  const gpgPath = p => process.env.UPLOAD_TEST_GPG ? p : posix(p).replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase());
  for (const keyPath of keyPaths) {
    const key = await download('https://nginx.org' + keyPath); const local = path.join(dir, path.basename(keyPath)); fs.writeFileSync(local, key);
    run(gpg, ['--homedir', gpgPath(gpgHome), '--batch', '--no-autostart', '--import', gpgPath(local)]);
  }
  const verification = run(gpg, ['--homedir', gpgPath(gpgHome), '--batch', '--no-autostart', '--status-fd', '1', '--verify', gpgPath(path.join(dir, 'nginx-1.28.0.zip.asc')), gpgPath(path.join(dir, 'nginx-1.28.0.zip'))]);
  assert.match(verification, /VALIDSIG D6786CE303D9A9022998DC6CC8464D549AF75C0A /);
  write('nginx-signature-verification.txt', verification);
  report.source.pgpVerified = true; report.source.signerFingerprint = 'D6786CE303D9A9022998DC6CC8464D549AF75C0A'; report.source.keySource = 'https://nginx.org/en/pgp_keys.html';
  run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(dir, 'nginx-1.28.0.zip').replaceAll("'", "''")}' -DestinationPath '${dir.replaceAll("'", "''")}'`]);
  executable = path.join(dir, 'nginx-1.28.0/nginx.exe'); prefix = posix(path.join(dir, 'nginx-1.28.0')) + '/';
  report.nginxVersion = run(executable, ['-V']);
  const openssl = process.env.UPLOAD_TEST_OPENSSL || 'C:/Program Files/Git/usr/bin/openssl.exe';
  run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'tls.key'), '-out', path.join(dir, 'tls.crt'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  const ca = fs.readFileSync(path.join(dir, 'tls.crt'));
  let upstreamCount = 0;
  upstream = http.createServer((req, res) => {
    upstreamCount++; let bytes = 0;
    req.on('data', b => bytes += b.length);
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ path: req.url, bytes, headers: req.headers })); });
  });
  upstream.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', b => { if (b[0] === 0x88) return socket.end(Buffer.from([0x88, 0])); const n = b[1] & 127, mask = b.subarray(2, 6), payload = b.subarray(6, 6 + n); const decoded = Buffer.from(payload.map((v, i) => v ^ mask[i % 4])); socket.write(Buffer.concat([Buffer.from([0x81, decoded.length]), decoded])); });
    socket.on('error', () => {});
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const upstreamPort = upstream.address().port, port = await freePort(), tlsPort = await freePort();
  report.ports = { upstreamPort, port, tlsPort };
  const html = path.join(dir, 'html'); fs.mkdirSync(path.join(html, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(html, 'index.html'), '<!doctype html><title>nginx SPA transport fixture</title><div id="app">isolated SPA marker</div>');
  fs.writeFileSync(path.join(html, 'assets/probe.js'), '/* isolated asset */');
  const template = fs.readFileSync(path.join(root, 'deploy/nginx.conf.template'), 'utf8');
  report.templateSha256 = sha(template);
  const rendered = template.replace('${SUB2API_UPSTREAM}', `http://127.0.0.1:${upstreamPort}`).replace('listen 80;', `listen 127.0.0.1:${port};\n    listen 127.0.0.1:${tlsPort} ssl;\n    ssl_certificate "${posix(path.join(dir, 'tls.crt'))}";\n    ssl_certificate_key "${posix(path.join(dir, 'tls.key'))}";\n    ssl_protocols TLSv1.2 TLSv1.3;`).replace('/usr/share/nginx/html', posix(html));
  const config = `worker_processes 1;\nerror_log logs/error.log info;\npid logs/nginx.pid;\nevents { worker_connections 128; }\nhttp { include mime.types; access_log logs/access.log;\n${rendered}\n}`;
  fs.writeFileSync(path.join(prefix, 'conf/nginx.conf'), config); write('rendered-nginx.conf', config);
  write('nginx-config-test.txt', run(executable, ['-p', prefix, '-t']));
  nginxChild = spawn(executable, ['-p', prefix], { windowsHide: true, stdio: 'ignore' }); nginxChild.on('error', () => {}); nginx = true;
  for (let i = 0; i < 100; i++) { try { await request(port, '/'); break; } catch (e) { if (i === 99) throw e; await new Promise(r => setTimeout(r, 100)); } }
  await check('TLS trusted local certificate and SPA deep links', async () => {
    for (const route of ['/', '/admin/accounts', '/batch-image', '/setup', '/unknown/deep?x=1']) { const r = await request(tlsPort, route, { secure: true, ca }); assert.equal(r.status, 200); assert.match(r.body, /isolated SPA marker/); }
    return { certificateValidation: true, routes: 5 };
  });
  await check('asset cache and missing asset 404', async () => { const r = await request(port, '/assets/probe.js'); assert.equal(r.status, 200); assert.match(r.headers['cache-control'], /max-age=3600/); assert.equal((await request(port, '/assets/missing.js')).status, 404); });
  await check('API gateway setup health paths and proxy headers', async () => {
    const routes = ['/api/v1/probe?x=1', '/v1/probe', '/health', '/setup/status', '/setup/test-db', '/setup/test-redis', '/setup/install'];
    for (const route of routes) { const r = await request(tlsPort, route, { secure: true, ca }); assert.equal(r.status, 200); const echo = JSON.parse(r.body); assert.equal(echo.path, route); assert.equal(echo.headers['x-forwarded-proto'], 'https'); assert.equal(echo.headers['x-real-ip'], '127.0.0.1'); assert.equal(echo.headers['x-forwarded-for'], '127.0.0.1'); assert.equal(echo.headers.host, `127.0.0.1:${upstreamPort}`); assert.equal(echo.headers.connection, 'close'); }
    return { routes };
  });
  await check('WebSocket 101 and bidirectional frame echo', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`);
    await new Promise((resolve, reject) => { const timer = setTimeout(() => { ws.close(); reject(Error('WS timeout')); }, 10000); ws.onopen = () => ws.send('nginx-real-echo'); ws.onerror = reject; ws.onmessage = e => { try { assert.equal(e.data, 'nginx-real-echo'); clearTimeout(timer); ws.close(); resolve(); } catch (e) { reject(e); } }; });
  });
  for (const size of [20 * 1048576 + 100, 50 * 1048576, Math.ceil(128 * 1048576 / 3) * 4 + 4096, 268435455, 268435456]) {
    await check(`Content-Length accept ${size}`, async () => { const r = await request(port, '/api/upload', { size }); assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).bytes, size); return { sentBytes: size, upstreamBytes: size }; });
  }
  await check('Content-Length reject 268435457 before upstream', async () => {
    const before = upstreamCount;
    // Send headers only: nginx must reject over-limit Content-Length before reading the body.
    const r = await request(port, '/api/upload', { size: 268435457, body: Buffer.alloc(0) });
    assert.equal(r.status, 413); assert.equal(upstreamCount, before); return { status: r.status, upstreamReached: false };
  });
  for (const size of [268435456, 268435457]) await check(`chunked boundary ${size}`, async () => { const before = upstreamCount; const r = await request(port, '/api/upload', { size, chunked: true }); assert.equal(r.status, size === 268435456 ? 200 : 413); if (r.status === 200) assert.equal(JSON.parse(r.body).bytes, size); else assert.equal(upstreamCount, before); return { status: r.status }; });
  await check('TLS upload forwards actual bytes', async () => { const r = await request(tlsPort, '/v1/probe', { secure: true, ca, size: 1048576 }); assert.equal(JSON.parse(r.body).bytes, 1048576); });
  await check('isolated nginx reload preserves SPA and API', async () => { run(executable, ['-p', prefix, '-s', 'reload']); assert.equal((await request(port, '/admin/accounts')).status, 200); assert.equal((await request(port, '/health')).status, 200); });
  await check('isolated nginx stop and restart restores TLS SPA and API', async () => {
    run(executable, ['-p', prefix, '-s', 'quit']);
    for (let i = 0; i < 100 && fs.existsSync(path.join(prefix, 'logs/nginx.pid')); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(fs.existsSync(path.join(prefix, 'logs/nginx.pid')), false);
    await assert.rejects(request(port, '/health'));
    nginxChild = spawn(executable, ['-p', prefix], { windowsHide: true, stdio: 'ignore' }); nginxChild.on('error', () => {});
    for (let i = 0; i < 100; i++) { try { await request(port, '/health'); break; } catch (e) { if (i === 99) throw e; await new Promise(r => setTimeout(r, 100)); } }
    assert.equal((await request(tlsPort, '/admin/accounts', { secure: true, ca })).status, 200);
    assert.equal(JSON.parse((await request(port, '/health')).body).path, '/health');
  });
  await check('upstream unavailable yields real 502, never SPA success', async () => {
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    const r = await request(port, '/api/probe'); assert.equal(r.status, 502); assert.doesNotMatch(r.body, /isolated SPA marker/);
    return { status: 502 };
  });
  report.passed = true;
})().catch(e => { report.passed = false; report.error = e.stack; console.error(e); process.exitCode = 1; }).finally(async () => {
  if (nginx) {
    try { run(executable, ['-p', prefix, '-s', 'quit']); } catch (e) { report.cleanupError = String(e); }
    for (let i = 0; i < 100; i++) { if (!fs.existsSync(path.join(prefix, 'logs/nginx.pid'))) break; await new Promise(r => setTimeout(r, 100)); }
    report.nginxPidRemoved = !fs.existsSync(path.join(prefix, 'logs/nginx.pid'));
    report.listenersClosed = true;
    for (const port of [report.ports.port, report.ports.tlsPort]) {
      try { await request(port, '/'); report.listenersClosed = false; } catch {}
    }
    if (!report.nginxPidRemoved || !report.listenersClosed) { report.passed = false; process.exitCode = 1; }
    for (const log of ['access.log', 'error.log']) if (fs.existsSync(path.join(prefix, 'logs', log))) write(log, fs.readFileSync(path.join(prefix, 'logs', log)));
  }
  upstream?.closeAllConnections(); upstream?.close();
  report.finished = new Date().toISOString(); write('report.json', JSON.stringify(report, null, 2)); console.log('Evidence:', dir);
});
