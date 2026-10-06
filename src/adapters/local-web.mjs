import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { KitError, requireValue } from '../domain/common.mjs';
import { KitService } from '../application/service.mjs';
import { webState } from '../application/view.mjs';
import { sandboxIdentity } from './sandbox.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const CAPABILITIES = { environment: 'loopback_sandbox', switchActors: true,
  storage: 'local_file_sandbox', pdf: 'demo_pdf', line: false,
  photos: false, signatures: false, production: false };

function demoPdf(record, label) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.KIT_PYTHON ?? 'python3', [resolve(root, 'pdf/render.py')],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    const buffers = []; let size = 0; let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolvePromise(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new KitError('PDF_DEPENDENCY_UNAVAILABLE')); }, 10000);
    child.on('error', () => finish(new KitError('PDF_DEPENDENCY_UNAVAILABLE')));
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 5000000) { child.kill(); finish(new KitError('PDF_TOO_LARGE')); }
      else buffers.push(data);
    });
    child.on('close', code => {
      const bytes = Buffer.concat(buffers);
      if (code !== 0 || bytes.subarray(0, 5).toString() !== '%PDF-') finish(new KitError('PDF_DEPENDENCY_UNAVAILABLE'));
      else finish(null, bytes);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ record, label }));
  });
}

/** 假身分介面只允許 loopback；不得代理、放上公開主機或接正式設定。 */
export function createLocalWeb({ config, repository, clock, buildDirectory = resolve(root, '.local/build/web') }) {
  requireValue(config.mode === 'sandbox', 'PRODUCTION_NOT_IMPLEMENTED');
  const service = new KitService({ config, repository, identity: sandboxIdentity(), clock });
  const sessions = new Map(); let origin;
  const reply = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      requireValue(request.socket.remoteAddress === '127.0.0.1' &&
        request.headers.host === new URL(origin).host, 'LOOPBACK_ONLY');
      requireValue(!['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']), 'ORIGIN_DENIED');
      const url = new URL(request.url, origin);
      requireValue(url.origin === origin, 'ORIGIN_DENIED');
      if (request.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const types = { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' };
        response.writeHead(200, { 'Content-Type': types[name] + '; charset=utf-8' });
        response.end(await readFile(resolve(buildDirectory, name))); return;
      }
      const cookie = request.headers.cookie?.match(/(?:^|;\s*)kit_session=([A-Za-z0-9_-]+)/)?.[1];
      let session = cookie && sessions.get(cookie);
      for (const [token, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(token);
      if (session && session.expiresAt < Date.now()) { sessions.delete(cookie); session = null; }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        if (!session) {
          requireValue(sessions.size < 100, 'SESSION_LIMIT');
          const token = randomBytes(32).toString('base64url');
          session = { actor: config.people.find(row => row.roles.includes('inspect')).id,
            csrf: randomBytes(32).toString('base64url'), expiresAt: Date.now() + 2 * 3600000 };
          sessions.set(token, session);
          response.setHeader('Set-Cookie', `kit_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200`);
        }
        reply(response, 200, { csrf: session.csrf, demonstration: true }); return;
      }
      requireValue(request.method === 'POST' && url.pathname === '/api/rpc', 'ROUTE_NOT_FOUND');
      requireValue(session && request.headers.origin === origin &&
        request.headers['x-kit-csrf'] === session.csrf, 'CSRF_DENIED');
      requireValue(request.headers['content-type']?.split(';')[0] === 'application/json', 'REQUEST_INVALID');
      const bodyChunks = []; let count = 0;
      for await (const bytes of request) {
        count += bytes.length; requireValue(count <= 120000, 'REQUEST_TOO_LARGE'); bodyChunks.push(bytes);
      }
      let payload;
      try { payload = JSON.parse(Buffer.concat(bodyChunks).toString('utf8')); } catch { throw new KitError('REQUEST_INVALID'); }
      requireValue(payload && typeof payload === 'object' && !Array.isArray(payload) &&
        Object.keys(payload).every(key => ['action', 'command', 'id'].includes(key)), 'REQUEST_INVALID');
      const context = { kind: 'sandbox-fixture', personId: session.actor };
      let data;
      switch (payload.action) {
        case 'bootstrap':
          data = webState(service, context, CAPABILITIES);
          data.actors = config.people.filter(row => row.active).map(row => ({ id: row.id, label: row.label }));
          break;
        case 'actor':
          requireValue(config.people.some(row => row.id === payload.id && row.active), 'PERSON_INACTIVE');
          session.actor = payload.id; data = { switched: true, demonstration: true }; break;
        case 'execute': data = service.execute(context, payload.command); break;
        case 'case': data = service.caseDetails(context, payload.id); break;
        case 'preview': data = service.notificationPreview(context, payload.id); break;
        case 'pdf': {
          const record = service.dashboard(context).records.find(row => row.id === payload.id);
          requireValue(record, 'FORBIDDEN');
          const label = config.people.find(row => row.id === record.reporterId)?.label;
          const bytes = await demoPdf(record, label);
          data = { name: 'DEMO-' + record.id + '.pdf', mime: 'application/pdf',
            base64: bytes.toString('base64'), demonstration: true }; break;
        }
        default: requireValue(false, 'ACTION_NOT_SUPPORTED');
      }
      reply(response, 200, { ok: true, data });
    } catch (error) {
      const code = error instanceof KitError ? error.code : 'INTERNAL_ERROR';
      reply(response, code === 'ROUTE_NOT_FOUND' ? 404 : ['LOOPBACK_ONLY', 'CSRF_DENIED', 'ORIGIN_DENIED'].includes(code) ? 403 : 400,
        { ok: false, error: { code } });
    }
  });
  return { service, server, async listen(port = 4317) {
    await new Promise((resolvePromise, reject) => {
      server.once('error', reject); server.listen(port, '127.0.0.1', resolvePromise);
    });
    origin = 'http://127.0.0.1:' + server.address().port;
    return origin;
  }, async close() {
    server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise));
  } };
}
