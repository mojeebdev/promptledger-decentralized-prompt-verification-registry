/**
 * 0G Chain Integration
 * Anchors prompt hashes and scores on-chain
 * 
 * CONTRACT DEPLOYED: 0xb6aedBF17a11928A63773F88a9CfD3E252F43a63
 * Network: 0G Testnet (chainId: 16602)
 */

import { encodeFunctionData, parseEther } from 'viem';

// PromptLedger contract ABI
const PROMPT_LEDGER_ABI = [
  {
    name: 'anchorPrompt',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'promptHash', type: 'bytes32' },
      { name: 'parentHash', type: 'bytes32' },
      { name: 'storageRoot', type: 'bytes32' },
      { name: 'score', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    name: 'getPrompt',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'promptHash', type: 'bytes32' }],
    outputs: [
      { name: 'parentHash', type: 'bytes32' },
      { name: 'storageRoot', type: 'bytes32' },
      { name: 'score', type: 'uint8' },
      { name: 'submitter', type: 'address' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'exists', type: 'bool' },
    ],
  },
  {
    name: 'getTotalPrompts',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'PromptAnchored',
    type: 'event',
    inputs: [
      { name: 'promptHash', type: 'bytes32', indexed: true },
      { name: 'submitter', type: 'address', indexed: true },
      { name: 'score', type: 'uint8' },
      { name: 'blockNumber', type: 'uint256' },
    ],
  },
] as const;

// DEPLOYED CONTRACT ADDRESS - 0G Testnet
const PROMPT_LEDGER_ADDRESS: `0x${string}` = '0xb6aedBF17a11928A63773F88a9CfD3E252F43a63';

// 0G Testnet chain config
export const OG_TESTNET = {
  id: 16602,
  name: '0G Testnet',
  nativeCurrency: { name: '0G', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmrpc-testnet.0g.ai'] },
  },
  blockExplorers: {
    default: { name: '0G Explorer', url: 'https://explorer-testnet.0g.ai' },
  },
} as const;

export interface AnchorResult {
  success: boolean;
  txHash: string | null;
  blockNumber: bigint | null;
  error?: string;
  isPending: boolean;
}

export interface PromptRecord {
  parentHash: string;
  storageRoot: string;
  score: number;
  submitter: string;
  timestamp: number;
  exists: boolean;
}

/**
 * Check if on-chain anchoring is available
 */
export function isChainAnchoringAvailable(): boolean {
  return PROMPT_LEDGER_ADDRESS !== null && PROMPT_LEDGER_ADDRESS !== '0x0000000000000000000000000000000000000000';
}

/**
 * Get the contract address
 */
export function getContractAddress(): string {
  return PROMPT_LEDGER_ADDRESS;
}

/**
 * Anchor a prompt's hash and score to 0G Chain
 */
export async function anchorToChain(params: {
  promptHash: string;
  parentHash: string | null;
  storageRoot: string;
  score: number;
  walletClient?: {
    account: { address: `0x${string}` };
    chain: { id: number };
    sendTransaction: (tx: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
    }) => Promise<`0x${string}`>;
  };
}): Promise<AnchorResult> {
  const { promptHash, parentHash, storageRoot, score, walletClient } = params;

  if (!PROMPT_LEDGER_ADDRESS) {
    console.log('[0G Chain] Contract not deployed - anchor pending');
    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: true,
      error: 'Contract not deployed. On-chain anchoring pending.',
    };
  }

  if (!walletClient) {
    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: true,
      error: 'Wallet not connected',
    };
  }

  try {
    const promptHashBytes = promptHash as `0x${string}`;
    const parentHashBytes = (parentHash || '0x0000000000000000000000000000000000000000000000000000000000000000') as `0x${string}`;
    const storageRootBytes = storageRoot as `0x${string}`;

    // Encode function call
    const data = encodeFunctionData({
      abi: PROMPT_LEDGER_ABI,
      functionName: 'anchorPrompt',
      args: [promptHashBytes, parentHashBytes, storageRootBytes, score],
    });

    console.log('[0G Chain] Sending transaction to:', PROMPT_LEDGER_ADDRESS);
    console.log('[0G Chain] Function data:', data);
    
    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: PROMPT_LEDGER_ADDRESS,
      data,
      value: BigInt(0),
    });

    console.log('[0G Chain] Transaction sent:', txHash);
    console.log('[0G Chain] Explorer:', `https://explorer-testnet.0g.ai/tx/${txHash}`);

    return {
      success: true,
      txHash,
      blockNumber: BigInt(0),
      isPending: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[0G Chain] Transaction failed:', errorMessage);
    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: false,
      error: errorMessage,
    };
  }
}

/**
 * Read a prompt record from the chain
 */
export async function getPromptFromChain(
  promptHash: string,
  publicClient?: {
    readContract: (params: {
      address: `0x${string}`;
      abi: typeof PROMPT_LEDGER_ABI;
      functionName: string;
      args: [string];
    }) => Promise<[`0x${string}`, `0x${string}`, bigint, `0x${string}`, bigint, boolean]>;
  }
): Promise<PromptRecord | null> {
  if (!PROMPT_LEDGER_ADDRESS || !publicClient) {
    return null;
  }

  try {
    const [parentHash, storageRoot, score, submitter, timestamp, exists] = 
      await publicClient.readContract({
        address: PROMPT_LEDGER_ADDRESS,
        abi: PROMPT_LEDGER_ABI,
        functionName: 'getPrompt',
        args: [promptHash],
      });

    return {
      parentHash,
      storageRoot,
      score: Number(score),
      submitter,
      timestamp: Number(timestamp),
      exists,
    };
  } catch (error) {
    console.error('[0G Chain] Failed to read from chain:', error);
    return null;
  }
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerTxUrl(txHash: string): string {
  return `https://explorer-testnet.0g.ai/tx/${txHash}`;
}

/**
 * Get block explorer URL for the contract
 */
export function getExplorerContractUrl(): string {
  return `https://explorer-testnet.0g.ai/address/${PROMPT_LEDGER_ADDRESS}`;
}

export { PROMPT_LEDGER_ABI, PROMPT_LEDGER_ADDRESS };
