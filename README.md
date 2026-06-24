# PromptLedger

**A decentralized prompt verification registry.**

PromptLedger lets prompt engineers prove their prompts actually work — with receipts. Submit a system prompt for a structured data extraction task, watch it run against five fixed test cases via 0G Compute, and get a tamper-proof, on-chain version history of every score.

Built for [The Zero Cup](https://0g.ai/arena/zero-cup) — 0G's Global Vibe Coding Tournament.

---

## Why this exists

Leaderboards are easy to fake. Anyone can post a "14/15" score with no way to verify it's real, or quietly edit it later. PromptLedger removes that trust gap: every score comes from an actual model run against a fixed benchmark, and the result — its hash, its parent version, its score — is anchored on-chain where it can't be rewritten.

**0G is load-bearing, not decorative.** Remove it and the entire pitch collapses into a spreadsheet someone could edit:

| Layer | What it does here |
|---|---|
| **0G Compute** | Runs the actual model (`zai-org/GLM-5-FP8`) against each test case — no canned or fabricated outputs |
| **0G Storage** | Holds the full prompt text, test inputs, and model outputs behind every score |
| **0G Chain** | Anchors the prompt hash, parent-version hash, and final score in an on-chain contract, making every version's lineage public and provably untampered |

---

## How it works

1. **Connect a wallet.** Browsing the leaderboard and any proof page never requires one — only submitting does.
2. **Write a system prompt** for the task: extract `name`, `date`, and `amount` from a messy block of text into clean JSON.
3. **Submit.** The prompt runs against five fixed, never-regenerated test cases (an invoice, an email, a handwritten note, a receipt, and a mixed-format confirmation), each with a known-correct answer.
4. **Get a real score**, out of 15 (3 fields × 5 cases), based on the model's actual output — not a random number.
5. **The result is anchored on-chain** — hash, parent hash (if it's a revision), and score — via a signed transaction from the submitter's own wallet.
6. **Browse the leaderboard or any proof page** to see the full version lineage back to v1, with every hash traceable on the 0G block explorer.

---

## What's real, and what's honestly degraded

Every integration either does the real thing or tells you clearly when it can't — there is no silent fallback that pretends to succeed.

- If **0G Storage** is unreachable, the app falls back to local storage and explicitly flags the entry `isLocalFallback: true` — the UI shows this as a warning, not a success.
- If **0G Compute** fails and demo mode is explicitly enabled, results are generated from regex pattern-matching instead of the real model — flagged `isDemo: true` and shown with a warning border in the UI. Demo mode is off by default; without it, a compute failure is reported as an honest error.
- If the **chain anchor** transaction fails or the contract isn't deployed, the entry is marked `chainAnchorPending` rather than showing a fabricated transaction hash.

This matters because an earlier iteration of this project *did* fake all three of these — random scores, a randomly generated wallet address, a `Math.random()` transaction hash dressed up as a real one. That version was fully removed; nothing here references it. The code in this repo only ever shows you the truth about what succeeded.

---

## Tech stack

- **Frontend:** React 19 + TypeScript, Vite
- **Wallet:** wagmi + viem, injected connector (MetaMask-compatible)
- **Model:** 0G Compute, `zai-org/GLM-5-FP8`
- **Storage:** 0G Storage (with local fallback, explicitly flagged)
- **Chain:** 0G Testnet, custom `PromptLedger.sol` contract
- **Styling:** Tailwind CSS v4

---

## Smart contract

`contracts/PromptLedger.sol` — deployed to 0G Testnet at:

```
0xb6aedBF17a11928A63773F88a9CfD3E252F43a63
```

Network: 0G Testnet (chainId `16602`) · RPC: `https://evmrpc-testnet.0g.ai` · Explorer: `https://explorer-testnet.0g.ai`

The contract is intentionally minimal: a mapping from prompt hash to record (parent hash, storage root, score, submitter, timestamp), an `anchorPrompt` function to write a new record, and a `getVersionChain` function that walks a hash back to its v1 ancestor on-chain. See `contracts/DEPLOY.md` for redeployment instructions.

---

## Running locally

```bash
npm install
npm run dev
```

You'll need a wallet (MetaMask or compatible) with 0G Testnet added:

- Chain ID: `16602`
- RPC: `https://evmrpc-testnet.0g.ai`
- Explorer: `https://explorer-testnet.0g.ai`

Get testnet 0G from the official faucet to pay for the on-chain anchor transaction when submitting.

---

## Project structure

```
contracts/
  PromptLedger.sol    — the on-chain registry contract
  DEPLOY.md           — deployment instructions (Remix / Foundry / Hardhat)
src/
  App.tsx             — main app: submit flow, leaderboard, proof pages
  WalletButton.tsx    — wallet connect/disconnect UI
  providers.tsx       — wagmi + react-query provider setup
  wagmi-config.ts      — chain config (0G Testnet) and connector setup
  utils/
    hash.ts            — SHA-256 hashing for prompts and test sets
    og-compute.ts      — calls 0G Compute for model evaluation, with honest error/demo handling
    og-storage.ts      — uploads to 0G Storage, with honest local-fallback handling
    og-chain.ts        — encodes and sends the on-chain anchor transaction
```

---

## Scope (v1)

This is deliberately narrow rather than broad-and-partial:

- One task category: structured data extraction (name / date / amount)
- Five fixed test cases — the same benchmark for every submission, so scores are comparable
- Programmatic field-match scoring — no LLM-judge qualitative layer yet
- Free to browse, wallet required only to submit

Not in scope for v1: multiple task categories, head-to-head prompt battles, LLM-as-judge scoring.

---

## License

MIT — see `contracts/PromptLedger.sol` for the SPDX header.
