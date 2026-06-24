import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, usePublicClient, useSwitchChain } from 'wagmi';
import {
  X,
  ChevronRight,
  Check,
  AlertCircle,
  ExternalLink,
  Copy,
  Hash,
  Trophy,
  Link2,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Zap,
  AlertTriangle,
  Bug,
  Info,
  Clock
} from 'lucide-react';
import { WalletButton } from './WalletButton';
import { computePromptHash } from './utils/hash';
import { 
  runPromptEvaluation, 
  parseExtractionOutput, 
  compareExtracted,
  getLastError,
  clearLastError,
  type ComputeResult
} from './utils/og-compute';
import { uploadToStorage, downloadFromStorage, type StorageData, type StorageResult } from './utils/og-storage';
import {
  anchorToChain,
  isChainAnchoringAvailable,
  getExplorerTxUrl,
  getExplorerContractUrl,
  getContractAddress,
  verifyContractDeployed,
  OG_TESTNET_CHAIN_ID,
  type AnchorResult,
} from './utils/og-chain';

// Fixed test cases - NEVER regenerated, always the same benchmark
const FIXED_TEST_CASES = [
  {
    id: 1,
    type: 'Invoice',
    input: `INV-2024-0892\nDate: March 15th, 2024\nBilled To: Sarah Mitchell\nTotal Due: $2,450.00\nPayment Terms: Net 30`,
    expected: { name: 'Sarah Mitchell', date: '2024-03-15', amount: '2450.00' }
  },
  {
    id: 2,
    type: 'Email',
    input: `From: john.davis@company.org\nSent: Tuesday, Jan 9, 2024\nSubject: Re: Contract\n\nHi,\n\nPlease find attached the signed agreement.\nAmount agreed: EUR 890.50\n\nBest,\nJohn Davis`,
    expected: { name: 'John Davis', date: '2024-01-09', amount: '890.50' }
  },
  {
    id: 3,
    type: 'Handwritten Note',
    input: `Reciept from Dr. Emily Chen\nVisit on 11/22/2023\nCopay: $35\n\n[illegible] thanks!`,
    expected: { name: 'Emily Chen', date: '2023-11-22', amount: '35.00' }
  },
  {
    id: 4,
    type: 'Receipt',
    input: `WHOLE FOODS MKT #10742\n12/28/23 14:32\n\nORGANIC CHICKEN    12.99\nAVOCADOS x3        5.97\nALMOND MILK         4.49\n--------------------\nTOTAL             $23.45\n\nCashier: Michael Torres`,
    expected: { name: 'Michael Torres', date: '2023-12-28', amount: '23.45' }
  },
  {
    id: 5,
    type: 'Mixed Format',
    input: `CONFIRMATION\nEvent: Annual Gala\nGuest: Alexandra "Alex" Peterson\nWhen: September 5 2024 @ 7PM\nTicket Price: USD150.00\n\n[QR CODE]\n\nThank you for your purchase!`,
    expected: { name: 'Alexandra Peterson', date: '2024-09-05', amount: '150.00' }
  }
];

// Type definitions
interface TestResult {
  caseId: number;
  type: string;
  namePass: boolean;
  datePass: boolean;
  amountPass: boolean;
  extracted: {
    name: string;
    date: string;
    amount: string;
  };
  rawOutput?: string;
  error?: string;
  isDemo?: boolean;
}

interface LeaderboardEntry {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  version: number;
  submitter: string;
  promptHash: string;
  parentHash: string | null;
  timestamp: number;
  results: TestResult[];
  promptText?: string;
  storageRoot?: string;
  txHash?: string;
  txExplorerUrl?: string;
  isLocalStorage?: boolean;
  hasDemoResults?: boolean;
  chainAnchorPending?: boolean;
  chainAnchorError?: string;
}

interface DebugLog {
  timestamp: number;
  step: string;
  status: 'success' | 'error' | 'info' | 'warning';
  message: string;
  data?: unknown;
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export default function App() {
  const { address: connectedAddress, isConnected, chain } = useAccount();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'submit'>('leaderboard');
  const [promptTitle, setPromptTitle] = useState('');
  const [promptText, setPromptText] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalProgress, setEvalProgress] = useState(0);
  const [evalStatus, setEvalStatus] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState<LeaderboardEntry | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [useDemoMode, setUseDemoMode] = useState(false);
  const [contractLive, setContractLive] = useState<boolean | null>(null);
  const mainContentRef = useRef<HTMLElement>(null);

  const goToTab = useCallback((tab: 'leaderboard' | 'submit') => {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const addLog = useCallback((step: string, status: DebugLog['status'], message: string, data?: unknown) => {
    const log: DebugLog = {
      timestamp: Date.now(),
      step,
      status,
      message,
      data
    };
    setDebugLogs(prev => [...prev, log]);
    console.log(`[PromptLedger:${step}] ${status.toUpperCase()}: ${message}`, data || '');
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('promptledger_leaderboard');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setLeaderboard(parsed);
        addLog('init', 'info', `Loaded ${parsed.length} entries from localStorage`);
      } catch {
        console.error('Failed to parse stored leaderboard');
        addLog('init', 'error', 'Failed to parse stored leaderboard');
      }
    }
  }, [addLog]);

  useEffect(() => {
    if (!publicClient) return;
    verifyContractDeployed(publicClient).then((live) => {
      setContractLive(live);
      const addr = getContractAddress();
      addLog(
        'chain',
        live ? 'success' : 'error',
        live
          ? `PromptLedger contract live on 0G Testnet: ${addr.slice(0, 10)}...`
          : `No contract bytecode at ${addr} — check VITE_PROMPT_LEDGER_ADDRESS`
      );
    });
  }, [publicClient, addLog]);

  useEffect(() => {
    localStorage.setItem('promptledger_leaderboard', JSON.stringify(leaderboard));
  }, [leaderboard]);

  const findExistingPrompt = useCallback((title: string): LeaderboardEntry | undefined => {
    return leaderboard.find(
      entry => entry.title.toLowerCase().trim() === title.toLowerCase().trim()
    );
  }, [leaderboard]);

  const handleSubmitPrompt = useCallback(() => {
    console.log('[handleSubmitPrompt] Called');
    console.log('[handleSubmitPrompt] promptTitle:', promptTitle);
    console.log('[handleSubmitPrompt] promptText length:', promptText.length);
    console.log('[handleSubmitPrompt] isConnected:', isConnected);
    
    if (!promptTitle.trim()) {
      console.log('[handleSubmitPrompt] ERROR: No title');
      setError('Please enter a prompt title');
      return;
    }
    if (!promptText.trim()) {
      console.log('[handleSubmitPrompt] ERROR: No prompt text');
      setError('Please enter a prompt');
      return;
    }
    
    setError(null);
    clearLastError();
    console.log('[handleSubmitPrompt] Opening payment modal');
    setShowPaymentConfirm(true);
  }, [promptTitle, promptText, isConnected]);

  const handleConfirmPayment = useCallback(async () => {
    console.log('[handleConfirmPayment] Called');
    console.log('[handleConfirmPayment] isConnected:', isConnected);
    console.log('[handleConfirmPayment] connectedAddress:', connectedAddress);
    
    if (!isConnected || !connectedAddress) {
      setError('Please connect your wallet first');
      addLog('payment', 'error', 'Wallet not connected');
      return;
    }

    setShowPaymentConfirm(false);
    setIsEvaluating(true);
    setEvalProgress(0);
    setError(null);
    setDebugLogs([]);
    addLog('start', 'info', `Starting evaluation for: "${promptTitle}"`);
    
    if (useDemoMode) {
      addLog('mode', 'warning', 'Demo mode enabled - results will be pattern-based, not from real model');
    }

    if (chain?.id !== OG_TESTNET_CHAIN_ID) {
      addLog('chain', 'info', 'Switching wallet to 0G Testnet...');
      try {
        await switchChainAsync({ chainId: OG_TESTNET_CHAIN_ID });
        addLog('chain', 'success', 'Wallet on 0G Testnet');
      } catch (switchErr) {
        const msg = switchErr instanceof Error ? switchErr.message : 'Network switch failed';
        addLog('chain', 'error', msg);
        setError(`Please switch MetaMask to 0G Testnet (chain ${OG_TESTNET_CHAIN_ID}): ${msg}`);
        setIsEvaluating(false);
        return;
      }
    }

    const chainAvailable = isChainAnchoringAvailable();
    addLog(
      'chain',
      chainAvailable ? 'success' : 'warning',
      chainAvailable
        ? `Contract ready: ${getContractAddress()}`
        : 'Contract address not configured'
    );

    try {
      setEvalStatus('Computing prompt hash...');
      addLog('hash', 'info', 'Computing SHA-256 hash...');
      const promptHash = await computePromptHash(promptTitle, promptText);
      addLog('hash', 'success', `Hash: ${promptHash}`);
      
      const existingPrompt = findExistingPrompt(promptTitle);
      const parentHash = existingPrompt ? existingPrompt.promptHash : null;
      const version = existingPrompt ? existingPrompt.version + 1 : 1;
      
      if (existingPrompt) {
        addLog('version', 'info', `Revision detected - v${version}, parent: ${parentHash?.slice(0, 10)}...`);
      }

      const results: TestResult[] = [];
      const modelOutputs: Array<{
        caseId: number;
        rawOutput: string;
        extracted: { name: string; date: string; amount: string };
      }> = [];
      
      let hasAnyDemoResults = false;
      let hasAnyFailures = false;

      for (let i = 0; i < FIXED_TEST_CASES.length; i++) {
        const testCase = FIXED_TEST_CASES[i];
        setEvalStatus(`Evaluating test case ${i + 1}/5 (${testCase.type})...`);
        setEvalProgress((i + 1) * 10);
        addLog('eval', 'info', `Test case ${i + 1}: ${testCase.type}`);

        addLog('compute', 'info', `Calling 0G Compute for case ${i + 1}...`);
        const computeResult: ComputeResult = await runPromptEvaluation(
          promptText, 
          testCase.input,
          useDemoMode
        );

        if (!computeResult.success) {
          addLog('compute', 'error', `Failed: ${computeResult.error}`);
          hasAnyFailures = true;
          
          results.push({
            caseId: testCase.id,
            type: testCase.type,
            namePass: false,
            datePass: false,
            amountPass: false,
            extracted: { name: '', date: '', amount: '' },
            error: computeResult.error || 'Compute failed',
          });
          modelOutputs.push({
            caseId: testCase.id,
            rawOutput: `ERROR: ${computeResult.error}`,
            extracted: { name: '', date: '', amount: '' },
          });
          continue;
        }

        if (computeResult.isDemo) {
          addLog('compute', 'warning', 'Using demo/pattern-based result (not real model)');
          hasAnyDemoResults = true;
        } else {
          addLog('compute', 'success', `Output: ${computeResult.output?.slice(0, 60)}...`);
        }

        const extracted = parseExtractionOutput(computeResult.output!);
        addLog('parse', 'info', `Extracted:`, extracted);

        modelOutputs.push({
          caseId: testCase.id,
          rawOutput: computeResult.output!,
          extracted,
        });

        const namePass = compareExtracted(extracted.name, testCase.expected.name);
        const datePass = compareExtracted(extracted.date, testCase.expected.date);
        const amountPass = compareExtracted(extracted.amount, testCase.expected.amount);
        
        const passCount = [namePass, datePass, amountPass].filter(Boolean).length;
        addLog('compare', passCount === 3 ? 'success' : 'info', 
          `Results: name=${namePass}, date=${datePass}, amount=${amountPass} (${passCount}/3)`);

        results.push({
          caseId: testCase.id,
          type: testCase.type,
          namePass,
          datePass,
          amountPass,
          extracted,
          rawOutput: computeResult.output,
          isDemo: computeResult.isDemo,
        });
      }

      if (hasAnyFailures && !useDemoMode) {
        const failedCount = results.filter(r => r.error).length;
        setError(`Evaluation failed for ${failedCount}/5 test cases. Check debug log for details. Enable demo mode to use pattern-based extraction.`);
        setIsEvaluating(false);
        return;
      }

      const score = results.reduce((acc, r) => {
        return acc + (r.namePass ? 1 : 0) + (r.datePass ? 1 : 0) + (r.amountPass ? 1 : 0);
      }, 0);
      addLog('score', 'success', `Final score: ${score}/15`);

      setEvalProgress(60);
      setEvalStatus('Uploading to 0G Storage — approve in MetaMask...');

      addLog('storage', 'info', 'Uploading to 0G Storage (approve storage fee in wallet)...');
      const storageData: StorageData = {
        promptTitle,
        promptText,
        promptHash,
        parentHash,
        version,
        submitter: connectedAddress,
        timestamp: Date.now(),
        testCases: FIXED_TEST_CASES.map(tc => ({
          id: tc.id,
          type: tc.type,
          input: tc.input,
          expected: tc.expected,
        })),
        modelOutputs,
        results,
        score,
        maxScore: 15,
      };

      const storageResult: StorageResult = await uploadToStorage(storageData);
      
      if (!storageResult.success) {
        addLog('storage', 'error', `Upload failed: ${storageResult.error}`);
        setError(`Storage upload failed: ${storageResult.error}`);
        setIsEvaluating(false);
        return;
      }
      
      if (storageResult.isLocalFallback) {
        addLog('storage', 'warning', 'Using local storage (not on 0G network)');
      } else {
        addLog(
          'storage',
          'success',
          `On 0G Storage: ${storageResult.rootHash?.slice(0, 20)}...`,
          storageResult.storageTxHash ? { storageTx: storageResult.storageTxHash } : undefined
        );
      }

      setEvalProgress(80);
      setEvalStatus('Anchoring to 0G Chain...');

      addLog('chain', 'info', 'Attempting on-chain anchor...');

      let txHash: string | null = null;
      let txExplorerUrl: string | null = null;
      let chainAnchorPending = false;
      let chainAnchorError: string | undefined;

      const anchorResult: AnchorResult = await anchorToChain({
        promptHash,
        parentHash,
        storageRoot: storageResult.rootHash!,
        score,
      });

      if (anchorResult.success && anchorResult.txHash) {
        txHash = anchorResult.txHash;
        txExplorerUrl = getExplorerTxUrl(txHash);
        addLog('chain', 'success', `Transaction sent: ${txHash}`);
      } else if (anchorResult.isPending) {
        chainAnchorPending = true;
        addLog('chain', 'warning', anchorResult.error || 'On-chain anchor pending');
      } else {
        chainAnchorError = anchorResult.error || 'Anchor transaction failed';
        addLog('chain', 'error', chainAnchorError);
      }

      setEvalProgress(100);
      setEvalStatus('Complete!');
      addLog('complete', 'success', 'Evaluation complete!');

      const newEntry: LeaderboardEntry = {
        id: promptHash.slice(0, 10),
        title: promptTitle,
        score,
        maxScore: 15,
        version,
        submitter: connectedAddress,
        promptHash,
        parentHash,
        timestamp: Date.now(),
        results,
        promptText,
        storageRoot: storageResult.rootHash || undefined,
        txHash: txHash || undefined,
        txExplorerUrl: txExplorerUrl || undefined,
        isLocalStorage: storageResult.isLocalFallback,
        hasDemoResults: hasAnyDemoResults,
        chainAnchorPending,
        chainAnchorError,
      };

      setLeaderboard(prev => {
        const filtered = existingPrompt 
          ? prev.filter(e => e.id !== existingPrompt.id)
          : prev;
        return [newEntry, ...filtered].sort((a, b) => b.score - a.score);
      });

      setIsEvaluating(false);
      setPromptTitle('');
      setPromptText('');
      goToTab('leaderboard');

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Evaluation failed';
      addLog('fatal', 'error', errorMsg);
      setError(errorMsg);
      setIsEvaluating(false);
    }
  }, [promptTitle, promptText, connectedAddress, isConnected, chain, switchChainAsync, findExistingPrompt, addLog, useDemoMode, goToTab]);

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const isFormValid = promptTitle.trim() && promptText.trim();

  return (
    <div className="min-h-screen dot-grid-bg">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[var(--bg)]/80 border-b border-[var(--border)]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
              <Hash className="w-4 h-4 text-white" />
            </div>
            <span className="font-syne font-bold text-lg">PromptLedger</span>
          </div>
          <div className="flex items-center gap-4">
            {contractLive && (
              <a
                href={getExplorerContractUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)] font-space text-xs hover:bg-[var(--success)]/20 transition-colors"
                title={getContractAddress()}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] animate-pulse" />
                Contract Live
              </a>
            )}
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              title="Toggle Debug Panel"
            >
              <Bug className={`w-4 h-4 ${showDebug ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`} />
            </button>
            <WalletButton />
          </div>
        </div>
      </nav>

      {/* Debug Panel */}
      {showDebug && (
        <div className="fixed top-16 right-0 w-96 max-h-[80vh] overflow-y-auto z-40 glass border-l border-b border-[var(--border)] p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-syne font-bold text-sm">Debug Log</h3>
            <button onClick={() => setDebugLogs([])} className="text-xs text-[var(--muted)] hover:text-[var(--text)]">
              Clear
            </button>
          </div>
          <div className="space-y-2 font-fragment text-xs">
            {debugLogs.length === 0 ? (
              <p className="text-[var(--muted)]">No logs yet. Submit a prompt to see debug output.</p>
            ) : (
              debugLogs.map((log, i) => (
                <div key={i} className={`p-2 rounded ${
                  log.status === 'error' ? 'bg-[var(--fail)]/10' :
                  log.status === 'success' ? 'bg-[var(--success)]/10' :
                  log.status === 'warning' ? 'bg-[var(--warning)]/10' :
                  'bg-white/5'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[var(--muted)]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className={`font-space ${
                      log.status === 'error' ? 'text-[var(--fail)]' :
                      log.status === 'success' ? 'text-[var(--success)]' :
                      log.status === 'warning' ? 'text-[var(--warning)]' :
                      'text-[var(--accent)]'
                    }`}>[{log.step}]</span>
                  </div>
                  <p className="text-[var(--text)]">{log.message}</p>
                  {log.data && (
                    <pre className="mt-1 text-[var(--muted)] whitespace-pre-wrap overflow-x-auto">
                      {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="pt-16">
        {selectedPrompt ? (
          <div className="min-h-screen">
            <div className="max-w-5xl mx-auto px-6 py-8">
              <button
                onClick={() => setSelectedPrompt(null)}
                className="flex items-center gap-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors mb-8"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="font-space text-sm">Back to Leaderboard</span>
              </button>

              <div className="animate-fade-in-up">
                {/* Warnings Banner */}
                {(selectedPrompt.hasDemoResults || selectedPrompt.isLocalStorage || selectedPrompt.chainAnchorPending || selectedPrompt.chainAnchorError) && (
                  <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-xl p-4 mb-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[var(--warning)] mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-space text-sm font-medium text-[var(--warning)]">Verification Status</div>
                        <ul className="font-fragment text-sm text-[var(--muted)] mt-2 space-y-1">
                          {selectedPrompt.chainAnchorPending && (
                            <li className="flex items-center gap-2">
                              <Clock className="w-3 h-3" />
                              On-chain anchor pending — wallet or contract not ready
                            </li>
                          )}
                          {selectedPrompt.chainAnchorError && (
                            <li className="flex items-center gap-2">
                              <AlertCircle className="w-3 h-3" />
                              Anchor failed: {selectedPrompt.chainAnchorError}
                            </li>
                          )}
                          {selectedPrompt.isLocalStorage && (
                            <li className="flex items-center gap-2">
                              <AlertCircle className="w-3 h-3" />
                              Data stored locally (not on 0G Storage network)
                            </li>
                          )}
                          {selectedPrompt.hasDemoResults && (
                            <li className="flex items-center gap-2">
                              <AlertCircle className="w-3 h-3" />
                              Some results used pattern-based extraction (not verified by 0G Compute)
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Header */}
                <div className="glass rounded-2xl p-8 mb-6">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h1 className="font-syne font-bold text-3xl mb-2">{selectedPrompt.title}</h1>
                      <div className="flex items-center gap-4 text-sm text-[var(--muted)]">
                        <span className="font-space">v{selectedPrompt.version}</span>
                        <span>•</span>
                        <span className="font-fragment">{formatDate(selectedPrompt.timestamp)}</span>
                        <span>•</span>
                        <span className="font-fragment">{truncateAddress(selectedPrompt.submitter)}</span>
                      </div>
                    </div>
                    <div className="score-badge rounded-xl px-6 py-3 text-center">
                      <div className="font-syne font-bold text-3xl text-white">{selectedPrompt.score}</div>
                      <div className="font-space text-xs text-white/70 uppercase">/ {selectedPrompt.maxScore}</div>
                    </div>
                  </div>

                  {/* Hashes */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="font-space text-xs text-[var(--muted)] uppercase w-24">Prompt Hash</span>
                      <div className="flex items-center gap-2 flex-1">
                        <code className="hash-text text-sm text-[var(--accent)]">{selectedPrompt.promptHash}</code>
                        <button
                          onClick={() => handleCopyHash(selectedPrompt.promptHash)}
                          className="p-1 hover:bg-white/5 rounded transition-colors"
                        >
                          {copiedHash === selectedPrompt.promptHash ? (
                            <Check className="w-3 h-3 text-[var(--success)]" />
                          ) : (
                            <Copy className="w-3 h-3 text-[var(--muted)]" />
                          )}
                        </button>
                      </div>
                    </div>
                    {selectedPrompt.parentHash && (
                      <div className="flex items-center gap-3">
                        <span className="font-space text-xs text-[var(--muted)] uppercase w-24">Parent Hash</span>
                        <div className="flex items-center gap-2 flex-1">
                          <code className="hash-text text-sm text-[var(--muted)]">{selectedPrompt.parentHash}</code>
                          <Link2 className="w-3 h-3 text-[var(--muted)]" />
                        </div>
                      </div>
                    )}
                    {selectedPrompt.storageRoot && (
                      <div className="flex items-center gap-3">
                        <span className="font-space text-xs text-[var(--muted)] uppercase w-24">
                          {selectedPrompt.isLocalStorage ? 'Local Ref' : 'Storage Root'}
                        </span>
                        <div className="flex items-center gap-2 flex-1">
                          <code className="hash-text text-sm text-[var(--muted)]">{truncateHash(selectedPrompt.storageRoot)}</code>
                          {selectedPrompt.isLocalStorage && (
                            <span className="px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] text-xs font-space">local</span>
                          )}
                        </div>
                      </div>
                    )}
                    {/* On-Chain Status */}
                    <div className="flex items-center gap-3">
                      <span className="font-space text-xs text-[var(--muted)] uppercase w-24">On-Chain</span>
                      <div className="flex items-center gap-2 flex-1">
                        {selectedPrompt.txHash ? (
                          <a 
                            href={selectedPrompt.txExplorerUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[var(--accent)] hover:underline"
                          >
                            <code className="hash-text text-sm">{truncateHash(selectedPrompt.txHash)}</code>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : selectedPrompt.chainAnchorError ? (
                          <span className="text-xs text-[var(--fail)] font-fragment">{selectedPrompt.chainAnchorError}</span>
                        ) : selectedPrompt.chainAnchorPending ? (
                          <span className="px-2 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] font-space text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Pending
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--muted)]">Not anchored</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prompt Text */}
                {selectedPrompt.promptText && (
                  <div className="glass rounded-2xl p-8 mb-6">
                    <h2 className="font-syne font-bold text-xl mb-4">Prompt Text</h2>
                    <div className="bg-black/20 rounded-xl p-4 font-fragment text-sm text-[var(--muted)] whitespace-pre-wrap">
                      {selectedPrompt.promptText}
                    </div>
                  </div>
                )}

                {/* Test Results */}
                <div className="glass rounded-2xl p-8">
                  <h2 className="font-syne font-bold text-xl mb-6">Test Case Results</h2>
                  <div className="space-y-4">
                    {selectedPrompt.results.map((result, idx) => (
                      <div
                        key={result.caseId}
                        className={`bg-white/[0.02] rounded-xl p-4 border ${
                          result.isDemo ? 'border-[var(--warning)]/30' : 'border-[var(--border)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="font-space text-xs text-[var(--muted)]">Case {result.caseId}</span>
                            <span className="px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-space text-xs">
                              {result.type}
                            </span>
                            {result.isDemo && (
                              <span className="px-2 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] font-space text-xs">
                                demo
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                              {result.namePass ? (
                                <CheckCircle className="w-4 h-4 pass-indicator" />
                              ) : (
                                <XCircle className="w-4 h-4 fail-indicator" />
                              )}
                              <span className="font-space text-xs">Name</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {result.datePass ? (
                                <CheckCircle className="w-4 h-4 pass-indicator" />
                              ) : (
                                <XCircle className="w-4 h-4 fail-indicator" />
                              )}
                              <span className="font-space text-xs">Date</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {result.amountPass ? (
                                <CheckCircle className="w-4 h-4 pass-indicator" />
                              ) : (
                                <XCircle className="w-4 h-4 fail-indicator" />
                              )}
                              <span className="font-space text-xs">Amount</span>
                            </div>
                          </div>
                        </div>
                        <div className="font-fragment text-sm text-[var(--muted)] bg-black/20 rounded-lg p-3">
                          {JSON.stringify(result.extracted, null, 2)}
                        </div>
                        {result.error && (
                          <div className="mt-2 text-xs text-[var(--fail)] font-fragment">
                            Error: {result.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Hero Section */}
            <section className="max-w-7xl mx-auto px-6 py-20">
              <div className="grid lg:grid-cols-2 gap-12 items-center">
                <div className="animate-fade-in-up">
                  <h1 className="font-syne font-extrabold text-5xl lg:text-6xl leading-tight mb-6">
                    Verify Your<br />
                    <span className="text-[var(--accent)]">Prompt Scores</span><br />
                    On-Chain
                  </h1>
                  <p className="font-fragment text-lg text-[var(--muted)] mb-8 max-w-lg">
                    Submit prompts. Get scored against fixed benchmarks. 
                    Anchor results to 0G Chain with tamper-proof version history.
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={() => goToTab('submit')}
                      className="btn-primary px-6 py-3 rounded-xl flex items-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      Submit Prompt
                    </button>
                    <button
                      onClick={() => goToTab('leaderboard')}
                      className="btn-ghost px-6 py-3 rounded-xl flex items-center gap-2"
                    >
                      <Trophy className="w-4 h-4" />
                      View Leaderboard
                    </button>
                  </div>
                </div>

                {/* Live Proof Concept */}
                <div className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  <div className="glass rounded-2xl p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
                      <span className="font-space text-xs text-[var(--muted)] uppercase">Live Proof Chain</span>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center">
                          <Hash className="w-5 h-5 text-[var(--accent)]" />
                        </div>
                        <div className="flex-1">
                          <div className="font-space text-xs text-[var(--muted)] mb-1">Prompt Hash</div>
                          <code className="hash-text text-sm text-[var(--accent)]">
                            {leaderboard.length > 0 ? truncateHash(leaderboard[0].promptHash) : '0x0000...0000'}
                          </code>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center">
                          <Trophy className="w-5 h-5 text-[var(--accent)]" />
                        </div>
                        <div className="flex-1">
                          <div className="font-space text-xs text-[var(--muted)] mb-1">Verified Score</div>
                          <div className="font-syne font-bold text-2xl">
                            {leaderboard.length > 0 ? leaderboard[0].score : '--'}
                            <span className="text-[var(--muted)] text-lg">/15</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center">
                          <Link2 className="w-5 h-5 text-[var(--accent)]" />
                        </div>
                        <div className="flex-1">
                          <div className="font-space text-xs text-[var(--muted)] mb-1">Version Lineage</div>
                          <div className="flex items-center gap-2">
                            {leaderboard.length > 0 && leaderboard[0].parentHash ? (
                              <>
                                <span className="px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-space text-xs">v{leaderboard[0].version - 1}</span>
                                <ChevronRight className="w-3 h-3 text-[var(--muted)]" />
                                <span className="px-2 py-0.5 rounded bg-[var(--accent)] text-white font-space text-xs">v{leaderboard[0].version}</span>
                              </>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-[var(--accent)] text-white font-space text-xs">v1</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Error Display */}
            {error && (
              <div className="max-w-7xl mx-auto px-6 mb-6">
                <div className="bg-[var(--fail)]/10 border border-[var(--fail)]/30 rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[var(--fail)] mt-0.5" />
                  <div className="flex-1">
                    <div className="font-space text-sm font-medium text-[var(--fail)]">Error</div>
                    <div className="font-fragment text-sm text-[var(--muted)]">{error}</div>
                  </div>
                  <button onClick={() => setError(null)} className="p-1 hover:bg-white/5 rounded">
                    <X className="w-4 h-4 text-[var(--muted)]" />
                  </button>
                </div>
              </div>
            )}

            {/* Tab Navigation */}
            <section ref={mainContentRef} id="main-content" className="max-w-7xl mx-auto px-6 scroll-mt-20">
              <div className="flex gap-2 mb-8">
                <button
                  onClick={() => goToTab('leaderboard')}
                  className={`px-4 py-2 rounded-lg font-space text-sm transition-all ${
                    activeTab === 'leaderboard'
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
                  }`}
                >
                  Leaderboard
                </button>
                <button
                  onClick={() => goToTab('submit')}
                  className={`px-4 py-2 rounded-lg font-space text-sm transition-all ${
                    activeTab === 'submit'
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/5'
                  }`}
                >
                  Submit Prompt
                </button>
              </div>

              {activeTab === 'leaderboard' && (
                <div className="animate-fade-in-up">
                  {leaderboard.length === 0 ? (
                    <div className="glass rounded-2xl p-12 text-center">
                      <Trophy className="w-12 h-12 text-[var(--muted)] mx-auto mb-4" />
                      <h3 className="font-syne font-bold text-xl mb-2">No Submissions Yet</h3>
                      <p className="font-fragment text-[var(--muted)] mb-6">
                        Be the first to submit a prompt and get it verified on-chain.
                      </p>
                      <button
                        onClick={() => goToTab('submit')}
                        className="btn-primary px-6 py-3 rounded-xl"
                      >
                        Submit Your First Prompt
                      </button>
                    </div>
                  ) : (
                    <div className="glass rounded-2xl overflow-hidden">
                      <div className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-[var(--border)] text-[var(--muted)]">
                        <div className="col-span-1 font-space text-xs uppercase">#</div>
                        <div className="col-span-3 font-space text-xs uppercase">Title</div>
                        <div className="col-span-2 font-space text-xs uppercase">Score</div>
                        <div className="col-span-2 font-space text-xs uppercase">Version</div>
                        <div className="col-span-2 font-space text-xs uppercase">Submitter</div>
                        <div className="col-span-2 font-space text-xs uppercase">On-Chain</div>
                      </div>
                      {leaderboard.map((entry, idx) => (
                        <div
                          key={entry.id}
                          className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-[var(--border)]/50 hover:bg-white/[0.02] transition-colors cursor-pointer"
                          onClick={() => setSelectedPrompt(entry)}
                        >
                          <div className="col-span-1 font-syne font-bold text-[var(--muted)]">{idx + 1}</div>
                          <div className="col-span-3 flex items-center gap-2">
                            <span className="font-syne font-semibold">{entry.title}</span>
                            {entry.hasDemoResults && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] text-xs font-space">demo</span>
                            )}
                          </div>
                          <div className="col-span-2">
                            <span className="font-syne font-bold text-[var(--accent)]">{entry.score}</span>
                            <span className="text-[var(--muted)]">/{entry.maxScore}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] font-space text-xs">
                              v{entry.version}
                            </span>
                          </div>
                          <div className="col-span-2 font-fragment text-sm text-[var(--muted)]">
                            {truncateAddress(entry.submitter)}
                          </div>
                          <div className="col-span-2">
                            {entry.txHash ? (
                              <span className="text-[var(--success)] text-xs font-space flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />
                                Confirmed
                              </span>
                            ) : entry.chainAnchorError ? (
                              <span className="text-[var(--fail)] text-xs font-space">Failed</span>
                            ) : entry.chainAnchorPending ? (
                              <span className="px-2 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] font-space text-xs flex items-center gap-1 w-fit">
                                <Clock className="w-3 h-3" />
                                Pending
                              </span>
                            ) : (
                              <span className="text-[var(--muted)] text-xs">—</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'submit' && (
                <div className="animate-fade-in-up">
                  <div className="glass rounded-2xl p-8 max-w-3xl">
                    <h2 className="font-syne font-bold text-2xl mb-2">Submit Your Prompt</h2>
                    <p className="font-fragment text-[var(--muted)] mb-8">
                      Your prompt will be evaluated against 5 fixed test cases for structured data extraction.
                    </p>

                    <div className="space-y-6">
                      <div>
                        <label className="block font-space text-sm mb-2">Prompt Title</label>
                        <input
                          type="text"
                          value={promptTitle}
                          onChange={(e) => setPromptTitle(e.target.value)}
                          placeholder="e.g., Invoice Extractor v1"
                          className="w-full bg-black/20 border border-[var(--border)] rounded-xl px-4 py-3 font-fragment text-sm focus:outline-none focus:border-[var(--accent)] transition-colors"
                        />
                        {promptTitle && findExistingPrompt(promptTitle) && (
                          <p className="mt-2 font-fragment text-xs text-[var(--accent)]">
                            Note: A prompt with this title exists. Submitting will create version {findExistingPrompt(promptTitle)!.version + 1}.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block font-space text-sm mb-2">System Prompt</label>
                        <textarea
                          value={promptText}
                          onChange={(e) => setPromptText(e.target.value)}
                          placeholder="Enter your system prompt for extracting name, date, and amount from messy text..."
                          rows={8}
                          className="w-full bg-black/20 border border-[var(--border)] rounded-xl px-4 py-3 font-fragment text-sm focus:outline-none focus:border-[var(--accent)] transition-colors resize-none"
                        />
                      </div>

                      <div className="bg-[var(--accent)]/5 border border-[var(--accent)]/20 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-[var(--accent)] mt-0.5" />
                          <div>
                            <div className="font-space text-sm font-medium mb-1">Task: Structured Data Extraction</div>
                            <div className="font-fragment text-sm text-[var(--muted)]">
                              Extract <code className="text-[var(--accent)]">name</code>, <code className="text-[var(--accent)]">date</code>, and <code className="text-[var(--accent)]">amount</code> from messy text into clean JSON.
                              Your prompt will be tested against 5 fixed test cases.
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Demo Mode Toggle */}
                      <div className="bg-[var(--warning)]/5 border border-[var(--warning)]/20 rounded-xl p-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={useDemoMode}
                            onChange={(e) => setUseDemoMode(e.target.checked)}
                            className="mt-1 w-4 h-4 rounded border-[var(--border)] bg-black/20 text-[var(--accent)] focus:ring-[var(--accent)]"
                          />
                          <div>
                            <div className="font-space text-sm font-medium">Demo Mode</div>
                            <div className="font-fragment text-xs text-[var(--muted)] mt-1">
                              Enable if 0G Compute is unavailable. Uses pattern-based extraction instead of real model inference.
                              Results will be marked as "demo" and not cryptographically verified.
                            </div>
                          </div>
                        </label>
                      </div>

                      {/* Wallet Status */}
                      {!isConnected && (
                        <div className="bg-[var(--fail)]/10 border border-[var(--fail)]/30 rounded-xl p-4">
                          <div className="flex items-center gap-2 text-[var(--fail)]">
                            <AlertCircle className="w-4 h-4" />
                            <span className="font-space text-sm">Wallet not connected - click "Connect Wallet" in the top right</span>
                          </div>
                        </div>
                      )}

                      <button
                        onClick={handleSubmitPrompt}
                        disabled={!isFormValid}
                        className={`btn-primary w-full py-4 rounded-xl ${!isFormValid ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isFormValid ? 'Continue to Confirm' : 'Fill in both fields to continue'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] mt-20">
        <div className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[var(--accent)] flex items-center justify-center">
              <Hash className="w-3 h-3 text-white" />
            </div>
            <span className="font-syne font-semibold text-sm">PromptLedger</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[var(--muted)]">
            <a href="#" className="hover:text-[var(--text)] transition-colors font-space">X</a>
            <a href="#" className="hover:text-[var(--text)] transition-colors font-space">GitHub</a>
            <a href={getExplorerContractUrl()} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text)] transition-colors font-space">Contract</a>
            <span className="font-fragment">© 2024</span>
          </div>
        </div>
      </footer>

      {/* Payment Confirmation Modal */}
      {showPaymentConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPaymentConfirm(false)} />
          <div className="relative glass rounded-2xl p-8 max-w-md w-full animate-fade-in-up">
            <button
              onClick={() => setShowPaymentConfirm(false)}
              className="absolute top-4 right-4 p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center">
                <Hash className="w-6 h-6 text-[var(--accent)]" />
              </div>
              <div>
                <h3 className="font-syne font-bold text-xl">Confirm Submission</h3>
                <p className="font-fragment text-sm text-[var(--muted)]">Review before running evaluation</p>
              </div>
            </div>
            
            {useDemoMode && (
              <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-xl p-3 mb-4">
                <div className="flex items-center gap-2 text-[var(--warning)]">
                  <Info className="w-4 h-4" />
                  <span className="font-space text-sm">Demo mode enabled - no real model inference</span>
                </div>
              </div>
            )}
            
            <div className="bg-black/20 rounded-xl p-4 mb-4">
              <div className="flex justify-between mb-2">
                <span className="font-space text-sm text-[var(--muted)]">Test Cases</span>
                <span className="font-fragment text-sm">5 fixed benchmarks</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="font-space text-sm text-[var(--muted)]">Scoring</span>
                <span className="font-fragment text-sm">3 fields × 5 cases = 15 max</span>
              </div>
              <div className="border-t border-[var(--border)] my-2" />
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-space text-sm font-medium">Estimated Network Fee</span>
                  <div className="font-fragment text-xs text-[var(--muted)] mt-0.5">
                    Gas for on-chain anchor tx — paid from your wallet when you sign
                  </div>
                </div>
                <span className="font-fragment text-sm text-[var(--muted)]">actual gas cost</span>
              </div>
            </div>

            <div className="bg-[var(--accent)]/5 border border-[var(--accent)]/20 rounded-xl p-3 mb-6">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-[var(--accent)] mt-0.5 flex-shrink-0" />
                <p className="font-fragment text-xs text-[var(--muted)]">
                  The only on-chain charge is the gas fee for the anchor transaction your wallet signs. 
                  No other fees are collected by this app.
                </p>
              </div>
            </div>

            {!isConnected && (
              <div className="bg-[var(--fail)]/10 border border-[var(--fail)]/30 rounded-xl p-4 mb-4">
                <p className="font-fragment text-sm text-[var(--fail)]">
                  Please connect your wallet first to proceed.
                </p>
              </div>
            )}
            <button 
              onClick={handleConfirmPayment} 
              disabled={!isConnected}
              className="btn-primary w-full py-4 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnected ? 'Run Evaluation' : 'Connect Wallet First'}
            </button>
          </div>
        </div>
      )}

      {/* Evaluation Progress Modal */}
      {isEvaluating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative glass rounded-2xl p-8 max-w-md w-full animate-fade-in-up">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/20 flex items-center justify-center mx-auto mb-4">
                <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
              </div>
              <h3 className="font-syne font-bold text-xl mb-2">Running Evaluation</h3>
              <p className="font-fragment text-sm text-[var(--muted)]">
                {evalStatus || 'Testing your prompt against 5 fixed test cases...'}
              </p>
            </div>
            <div className="bg-black/20 rounded-full h-2 overflow-hidden mb-4">
              <div
                className="h-full bg-[var(--accent)] transition-all duration-500"
                style={{ width: `${evalProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-space text-[var(--muted)]">Progress</span>
              <span className="font-fragment text-[var(--accent)]">{evalProgress}%</span>
            </div>
            <div className="mt-4 space-y-2">
              {FIXED_TEST_CASES.map((tc, i) => (
                <div key={tc.id} className="flex items-center gap-2 text-sm">
                  {evalProgress > (i + 1) * 10 ? (
                    <Check className="w-4 h-4 text-[var(--success)]" />
                  ) : evalProgress >= (i + 1) * 10 - 5 ? (
                    <Loader2 className="w-4 h-4 text-[var(--accent)] animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-[var(--border)]" />
                  )}
                  <span className="font-space text-[var(--muted)]">Test Case {tc.id} ({tc.type})</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
