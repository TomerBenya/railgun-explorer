import { type Abi } from 'viem';

// Environment configuration
export const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';

// Start block - RailgunSmartWallet deployment ~Feb 2023 (block 16,634,349)
// Can be overridden via START_BLOCK env var
export const START_BLOCK = process.env.START_BLOCK
  ? BigInt(process.env.START_BLOCK)
  : 16_634_349n;

// Indexer settings
export const CONFIRMATION_BLOCKS = 12n;
// Alchemy allows larger batches (~2000 blocks), public RPCs allow ~1000
export const BATCH_SIZE = BigInt(process.env.BATCH_SIZE || '1000');

// Railgun contract addresses on Ethereum mainnet
export const CONTRACTS = {
  // RailgunSmartWallet - handles Shield/Transact/Unshield events
  smartWallet: '0xc0BEF2D373A1EfaDE8B952f33c1370E486f209Cc' as `0x${string}`,
  // Relay proxy - handles relayed transactions
  relay: '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9' as `0x${string}`,
} as const;

// Ethereum SmartWallet event signatures (topic0 hashes)
// Shield(uint256,uint256,(bytes32,(uint8,address,uint256),uint120)[],(bytes32[3],bytes32)[],uint256[])
// Confirmed from Etherscan verified source: fees is uint256[] (same signature as Polygon SmartWallet)
// Unshield(address,(uint8,address,uint256),uint256,uint256)
export const ETH_EVENT_SIGNATURES = {
  SMARTWALLET_SHIELD: '0x3a5b9dc26075a3801a6ddccf95fec485bb7500a91b44cec1add984c21ee6db3b',
  SMARTWALLET_UNSHIELD: '0xd93cf895c7d5b2cd7dc7a098b678b3089f37d91f48d9b83a0800a91cbdf05284',
} as const;

// Railgun event ABIs
// Ethereum SmartWallet (0xc0BEF...) emits Shield and Unshield events
// Shield uses 5-param version with uint256[] fees (confirmed from Etherscan source)
// Shield topic0: 0x3a5b9dc26075a3801a6ddccf95fec485bb7500a91b44cec1add984c21ee6db3b
// Relay contract (0xfa7093...) emits Shield/Unshield with 4-param Shield (no fees)
// Relay Shield topic0: 0xc3821e11e71307afd1d94a490660178ff37aefdd3c0514e5dd08937bd7024f34
export const SMART_WALLET_ABI: Abi = [
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
      { name: 'fees', type: 'uint256[]', indexed: false },
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
