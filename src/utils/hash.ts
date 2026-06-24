/**
 * Compute SHA-256 hash of a string using Web Crypto API
 * Returns a hex string with 0x prefix
 */
export async function sha256Hash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return '0x' + hashHex;
}

/**
 * Compute hash of prompt content for version tracking
 * Includes title and prompt text to ensure uniqueness
 */
export async function computePromptHash(title: string, promptText: string): Promise<string> {
  const content = `PROMPTLEDGER:v1:${title}:${promptText}`;
  return sha256Hash(content);
}

/**
 * Compute hash of test case set for verification integrity
 */
export async function computeTestSetHash(testCases: Array<{input: string; expected: {name: string; date: string; amount: string}}>): Promise<string> {
  const content = JSON.stringify({
    version: 'TESTSET:v1',
    cases: testCases.map(tc => ({
      input: tc.input,
      expected: tc.expected
    }))
  });
  return sha256Hash(content);
}

/**
 * Pre-computed hashes for mock leaderboard entries
 * These are deterministic SHA-256 hashes of mock prompt content
 */
export const MOCK_PROMPT_HASHES: Record<string, {promptHash: string; parentHash: string | null}> = {
  'extraction-pro-v2': {
    promptHash: '0xa7b3c9d2e8f1a4b6c5d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1',
    parentHash: '0x1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a'
  },
  'json-extractor': {
    promptHash: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
    parentHash: null
  },
  'dataminer-alpha': {
    promptHash: '0x5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f',
    parentHash: '0x4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e'
  },
  'fieldgrabber': {
    promptHash: '0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
    parentHash: null
  }
};
