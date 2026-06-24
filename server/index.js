import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyCompute, getHealth } from './proxy-compute.js';
import { uploadStorage, downloadStorage, getStorageHealth } from './proxy-storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

loadEnv();

const PORT = Number(process.env.PORT || 3001);
const DIST_DIR = join(ROOT, 'dist');
const SERVE_STATIC = process.env.NODE_ENV === 'production' && existsSync(DIST_DIR);

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function serveStatic(req, res) {
  let path = req.url.split('?')[0];
  if (path === '/') path = '/index.html';
  const filePath = join(DIST_DIR, path);
  if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath) || path.includes('..')) {
    const indexPath = join(DIST_DIR, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(indexPath));
      return;
    }
    json(res, 404, { error: 'Not found' });
    return;
  }
  const ext = filePath.split('.').pop();
  const types = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    svg: 'image/svg+xml',
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  if (req.url === '/api/health' && req.method === 'GET') {
    json(res, 200, { ...getHealth(), storage: getStorageHealth() });
    return;
  }

  if (req.url?.startsWith('/api/storage')) {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', async () => {
        try {
          const body = JSON.parse(raw || '{}');
          const result = await uploadStorage(body);
          json(res, result.status, result.data);
        } catch {
          json(res, 400, { error: 'Invalid JSON body' });
        }
      });
      return;
    }

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const root = url.searchParams.get('root');
      const result = await downloadStorage(root);
      json(res, result.status, result.data);
      return;
    }
  }

  if (req.url === '/api/compute' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        const result = await proxyCompute(body);
        json(res, result.status, result.data);
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
      }
    });
    return;
  }

  if (SERVE_STATIC && req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  const health = getHealth();
  console.log(`[PromptLedger API] http://localhost:${PORT}`);
  console.log(`[PromptLedger API] Router: ${health.router}`);
  console.log(`[PromptLedger API] Model: ${health.model}`);
  console.log(`[PromptLedger API] API key: ${health.hasApiKey ? 'configured' : 'MISSING'}`);
  const storage = getStorageHealth();
  console.log(`[PromptLedger API] Storage key: ${storage.hasStorageKey ? 'configured' : 'MISSING'}`);
  if (SERVE_STATIC) console.log(`[PromptLedger API] Serving static files from dist/`);
});