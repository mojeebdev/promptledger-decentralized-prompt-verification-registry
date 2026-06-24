# Deploying PromptLedger to 0G Testnet

## Prerequisites
- MetaMask or compatible wallet
- 0G Testnet tokens (get from faucet if needed)
- 0G Testnet added to your wallet:
  - Chain ID: 16602
  - RPC: https://evmrpc-testnet.0g.ai
  - Explorer: https://explorer-testnet.0g.ai
  - Symbol: 0G

## Option 1: Deploy via Remix (Easiest)

1. Go to https://remix.ethereum.org
2. Create a new file `PromptLedger.sol` and paste the contract code
3. Go to Solidity Compiler tab, compile with 0.8.20+
4. Go to Deploy & Run Transactions tab:
   - Environment: "Injected Provider - MetaMask"
   - Make sure MetaMask is on 0G Testnet
   - Click "Deploy"
5. Confirm the transaction in MetaMask
6. Copy the deployed contract address

## Option 2: Deploy via cast (Foundry)

```bash
# Install Foundry if needed
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Deploy (replace YOUR_PRIVATE_KEY with your key)
cast deploy \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --private-key YOUR_PRIVATE_KEY \
  contracts/PromptLedger.sol:PromptLedger
```

## Option 3: Deploy via Hardhat

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network og-testnet
```

## After Deployment

1. Copy the deployed contract address
2. Add to `.env.local` (and your hosting provider's env vars for production builds):
   ```
   VITE_PROMPT_LEDGER_ADDRESS=0xYourDeployedAddress
   ```
3. Update the address in `README.md` under Smart contract
4. Restart dev server — navbar should show **Contract Live**

## Testing the Contract

After deploying, you can test with cast:

```bash
# Anchor a prompt (replace values)
cast send CONTRACT_ADDRESS \
  "anchorPrompt(bytes32,bytes32,bytes32,uint8)" \
  0x1234... 0x0000... 0x5678... 14 \
  --rpc-url https://evmrpc-testnet.0g.ai \
  --private-key YOUR_PRIVATE_KEY

# Read a prompt
cast call CONTRACT_ADDRESS \
  "getPrompt(bytes32)" 0x1234... \
  --rpc-url https://evmrpc-testnet.0g.ai
```

## Verify on Explorer

After deploying, verify the contract source on:
https://explorer-testnet.0g.ai

This makes the contract readable and interactions traceable.
