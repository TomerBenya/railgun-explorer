import { decodeEventLog, type Log } from 'viem';
import { SMART_WALLET_ABI, RELAY_ABI, type EventType } from './config';

export interface DecodedEvent {
  eventName: string;
  eventType: EventType;
  tokenAddress: string | null;
  rawAmountWei: string | null;
  relayerAddress: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  metadata: Record<string, unknown>;
}

// CommitmentPreimage structure from Shield event
interface TokenData {
  tokenType: number;
  tokenAddress: string;
  tokenSubID: bigint;
}

interface CommitmentPreimage {
  npk: string;
  token: TokenData;
  value: bigint;
}

interface ShieldArgs {
  treeNumber: bigint;
  startPosition: bigint;
  commitments: CommitmentPreimage[];
  shieldCiphertext: unknown[];
  fees: bigint[];
}

interface UnshieldArgs {
  to: string;
  token: TokenData;
  amount: bigint;
  fee: bigint;
}

// Returns multiple decoded events for Shield (one per commitment)
export function decodeSmartWalletEvent(log: Log): DecodedEvent[] {
  try {
    const decoded = decodeEventLog({
      abi: SMART_WALLET_ABI,
      data: log.data,
      topics: log.topics,
    });

    const eventName = decoded.eventName as unknown as string;
    const events: DecodedEvent[] = [];

    if (eventName === 'Shield') {
      // Shield contains multiple commitments, each with token and value
      const args = decoded.args as unknown as ShieldArgs;

      for (const commitment of args.commitments) {
        // Only process ERC20 tokens (tokenType === 0)
        if (commitment.token.tokenType === 0) {
          events.push({
            eventName: 'Shield',
            eventType: 'deposit',
            tokenAddress: commitment.token.tokenAddress,
            rawAmountWei: commitment.value.toString(),
            relayerAddress: null,
            fromAddress: null,
            toAddress: null,
            metadata: {
              treeNumber: args.treeNumber.toString(),
              startPosition: args.startPosition.toString(),
            },
          });
        }
      }
    } else if (eventName === 'Unshield') {
      const args = decoded.args as unknown as UnshieldArgs;
      // Only process ERC20 tokens (tokenType === 0)
      if (args.token.tokenType === 0) {
        events.push({
          eventName: 'Unshield',
          eventType: 'withdrawal',
          tokenAddress: args.token.tokenAddress,
          rawAmountWei: args.amount.toString(),
          relayerAddress: null,
          fromAddress: null,
          toAddress: args.to,
          metadata: {
            fee: args.fee.toString(),
          },
        });
      }
    }

    return events;
  } catch {
    return [];
  }
}

export function decodeRelayEvent(log: Log): DecodedEvent[] {
  try {
    const decoded = decodeEventLog({
      abi: RELAY_ABI,
      data: log.data,
      topics: log.topics,
    });

    const eventName = decoded.eventName as unknown as string;
    const events: DecodedEvent[] = [];

    if (eventName === 'Shield') {
      // Shield contains multiple commitments, each with token and value
      const args = decoded.args as unknown as ShieldArgs;

      for (const commitment of args.commitments) {
        // Only process ERC20 tokens (tokenType === 0)
        if (commitment.token.tokenType === 0) {
          events.push({
            eventName: 'Shield',
            eventType: 'deposit',
            tokenAddress: commitment.token.tokenAddress,
            rawAmountWei: commitment.value.toString(),
            relayerAddress: null,
            fromAddress: null,
            toAddress: null,
            metadata: {
              treeNumber: args.treeNumber.toString(),
              startPosition: args.startPosition.toString(),
            },
          });
        }
      }
    } else if (eventName === 'Unshield') {
      const args = decoded.args as unknown as UnshieldArgs;
      // Only process ERC20 tokens (tokenType === 0)
      if (args.token.tokenType === 0) {
        events.push({
          eventName: 'Unshield',
          eventType: 'withdrawal',
          tokenAddress: args.token.tokenAddress,
          rawAmountWei: args.amount.toString(),
          relayerAddress: null,
          fromAddress: null,
          toAddress: args.to,
          metadata: {
            fee: args.fee.toString(),
          },
        });
      }
    }

    return events;
  } catch {
    // Unknown event signature - skip silently
    return [];
  }
}
