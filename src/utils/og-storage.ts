/**
 * 0G Storage Integration
 * Stores prompt data, test results, and evaluation outputs on 0G Storage Turbo.
 *
 * Uploads use the official SDK with the user's MetaMask wallet (storage fee tx).
 */

import { MemData, Indexer } from '@0gfoundation/0g-storage-ts-sdk/browser';
import { BrowserProvider } from 'ethers';
import { OG_TESTNET_CHAIN_ID } from './og-chain';

const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const INDEXER_RPC = 'https://indexer-storage-testnet-turbo.0g.ai';

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

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

async function getSigner() {
  if (!window.ethereum) {
    return null;
  }

  const provider = new BrowserProvider(window.ethereum);
  const accounts = (await provider.send('eth_accounts', [])) as string[];
  if (!accounts.length) {
    return null;
  }

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== OG_TESTNET_CHAIN_ID) {
    throw new Error(
      `Switch MetaMask to 0G Testnet (chain ${OG_TESTNET_CHAIN_ID}) before uploading to storage`
    );
  }

  return provider.getSigner();
}

function friendlyUploadError(message: string): string {
  if (message.includes('User rejected') || message.includes('user rejected')) {
    return 'Storage upload rejected in wallet';
  }
  if (message.includes('insufficient funds')) {
    return 'Insufficient 0G for storage fees — get testnet tokens from the faucet';
  }
  return message;
}

function parseStoredPayload(raw: string): StorageData | null {
  try {
    const parsed = JSON.parse(raw) as StorageData & { version?: string };
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
 * Upload evaluation data to 0G Storage (requires wallet approval for storage fees).
 */
export async function uploadToStorage(data: StorageData): Promise<StorageResult> {
  console.log('[0G Storage] Uploading via SDK...');

  try {
    const signer = await getSigner();
    if (!signer) {
      return {
        success: false,
        rootHash: null,
        error: 'Wallet not connected — connect MetaMask to upload to 0G Storage',
      };
    }

    const payload = JSON.stringify({
      version: 'PROMPTLEDGER_STORAGE_V1',
      ...data,
    });
    const bytes = new TextEncoder().encode(payload);
    const memData = new MemData(bytes);

    const [, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      return {
        success: false,
        rootHash: null,
        error: `Merkle tree failed: ${treeErr}`,
      };
    }

    const indexer = new Indexer(INDEXER_RPC);
    console.log('[0G Storage] Approve the storage fee transaction in MetaMask...');

    const [tx, uploadErr] = await indexer.upload(memData, RPC_URL, signer);
    if (uploadErr !== null) {
      const friendly = friendlyUploadError(String(uploadErr));
      console.error('[0G Storage] Upload failed:', friendly);
      return {
        success: false,
        rootHash: null,
        error: friendly,
      };
    }

    const rootHash = 'rootHash' in tx ? tx.rootHash : tx.rootHashes[0];
    const storageTxHash = 'txHash' in tx ? tx.txHash : tx.txHashes[0];

    console.log('[0G Storage] Upload successful:', rootHash);
    console.log('[0G Storage] Storage tx:', storageTxHash);

    return {
      success: true,
      rootHash,
      storageTxHash,
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
    return { data: parseStoredPayload(localData), isLocal: true };
  }

  try {
    const indexer = new Indexer(INDEXER_RPC);
    const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });
    if (err !== null) {
      console.warn('[0G Storage] Download failed:', err);
      return { data: null, isLocal: false };
    }

    const text = await blob.text();
    const data = parseStoredPayload(text);
    if (data) {
      console.log('[0G Storage] Downloaded from network:', rootHash);
      return { data, isLocal: false };
    }
  } catch (error) {
    console.warn('[0G Storage] Network download failed:', error);
  }

  return { data: null, isLocal: false };
}

export type { StorageData };