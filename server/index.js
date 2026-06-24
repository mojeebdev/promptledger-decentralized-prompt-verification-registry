import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

loadEnv();

const PORT = Number(process.env.PORT || 3001);
const API_KEY = process.env.OG_API_KEY || process.env.VITE_0G_API_KEY;
const ROUTER_API =
  process.env.OG_ROUTER_API ||
  process.env.VITE_0G_ROUTER_API ||
  'https://router-api-testnet.integratenetwork.work/v1';

const MODEL_BY_NETWORK = {
  testnet: 'qwen2.5-omni',
  mainnet: 'zai-org/GLM-5-FP8',
};

const MODEL_ID =
  process.env.OG_MODEL_ID ||
  (ROUTER_API.includes('testnet') || ROUTER_API.includes('integratenetwork')
    ? MODEL_BY_NETWORK.testnet
    : MODEL_BY_NETWORK.mainnet);

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

async function proxyCompute(body) {
  if (!API_KEY) {
    return { status: 503, data: { error: 'OG_API_KEY not configured on server' } };
  }

  const { systemPrompt, testInput, model } = body;
  if (!systemPrompt || !testInput) {
    return { status: 400, data: { error: 'systemPrompt and testInput are required' } };
  }

  const requestedModel = model || MODEL_ID;
  const modelsToTry = unique([
    requestedModel,
    MODEL_ID,
    ROUTER_API.includes('testnet') || ROUTER_API.includes('integratenetwork')
      ? MODEL_BY_NETWORK.testnet
      : MODEL_BY_NETWORK.mainnet,
    MODEL_BY_NETWORK.testnet,
    MODEL_BY_NETWORK.mainnet,
  ]);

  let lastError = null;

  for (const modelId of modelsToTry) {
    const payload = {
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Extract the name, date, and amount from this text. Return ONLY valid JSON with keys: name, date (YYYY-MM-DD format), amount (decimal number only).\n\nText:\n${testInput}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${ROUTER_API}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        lastError = {
          model: modelId,
          status: response.status,
          error: data?.error?.message || data?.error || text.slice(0, 200),
        };
        // 404 usually means model unavailable on this network — try next
        if (response.status === 404) continue;
        return { status: response.status, data: { error: lastError.error, model: modelId } };
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = { model: modelId, status: 502, error: 'Empty model response' };
        continue;
      }

      return {
        status: 200,
        data: {
          output: content,
          model: modelId,
          trace: data?.x_0g_trace || null,
        },
      };
    } catch (error) {
      lastError = {
        model: modelId,
        status: 502,
        error: error instanceof Error ? error.message : 'Proxy request failed',
      };
    }
  }

  return {
    status: 502,
    data: {
      error:
        lastError?.error ||
        'All model attempts failed. On testnet use qwen2.5-omni; GLM-5 is mainnet-only.',
      attemptedModels: modelsToTry,
      router: ROUTER_API,
    },
  };
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
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
    json(res, 200, {
      ok: true,
      router: ROUTER_API,
      model: MODEL_ID,
      hasApiKey: Boolean(API_KEY),
    });
    return;
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
  console.log(`[PromptLedger API] http://localhost:${PORT}`);
  console.log(`[PromptLedger API] Router: ${ROUTER_API}`);
  console.log(`[PromptLedger API] Model: ${MODEL_ID}`);
  console.log(`[PromptLedger API] API key: ${API_KEY ? 'configured' : 'MISSING'}`);
  if (SERVE_STATIC) console.log(`[PromptLedger API] Serving static files from dist/`);
});