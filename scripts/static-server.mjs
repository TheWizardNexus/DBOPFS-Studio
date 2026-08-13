import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { assertInside } from './project.mjs';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.zip', 'application/zip']
]);

function sendError(response, statusCode, message) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(`${message}\n`);
}

async function locateFile(root, requestUrl) {
  const url = new URL(requestUrl, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }

  if (pathname.includes('\0')) {
    return null;
  }

  const relative = pathname.replace(/^\/+/, '');
  let candidate = path.resolve(root, relative || 'index.html');
  assertInside(root, candidate);

  try {
    const stats = await lstat(candidate);
    if (stats.isDirectory()) {
      candidate = path.join(candidate, 'index.html');
      assertInside(root, candidate);
    }
    const fileStats = await lstat(candidate);
    return fileStats.isFile() ? { filePath: candidate, stats: fileStats } : null;
  } catch {
    return null;
  }
}

export async function createStaticServer(options) {
  const root = path.resolve(options.root);
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? 0);

  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendError(response, 405, 'Method not allowed');
      return;
    }

    let located;
    try {
      located = await locateFile(root, request.url || '/');
    } catch {
      sendError(response, 403, 'Forbidden');
      return;
    }

    if (!located) {
      sendError(response, 404, 'Not found');
      return;
    }

    const responseHeaders = typeof options.headers === 'function'
      ? options.headers(request, located.filePath)
      : options.headers || {};

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': located.stats.size,
      'Content-Type': contentTypes.get(path.extname(located.filePath).toLowerCase()) ||
        'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...responseHeaders
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(located.filePath).pipe(response);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const origin = `http://${host}:${address.port}`;
  return {
    origin,
    root,
    server,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
