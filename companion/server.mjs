import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resource } from './windows.mjs';
const equal = (a, b) => {
  const first = Buffer.from(a || ''),
    second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
};
export async function managementServer(service, { port = 0, resources = resource } = {}) {
  const token = randomBytes(32).toString('base64url'),
    bootstraps = new Map();
  const issueBootstrap = () => {
    for (const [key, at] of bootstraps) if (Date.now() - at > 300000) bootstraps.delete(key);
    if (bootstraps.size >= 16) bootstraps.delete(bootstraps.keys().next().value);
    const value = randomBytes(32).toString('base64url');
    bootstraps.set(value, Date.now());
    return value;
  };
  const bootstrap = issueBootstrap();
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.host !== new URL(origin).host) {
      res.writeHead(403);
      res.end('Invalid Host');
      return;
    }
    const url = new URL(req.url, origin);
    try {
      if (url.pathname === '/session' && req.method === 'POST') {
        const supplied = req.headers['x-pkm-bootstrap'];
        const issued =
          typeof supplied === 'string'
            ? [...bootstraps.keys()].find((key) => equal(supplied, key))
            : null;
        if (
          req.headers.origin !== origin ||
          !issued ||
          Date.now() - bootstraps.get(issued) > 300000
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        bootstraps.delete(issued);
        res.setHeader('Set-Cookie', `pkm_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
        res.setHeader('Content-Type', 'application/json');
        res.end('{"ok":true}');
        return;
      }
      const cookie = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('pkm_session='))
        ?.slice(12);
      if (url.pathname === '/api') {
        if (
          !equal(cookie, token) ||
          req.method !== 'POST' ||
          req.headers.origin !== origin ||
          req.headers['content-type'] !== 'application/json'
        ) {
          res.writeHead(403);
          res.end();
          return;
        }
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) throw new Error('Request is too large.');
          chunks.push(chunk);
        }
        const { command, payload } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (command === 'app.browser-session') {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              ok: true,
              result: {
                url: `${origin}/${payload?.settings ? '?settings=1' : ''}#${issueBootstrap()}`,
              },
            }),
          );
          return;
        }
        if (command === 'app.quit') {
          res.setHeader('Content-Type', 'application/json');
          res.end('{"ok":true,"result":{"closed":true}}');
          setImmediate(() => {
            server.close(() => service.close());
          });
          return;
        }
        const result = await service.handle(command, payload);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, result }));
        return;
      }
      const assets = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
      if (req.method !== 'GET' || !assets[url.pathname]) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        'Content-Type',
        url.pathname.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : url.pathname.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : 'text/html; charset=utf-8',
      );
      res.end(Buffer.from(await resources(assets[url.pathname])));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/#${bootstrap}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
