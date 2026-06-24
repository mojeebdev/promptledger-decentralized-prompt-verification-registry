/**
 * Intercept XMLHttpRequest to 0G storage nodes (HTTP :5678) and relay via HTTPS.
 * The 0G browser SDK bundles its own axios — patching the npm axios package does nothing.
 */

let patched = false;

function isStorageNodeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.port === '5678';
  } catch {
    return false;
  }
}

function dispatchXhrSuccess(xhr: XMLHttpRequest, status: number, statusText: string, body: string) {
  Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(xhr, 'status', { configurable: true, value: status });
  Object.defineProperty(xhr, 'statusText', { configurable: true, value: statusText });
  Object.defineProperty(xhr, 'responseText', { configurable: true, value: body });
  Object.defineProperty(xhr, 'response', { configurable: true, value: body });

  xhr.dispatchEvent(new Event('readystatechange'));
  xhr.dispatchEvent(new ProgressEvent('load'));
  xhr.dispatchEvent(new ProgressEvent('loadend'));
}

function dispatchXhrError(xhr: XMLHttpRequest) {
  Object.defineProperty(xhr, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(xhr, 'status', { configurable: true, value: 0 });
  Object.defineProperty(xhr, 'statusText', { configurable: true, value: '' });

  xhr.dispatchEvent(new Event('readystatechange'));
  xhr.dispatchEvent(new ProgressEvent('error'));
  xhr.dispatchEvent(new ProgressEvent('loadend'));
}

function setReadyState(xhr: XMLHttpRequest, state: number) {
  Object.defineProperty(xhr, 'readyState', { configurable: true, value: state });
  xhr.dispatchEvent(new Event('readystatechange'));
}

async function relayStorageNodeRequest(
  nodeUrl: string,
  body: Document | XMLHttpRequestBodyInit | null | undefined,
  xhr: XMLHttpRequest
) {
  try {
    setReadyState(xhr, 1);
    setReadyState(xhr, 2);

    const payload =
      typeof body === 'string'
        ? JSON.parse(body)
        : body instanceof ArrayBuffer
          ? JSON.parse(new TextDecoder().decode(body))
          : body;

    const response = await fetch('/api/storage-relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeUrl, payload }),
    });

    setReadyState(xhr, 3);
    const text = await response.text();
    dispatchXhrSuccess(xhr, response.status, response.statusText, text);
  } catch {
    dispatchXhrError(xhr);
  }
}

export function enableStorageNodeRelay() {
  if (patched || typeof window === 'undefined') return;
  patched = true;

  const xhrProto = XMLHttpRequest.prototype as XMLHttpRequest & {
    _storageRelayUrl?: string;
  };

  const originalOpen = xhrProto.open;
  xhrProto.open = function open(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    this._storageRelayUrl = typeof url === 'string' ? url : url.href;
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  const originalSend = xhrProto.send;
  xhrProto.send = function send(body?: Document | XMLHttpRequestBodyInit | null) {
    const targetUrl = this._storageRelayUrl;
    if (targetUrl && isStorageNodeUrl(targetUrl)) {
      void relayStorageNodeRequest(targetUrl, body, this);
      return;
    }
    return originalSend.call(this, body);
  };
}