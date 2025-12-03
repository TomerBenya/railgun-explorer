import { type Abi } from 'viem';

// Environment configuration
export const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';

// RailgunSmartWallet deployed ~Feb 2023 (block ~16,700,000)
// Using a slightly earlier block to ensure we don't miss early events
export const START_BLOCK = 16_700_000n;

// Indexer settings
export const CONFIRMATION_BLOCKS = 12n;
export const BATCH_SIZE = 1000n; // Public RPCs limit to 1000 blocks per getLogs

// Railgun contract addresses on Ethereum mainnet
export const CONTRACTS = {
  // RailgunSmartWallet - handles Shield/Transact/Unshield events
  smartWallet: '0xc0BEF2D373A1EfaDE8B952f33c1370E486f209Cc' as `0x${string}`,
  // Relay proxy - handles relayed transactions
  relay: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9' as `0x${string}`,
} as const;

// Railgun event ABIs
// The Relay contract (0xfa7093...) emits Shield/Unshield events
// Shield topic0: 0xc3821e11e71307afd1d94a490660178ff37aefdd3c0514e5dd08937bd7024f34
// This is the 4-parameter version (no fees)
export const SMART_WALLET_ABI: Abi = [] as const; // SmartWallet at 0xc0BEF... has no events

// Relay contract emits Shield and Unshield events
export const RELAY_ABI: Abi = [
  {
    type: 'event',
    name: 'Shield',
    inputs: [
      { name: 'treeNumber', type: 'uint256', indexed: false },
      { name: 'startPosition', type: 'uint256', indexed: false },
      {
        name: 'commitments',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'npk', type: 'bytes32' },
          {
            name: 'token',
            type: 'tuple',
            components: [
              { name: 'tokenType', type: 'uint8' },
              { name: 'tokenAddress', type: 'address' },
              { name: 'tokenSubID', type: 'uint256' },
            ],
          },
          { name: 'value', type: 'uint120' },
        ],
      },
      {
        name: 'shieldCiphertext',
        type: 'tuple[]',
        indexed: false,
        components: [
          { name: 'encryptedBundle', type: 'bytes32[3]' },
          { name: 'shieldKey', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'Unshield',
    inputs: [
      { name: 'to', type: 'address', indexed: false },
      {
        name: 'token',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'tokenType', type: 'uint8' },
          { name: 'tokenAddress', type: 'address' },
          { name: 'tokenSubID', type: 'uint256' },
        ],
      },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Event type mapping
export type EventType = 'deposit' | 'withdrawal' | 'relayer_payment' | 'other';
