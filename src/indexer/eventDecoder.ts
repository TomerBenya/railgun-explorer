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

interface UnshieldArgs {
  to: string;
  token: string;
  amount: bigint;
  fee: bigint;
}

export function decodeSmartWalletEvent(log: Log): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: SMART_WALLET_ABI,
      data: log.data,
      topics: log.topics,
    });

    const eventName = decoded.eventName as unknown as string;
    let eventType: EventType = 'other';
    let tokenAddress: string | null = null;
    let rawAmountWei: string | null = null;
    let toAddress: string | null = null;

    if (eventName === 'Shield') {
      eventType = 'deposit';
      // Shield events require parsing ciphertext to extract token/amount
      // TODO: Implement based on actual Railgun format
    } else if (eventName === 'Unshield') {
      eventType = 'withdrawal';
      const args = decoded.args as unknown as UnshieldArgs;
      tokenAddress = args.token;
      rawAmountWei = args.amount.toString();
      toAddress = args.to;
    } else if (eventName === 'Transact') {
      eventType = 'other'; // Regular private transfers, not relayer payments
    }

    return {
      eventName,
      eventType,
      tokenAddress,
      rawAmountWei,
      relayerAddress: null,
      fromAddress: null,
      toAddress,
      metadata: (decoded.args as unknown as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

export function decodeRelayEvent(log: Log): DecodedEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: RELAY_ABI,
      data: log.data,
      topics: log.topics,
    });

    const eventName = decoded.eventName as unknown as string;
    if (eventName === 'RelayerPayment') {
      const args = decoded.args as unknown as { relayer: string; token: string; amount: bigint };
      return {
        eventName: 'RelayerPayment',
        eventType: 'relayer_payment',
        tokenAddress: args.token,
        rawAmountWei: args.amount.toString(),
        relayerAddress: args.relayer,
        fromAddress: null,
        toAddress: null,
        metadata: args as unknown as Record<string, unknown>,
      };
    }

    return null;
  } catch {
    return null;
  }
}
