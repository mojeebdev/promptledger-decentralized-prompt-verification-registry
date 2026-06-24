import { MemData, Indexer } from '@0gfoundation/0g-storage-ts-sdk';
import { ethers } from 'ethers';

const DEFAULT_RPC = 'https://evmrpc-testnet.0g.ai';
const DEFAULT_INDEXER = 'https://indexer-storage-testnet-turbo.0g.ai';

function getConfig(env = process.env) {
  return {
    privateKey: env.OG_STORAGE_PRIVATE_KEY,
    rpcUrl: env.OG_STORAGE_RPC_URL || DEFAULT_RPC,
    indexerRpc: env.OG_STORAGE_INDEXER_RPC || DEFAULT_INDEXER,
  };
}

function friendlyError(message) {
  const text = String(message);
  if (text.includes('insufficient funds')) {
    return 'Server storage wallet has insufficient 0G — fund OG_STORAGE_PRIVATE_KEY on testnet';
  }
  return text;
}

/**
 * Upload JSON payload to 0G Storage from the server (avoids browser mixed-content blocks).
 */
export async function uploadStorage(body, env = process.env) {
  const { privateKey, rpcUrl, indexerRpc } = getConfig(env);

  if (!privateKey) {
    return {
      status: 503,
      data: {
        error:
          'OG_STORAGE_PRIVATE_KEY not configured on server — add a funded testnet wallet private key in Vercel/Render env',
      },
    };
  }

  const payload = body?.data;
  if (!payload || typeof payload !== 'object') {
    return { status: 400, data: { error: 'Request body must include a data object' } };
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const indexer = new Indexer(indexerRpc);

    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const memData = new MemData(bytes);

    const [, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      return { status: 500, data: { error: `Merkle tree failed: ${treeErr}` } };
    }

    const [tx, uploadErr] = await indexer.upload(memData, rpcUrl, signer);
    if (uploadErr !== null) {
      return { status: 502, data: { error: friendlyError(uploadErr) } };
    }

    const rootHash = 'rootHash' in tx ? tx.rootHash : tx.rootHashes[0];
    const storageTxHash = 'txHash' in tx ? tx.txHash : tx.txHashes[0];

    return {
      status: 200,
      data: {
        rootHash,
        storageTxHash,
        isLocalFallback: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storage upload failed';
    return { status: 502, data: { error: friendlyError(message) } };
  }
}

/**
 * Download stored JSON by root hash (server-side; storage nodes are HTTP-only).
 */
export async function downloadStorage(rootHash, env = process.env) {
  const { indexerRpc } = getConfig(env);

  if (!rootHash || typeof rootHash !== 'string') {
    return { status: 400, data: { error: 'root query parameter is required' } };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(rootHash)) {
    return { status: 400, data: { error: 'Invalid root hash format' } };
  }

  try {
    const indexer = new Indexer(indexerRpc);
    const [blob, err] = await indexer.downloadToBlob(rootHash, { proof: true });

    if (err !== null) {
      return { status: 404, data: { error: String(err) } };
    }

    const text = await blob.text();
    const data = JSON.parse(text);

    return { status: 200, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storage download failed';
    return { status: 502, data: { error: message } };
  }
}

export function getStorageHealth(env = process.env) {
  const { indexerRpc, rpcUrl } = getConfig(env);
  return {
    indexer: indexerRpc,
    rpc: rpcUrl,
    hasStorageKey: Boolean(env.OG_STORAGE_PRIVATE_KEY),
  };
}