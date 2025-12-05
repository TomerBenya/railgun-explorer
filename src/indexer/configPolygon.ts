import { type Abi } from 'viem';

// Environment configuration for Polygon
export const RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-mainnet.infura.io/v3/4354acaa8fa44b48b106f9596411a10e';

// Start block - Indexing from contract creation
// SmartWallet deployed at 23,580,067, Relay at 28,062,088
// Using SmartWallet creation block to catch all events from both contracts
// Can be overridden via POLYGON_START_BLOCK env var
export const START_BLOCK = process.env.POLYGON_START_BLOCK
  ? BigInt(process.env.POLYGON_START_BLOCK)
  : 23_580_067n; // SmartWallet contract creation block

// Indexer settings
export const CONFIRMATION_BLOCKS = 12n;
// Reduced batch size for Polygon to avoid rate limits on public RPCs
// Can be increased if using a premium RPC provider
export const BATCH_SIZE = BigInt(process.env.BATCH_SIZE || '500');

// Railgun contract addresses on Polygon mainnet
export const CONTRACTS = {
  // RailgunSmartWallet - handles Shield/Transact/Unshield events
  smartWallet: '0x19b620929f97b7b990801496c3b361ca5def8c71' as `0x${string}`,
  // Relay proxy - handles relayed transactions
  relay: '0x4cd00e387622c35bddb9b4c962c136462338bc31' as `0x${string}`,
} as const;

// Relay contract on Polygon uses simplified event structure
// Unshield(address to, address token, uint256 amount, uint256 fee)
// Shield events also exist but with signature 0x4be10945...
// Note: Polygon uses address instead of tuple for token parameter
export const RELAY_ABI: Abi = [
  {
    type: 'event',
    name: 'Unshield',
    inputs: [
      { name: 'to', type: 'address', indexed: false },
      { name: 'token', type: 'address', indexed: false }, // Simplified: just address, not tuple
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  // Note: Shield event signature 0x4be10945... doesn't match standard ABI
  // We'll handle it manually in the decoder
] as const;

// Known Polygon event signatures
export const POLYGON_EVENT_SIGNATURES = {
  UNSHIELD: '0x49fed1d0b752ce30eee63c7a81133f3363b532fec5d4d7dd1ccfd005de4555e1',
  SHIELD: '0x4be109453ef7e895dc7215c929fff9b76b51483d56a4d04548b4866e9aa7c5ea',
} as const;

// Event type mapping
export type EventType = 'deposit' | 'withdrawal' | 'relayer_payment' | 'other';

