import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi';
import { Wallet, Loader2, Copy, Check } from 'lucide-react';
import { useState } from 'react';

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const account = useAccount();
  const connectResult = useConnect();
  const disconnectResult = useDisconnect();
  
  const { address, isConnected, chain } = account;
  const { connectors, connect, isPending, error } = connectResult;
  const { disconnect } = disconnectResult;
  
  // Only call useBalance when we have an address
  const balanceResult = useBalance({ 
    address: address,
    query: { enabled: !!address }
  });
  
  const { data: balance } = balanceResult;
  
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)]/20 border border-[var(--accent)]/30 hover:bg-[var(--accent)]/30 transition-all"
        >
          <Wallet className="w-4 h-4 text-[var(--accent)]" />
          <span className="font-fragment text-sm text-[var(--accent)]">
            {truncateAddress(address)}
          </span>
        </button>
        
        {showDropdown && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowDropdown(false)}
            />
            <div className="absolute right-0 top-full mt-2 z-50 glass rounded-xl p-4 min-w-[240px] animate-fade-in-up">
              <div className="mb-3 pb-3 border-b border-[var(--border)]">
                <div className="font-space text-xs text-[var(--muted)] uppercase mb-1">Connected</div>
                <div className="flex items-center gap-2">
                  <code className="font-fragment text-sm text-[var(--accent)]">{truncateAddress(address)}</code>
                  <button onClick={handleCopy} className="p-1 hover:bg-white/5 rounded">
                    {copied ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3 text-[var(--muted)]" />}
                  </button>
                </div>
              </div>
              
              {balance && (
                <div className="mb-3 pb-3 border-b border-[var(--border)]">
                  <div className="font-space text-xs text-[var(--muted)] uppercase mb-1">Balance</div>
                  <div className="font-fragment text-sm">
                    {parseFloat(balance.formatted).toFixed(4)} {balance.symbol}
                  </div>
                </div>
              )}
              
              {chain && (
                <div className="mb-3 pb-3 border-b border-[var(--border)]">
                  <div className="font-space text-xs text-[var(--muted)] uppercase mb-1">Network</div>
                  <div className="font-fragment text-sm">{chain.name}</div>
                </div>
              )}
              
              <button
                onClick={() => {
                  disconnect();
                  setShowDropdown(false);
                }}
                className="w-full py-2 rounded-lg bg-[var(--fail)]/10 text-[var(--fail)] font-space text-sm hover:bg-[var(--fail)]/20 transition-colors"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={isPending}
        className="btn-primary px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Wallet className="w-4 h-4" />
        )}
        <span className="font-space text-sm">Connect Wallet</span>
      </button>
      
      {showDropdown && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 glass rounded-xl p-4 min-w-[200px] animate-fade-in-up">
            <div className="font-space text-xs text-[var(--muted)] uppercase mb-3">Select Wallet</div>
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector });
                    setShowDropdown(false);
                  }}
                  disabled={isPending}
                  className="w-full py-3 px-4 rounded-lg bg-white/5 hover:bg-white/10 font-space text-sm text-left transition-colors disabled:opacity-50 flex items-center justify-between"
                >
                  <span>{connector.name}</span>
                  {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                </button>
              ))}
            </div>
            {error && (
              <div className="mt-3 p-2 rounded bg-[var(--fail)]/10 text-[var(--fail)] text-xs font-fragment">
                {error.message || 'Connection failed'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
