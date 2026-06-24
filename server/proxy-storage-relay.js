/**
 * Relay JSON-RPC calls to 0G storage nodes (HTTP-only).
 * Browsers on HTTPS cannot call these directly (mixed content).
 * No wallet/private key required — only forwards segment upload/download RPCs.
 */

const STORAGE_NODE_PORT = '5678';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isAllowedStorageNodeUrl(nodeUrl) {
  try {
    const url = new URL(nodeUrl);
    return (
      url.protocol === 'http:' &&
      url.port === STORAGE_NODE_PORT &&
      IPV4.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export async function relayStorageRpc(body) {
  const { nodeUrl, payload } = body || {};

  if (!nodeUrl || typeof nodeUrl !== 'string' || !isAllowedStorageNodeUrl(nodeUrl)) {
    return { status: 400, data: { error: 'Invalid or disallowed storage node URL' } };
  }

  if (!payload || typeof payload !== 'object') {
    return { status: 400, data: { error: 'Missing JSON-RPC payload' } };
  }

  try {
    const response = await fetch(nodeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: text.slice(0, 200) } };
    }

    return { status: response.ok ? 200 : 502, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay request failed';
    return { status: 502, data: { error: { message } } };
  }
}