/**
 * 0G Chain Integration
 * Anchors prompt hashes and scores on-chain
 *
 * Network: 0G Testnet (chainId: 16602)
 */

import { encodeFunctionData } from 'viem';

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

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Override via .env.local if you deployed your own contract
const PROMPT_LEDGER_ADDRESS: `0x${string}` = (
  import.meta.env.VITE_PROMPT_LEDGER_ADDRESS ||
  '0xb6aedBF17a11928A63773F88a9CfD3E252F43a63'
) as `0x${string}`;

export const OG_TESTNET_CHAIN_ID = 16602;

// 0G Testnet chain config
export const OG_TESTNET = {
  id: OG_TESTNET_CHAIN_ID,
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
 * Check if on-chain anchoring is configured (contract address set)
 */
export function isChainAnchoringAvailable(): boolean {
  return (
    Boolean(PROMPT_LEDGER_ADDRESS) &&
    PROMPT_LEDGER_ADDRESS !== '0x0000000000000000000000000000000000000000'
  );
}

/**
 * Get the contract address
 */
export function getContractAddress(): string {
  return PROMPT_LEDGER_ADDRESS;
}

/**
 * Verify the configured contract has bytecode on 0G Testnet
 */
export async function verifyContractDeployed(publicClient: {
  getBytecode: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
}): Promise<boolean> {
  if (!isChainAnchoringAvailable()) return false;
  try {
    const bytecode = await publicClient.getBytecode({ address: PROMPT_LEDGER_ADDRESS });
    return Boolean(bytecode && bytecode !== '0x');
  } catch {
    return false;
  }
}

function toBytes32(value: string): `0x${string}` {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`Invalid bytes32 value: ${value}`);
  }
  return `0x${hex.padStart(64, '0').slice(0, 64)}` as `0x${string}`;
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
    chain: { id: number } | null;
    sendTransaction: (tx: {
      to: `0x${string}`;
      data: `0x${string}`;
      value?: bigint;
      chain?: typeof OG_TESTNET;
    }) => Promise<`0x${string}`>;
  };
}): Promise<AnchorResult> {
  const { promptHash, parentHash, storageRoot, score, walletClient } = params;

  if (!isChainAnchoringAvailable()) {
    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: true,
      error: 'Contract address not configured.',
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

  if (walletClient.chain?.id && walletClient.chain.id !== OG_TESTNET_CHAIN_ID) {
    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: false,
      error: `Wallet is on chain ${walletClient.chain.id}, not 0G Testnet (${OG_TESTNET_CHAIN_ID}). Switch network in MetaMask.`,
    };
  }

  try {
    const promptHashBytes = toBytes32(promptHash);
    const parentHashBytes = toBytes32(parentHash || ZERO_BYTES32);
    const storageRootBytes = toBytes32(storageRoot);

    const data = encodeFunctionData({
      abi: PROMPT_LEDGER_ABI,
      functionName: 'anchorPrompt',
      args: [promptHashBytes, parentHashBytes, storageRootBytes, score],
    });

    console.log('[0G Chain] Sending transaction to:', PROMPT_LEDGER_ADDRESS);
    console.log('[0G Chain] Explorer:', getExplorerContractUrl());

    const txHash = await walletClient.sendTransaction({
      to: PROMPT_LEDGER_ADDRESS,
      data,
      value: BigInt(0),
      chain: OG_TESTNET,
    });

    console.log('[0G Chain] Transaction sent:', txHash);
    console.log('[0G Chain] Tx explorer:', getExplorerTxUrl(txHash));

    return {
      success: true,
      txHash,
      blockNumber: BigInt(0),
      isPending: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[0G Chain] Transaction failed:', errorMessage);

    const friendly = errorMessage.includes('User rejected')
      ? 'Transaction rejected in wallet'
      : errorMessage.includes('insufficient funds')
        ? 'Insufficient 0G for gas — get testnet tokens from the faucet'
        : errorMessage.includes('Prompt already anchored')
          ? 'This prompt hash is already on-chain'
          : errorMessage;

    return {
      success: false,
      txHash: null,
      blockNumber: null,
      isPending: false,
      error: friendly,
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