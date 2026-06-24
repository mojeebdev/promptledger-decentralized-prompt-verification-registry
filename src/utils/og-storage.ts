/**
 * 0G Storage Integration
 *
 * Browser uploads go through /api/storage because 0G storage nodes are
 * HTTP-only and blocked as mixed content on HTTPS deployments (e.g. Vercel).
 */

interface StorageData {
  promptTitle: string;
  promptText: string;
  promptHash: string;
  parentHash: string | null;
  version: number;
  submitter: string;
  timestamp: number;
  testCases: Array<{
    id: number;
    type: string;
    input: string;
    expected: { name: string; date: string; amount: string };
  }>;
  modelOutputs: Array<{
    caseId: number;
    rawOutput: string;
    extracted: { name: string; date: string; amount: string };
  }>;
  results: Array<{
    caseId: number;
    type: string;
    namePass: boolean;
    datePass: boolean;
    amountPass: boolean;
    extracted: { name: string; date: string; amount: string };
  }>;
  score: number;
  maxScore: number;
}

export interface StorageResult {
  success: boolean;
  rootHash: string | null;
  storageTxHash?: string;
  error?: string;
  isLocalFallback?: boolean;
}

function friendlyUploadError(message: string): string {
  if (message.includes('OG_STORAGE_PRIVATE_KEY')) {
    return 'Server storage wallet not configured — add OG_STORAGE_PRIVATE_KEY in Vercel env';
  }
  if (message.includes('insufficient funds')) {
    return 'Server storage wallet needs more testnet 0G for storage fees';
  }
  if (message.includes('Network Error') || message.includes('Mixed Content')) {
    return 'Storage API unreachable — ensure /api/storage is deployed (Vercel/Render, not static-only)';
  }
  return message;
}

function parseStoredPayload(raw: unknown): StorageData | null {
  if (!raw || typeof raw !== 'object') return null;

  try {
    const parsed = raw as StorageData & { version?: string };
    if (parsed.version === 'PROMPTLEDGER_STORAGE_V1') {
      const { version: _version, ...data } = parsed;
      return data;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Upload evaluation data to 0G Storage via backend proxy.
 */
export async function uploadToStorage(data: StorageData): Promise<StorageResult> {
  console.log('[0G Storage] Uploading via /api/storage...');

  try {
    const response = await fetch('/api/storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          version: 'PROMPTLEDGER_STORAGE_V1',
          ...data,
        },
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = friendlyUploadError(result.error || `HTTP ${response.status}`);
      console.error('[0G Storage] Upload failed:', error);
      return { success: false, rootHash: null, error };
    }

    console.log('[0G Storage] Upload successful:', result.rootHash);

    return {
      success: true,
      rootHash: result.rootHash,
      storageTxHash: result.storageTxHash,
      isLocalFallback: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown storage error';
    console.error('[0G Storage] Upload failed:', errorMsg);
    return {
      success: false,
      rootHash: null,
      error: friendlyUploadError(errorMsg),
    };
  }
}

/**
 * Download data from 0G Storage by root hash.
 */
export async function downloadFromStorage(
  rootHash: string
): Promise<{ data: StorageData | null; isLocal: boolean }> {
  const localKey = `promptledger_local_${rootHash.slice(0, 16)}`;
  const localData = localStorage.getItem(localKey);

  if (localData) {
    console.log('[0G Storage] Found in local storage:', rootHash);
    return { data: parseStoredPayload(JSON.parse(localData)), isLocal: true };
  }

  try {
    const response = await fetch(`/api/storage?root=${encodeURIComponent(rootHash)}`);
    if (response.ok) {
      const raw = await response.json();
      const data = parseStoredPayload(raw);
      if (data) {
        console.log('[0G Storage] Downloaded from network:', rootHash);
        return { data, isLocal: false };
      }
    }
  } catch (error) {
    console.warn('[0G Storage] Network download failed:', error);
  }

  return { data: null, isLocal: false };
}

export type { StorageData };