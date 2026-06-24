/**
 * Patch axios so 0G storage node calls (HTTP) go through /api/storage-relay on HTTPS.
 * Must run before the 0G SDK makes any storage-node requests.
 */
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

let patched = false;

function isStorageNodeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.port === '5678';
  } catch {
    return false;
  }
}

function resolveRequestUrl(config: AxiosRequestConfig): string {
  const { url, baseURL } = config;
  if (url && /^https?:\/\//i.test(url)) return url;
  if (baseURL && url) return new URL(url, baseURL).href;
  return url || baseURL || '';
}

export function enableStorageNodeRelay() {
  if (patched || typeof window === 'undefined') return;
  patched = true;

  const originalRequest = axios.request.bind(axios);

  axios.request = async function relayingRequest<T = unknown, D = unknown>(
    config: AxiosRequestConfig<D>
  ): Promise<AxiosResponse<T>> {
    const fullUrl = resolveRequestUrl(config);

    if (isStorageNodeUrl(fullUrl)) {
      const payload =
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data;

      const relayResponse = await originalRequest<{
        result?: unknown;
        error?: { message?: string };
      }>({
        method: 'post',
        url: '/api/storage-relay',
        data: { nodeUrl: fullUrl, payload },
        headers: { 'Content-Type': 'application/json' },
        validateStatus: () => true,
      });

      return {
        data: relayResponse.data as T,
        status: relayResponse.status,
        statusText: relayResponse.statusText,
        headers: relayResponse.headers,
        config: relayResponse.config,
        request: relayResponse.request,
      };
    }

    return originalRequest<T, D>(config);
  };
}