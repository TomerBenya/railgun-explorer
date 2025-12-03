import { type Abi } from 'viem';

// Environment configuration
export const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';

// Railgun deployment block (adjust based on actual deployment)
export const START_BLOCK = 15_000_000n; // TODO: Update with actual

// Indexer settings
export const CONFIRMATION_BLOCKS = 12n;
export const BATCH_SIZE = 1000n; // Most public RPCs limit to 1000 blocks per getLogs request

// Contract addresses (PLACEHOLDERS - replace with actual addresses)
export const CONTRACTS = {
  smartWallet: '0x0000000000000000000000000000000000000000' as `0x${string}`,
  relay: '0x0000000000000000000000000000000000000000' as `0x${string}`,
} as const;

// ABI Placeholders - replace with actual Railgun ABIs
// Shield event for deposits
// Unshield event for withdrawals
// Transact event for relayer payments
export const SMART_WALLET_ABI: Abi = [
  {
    type: 'event',
    name: 'Shield',
    inputs: [
      { name: 'treeNumber', type: 'uint256', indexed: false },
      { name: 'startPosition', type: 'uint256', indexed: false },
      { name: 'commitments', type: 'bytes32[]', indexed: false },
      { name: 'shieldCiphertext', type: 'bytes[]', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Unshield',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transact',
    inputs: [
      { name: 'treeNumber', type: 'uint256', indexed: false },
      { name: 'startPosition', type: 'uint256', indexed: false },
      { name: 'hash', type: 'bytes32[]', indexed: false },
      { name: 'ciphertext', type: 'bytes[]', indexed: false },
    ],
  },
] as const;

export const RELAY_ABI: Abi = [
  {
    type: 'event',
    name: 'RelayerPayment',
    inputs: [
      { name: 'relayer', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Event type mapping
export type EventType = 'deposit' | 'withdrawal' | 'relayer_payment' | 'other';
