import { http, createConfig } from 'wagmi';
import { injected } from 'wagmi/connectors';

const ogTestnet = {
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

export const config = createConfig({
  chains: [ogTestnet],
  connectors: [injected()],
  transports: {
    [ogTestnet.id]: http('https://evmrpc-testnet.0g.ai'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
