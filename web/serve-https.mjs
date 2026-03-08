#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = __dirname;

const defaultPort = 8080;
const port = parsePort(process.env.PORT, defaultPort);
const host = process.env.HOST || 'localhost';
const listenHost = process.env.LISTEN_HOST || (host === 'localhost' ? '127.0.0.1' : host);
const certDir = path.resolve(
  process.env.CLAWSER_DEV_CERT_DIR || path.join(process.cwd(), 'node_modules', '.cache', 'clawser-dev-cert'),
);
const certPath = path.resolve(process.env.CLAWSER_DEV_CERT_PATH || path.join(certDir, 'localhost-cert.pem'));
const keyPath = path.resolve(process.env.CLAWSER_DEV_KEY_PATH || path.join(certDir, 'localhost-key.pem'));

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
]);

ensureLocalhostCertificate(certPath, keyPath, certDir);

const server = https.createServer(
  {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  },
  (req, res) => {
    try {
      if (!req.url) {
        writeError(res, 400, 'Bad Request');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeError(res, 405, 'Method Not Allowed');
        return;
      }

      const requestUrl = new URL(req.url, `https://${host}:${port}`);
      const filePath = resolveRequestPath(requestUrl.pathname);
      if (!filePath) {
        writeError(res, 403, 'Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        writeError(res, 404, 'Not Found');
        return;
      }

      const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
      res.writeHead(200, {
        'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=60',
        'Content-Type': contentType,
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error('[clawser] HTTPS dev server failed:', error);
      if (!res.headersSent) {
        writeError(res, 500, 'Internal Server Error');
      } else {
        res.destroy(error);
      }
    }
  },
);

server.listen(port, listenHost, () => {
  console.log(`[clawser] Serving ${webRoot} at https://${host}:${port}`);
  console.log(`[clawser] Local certificate cache: ${certDir}`);
  console.log('[clawser] Press Ctrl+C to stop.');
});

function parsePort(rawPort, fallback) {
  const parsed = Number(rawPort || fallback);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function resolveRequestPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalized = path.posix.normalize(decodedPath);
  if (normalized.includes('\0')) {
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  let candidate = path.resolve(webRoot, relativePath);
  if (!isWithinRoot(candidate, webRoot)) {
    return null;
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    candidate = path.join(candidate, 'index.html');
  } else if (!fs.existsSync(candidate) && shouldServeIndex(normalized)) {
    candidate = path.join(webRoot, 'index.html');
  }

  return candidate;
}

function isWithinRoot(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shouldServeIndex(normalizedPath) {
  if (normalizedPath === '/' || normalizedPath === '') {
    return true;
  }

  return path.posix.extname(normalizedPath) === '';
}

function writeError(res, statusCode, message) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(message);
}

function ensureLocalhostCertificate(certFile, keyFile, outputDir) {
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const configPath = path.join(outputDir, 'openssl-localhost.cnf');
  fs.writeFileSync(
    configPath,
    [
      '[req]',
      'distinguished_name = req_distinguished_name',
      'x509_extensions = v3_req',
      'prompt = no',
      '',
      '[req_distinguished_name]',
      'CN = localhost',
      '',
      '[v3_req]',
      'subjectAltName = @alt_names',
      'keyUsage = digitalSignature,keyEncipherment',
      'extendedKeyUsage = serverAuth',
      '',
      '[alt_names]',
      'DNS.1 = localhost',
      'IP.1 = 127.0.0.1',
      'IP.2 = ::1',
      '',
    ].join('\n'),
  );

  const result = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '365',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-config',
      configPath,
      '-extensions',
      'v3_req',
    ],
    { encoding: 'utf8' },
  );

  if (result.error) {
    throw new Error(`openssl is required to generate a localhost certificate: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'openssl failed to generate the localhost certificate');
  }
}
