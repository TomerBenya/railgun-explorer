import { decodeEventLog, decodeAbiParameters, parseAbiParameters, type Log, type Abi } from 'viem';
import { SMART_WALLET_ABI, RELAY_ABI, type EventType } from './config';
import { RELAY_ABI as POLYGON_RELAY_ABI, POLYGON_EVENT_SIGNATURES } from './configPolygon';

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

export function decodeRelayEvent(log: Log, abi?: Abi): DecodedEvent[] {
  // Use provided ABI or default to Ethereum ABI
  const eventAbi = abi || RELAY_ABI;
  
  try {
    const decoded = decodeEventLog({
      abi: eventAbi,
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
      // Handle both tuple-based (Ethereum) and address-based (Polygon) Unshield events
      const args = decoded.args as any;
      
      let tokenAddress: string;
      // Check if token is a tuple (Ethereum) or address (Polygon)
      if (typeof args.token === 'string') {
        // Polygon: token is just an address
        tokenAddress = args.token;
      } else if (args.token && typeof args.token === 'object' && 'tokenAddress' in args.token) {
        // Ethereum: token is a tuple with tokenAddress
        // Only process ERC20 tokens (tokenType === 0)
        if (args.token.tokenType !== 0) {
          return []; // Skip non-ERC20 tokens
        }
        tokenAddress = args.token.tokenAddress;
      } else {
        return []; // Unknown format
      }
      
      events.push({
        eventName: 'Unshield',
        eventType: 'withdrawal',
        tokenAddress,
        rawAmountWei: args.amount.toString(),
        relayerAddress: null,
        fromAddress: null,
        toAddress: args.to,
        metadata: {
          fee: args.fee?.toString() || '0',
        },
      });
    }

    return events;
  } catch (err) {
    // For Polygon: try to decode directly from data if signature doesn't match
    // Polygon uses different event signatures that don't match standard ABIs
    const eventSig = log.topics[0]?.toLowerCase();
    
    // Handle Polygon Unshield (signature 0x49fed1d0...)
    if (eventSig === POLYGON_EVENT_SIGNATURES.UNSHIELD.toLowerCase() && log.data && log.data.length > 130) {
      try {
        // Decode as Unshield(address,address,uint256,uint256) directly from data
        const params = parseAbiParameters([
          'address to',
          'address token',
          'uint256 amount',
          'uint256 fee'
        ]);
        
        const decoded = decodeAbiParameters(params, log.data);
        
        return [{
          eventName: 'Unshield',
          eventType: 'withdrawal',
          tokenAddress: decoded[1], // token address
          rawAmountWei: decoded[2].toString(), // amount
          relayerAddress: null,
          fromAddress: null,
          toAddress: decoded[0], // to address
          metadata: {
            fee: decoded[3].toString(),
          },
        }];
      } catch (decodeErr) {
        console.warn(`[decodeRelayEvent] Failed to decode Polygon Unshield at block ${log.blockNumber}: ${decodeErr}`);
        return [];
      }
    }
    
    // Handle Polygon Shield (signature 0x4be10945...)
    // Polygon Shield structure: bytes32 treeHash (32 bytes), offset (32 bytes), then arrays
    // Token address appears at position 130-170 in hex string (after first 64 bytes)
    if (eventSig === POLYGON_EVENT_SIGNATURES.SHIELD.toLowerCase() && log.data && log.data.length > 200) {
      try {
        const data = log.data;
        
        // Extract token address from position 130-170 (bytes 65-85, which is hex chars 130-170)
        // This is the third 32-byte chunk, which contains the padded token address
        let tokenAddress: string | null = null;
        
        // Try positions where token address might appear (after treeHash + offset)
        // Position 130 is after 64 bytes (128 hex chars) + 2 for '0x' = 130
        const positions = [130, 106, 90, 154, 170];
        for (const pos of positions) {
          if (pos + 64 <= data.length) {
            // Get the 32-byte chunk (64 hex chars)
            const chunk = data.substring(pos, pos + 64);
            // Token address is padded: 24 hex chars of zeros + 40 hex chars of address
            if (chunk.startsWith('000000000000000000000000')) {
              const addr = '0x' + chunk.substring(24, 64); // Extract last 40 hex chars
              // Validate it's a proper address
              if (addr.length === 42 && /^0x[a-fA-F0-9]{40}$/.test(addr) && addr !== '0x0000000000000000000000000000000000000000') {
                tokenAddress = addr;
                break;
              }
            }
          }
        }
        
        // If not found at expected positions, search the entire data for padded addresses
        if (!tokenAddress) {
          for (let i = 2; i < data.length - 64; i += 2) {
            const chunk = data.substring(i, i + 64);
            if (chunk.startsWith('000000000000000000000000')) {
              const addr = '0x' + chunk.substring(24, 64);
              if (addr.length === 42 && /^0x[a-fA-F0-9]{40}$/.test(addr) && addr !== '0x0000000000000000000000000000000000000000') {
                tokenAddress = addr;
                break;
              }
            }
          }
        }
        
        // If we found a token, create a deposit event
        // Note: Amount extraction is complex due to array structure, so we'll set it to 0 for now
        // The analytics will still count the transaction
        if (tokenAddress) {
          return [{
            eventName: 'Shield',
            eventType: 'deposit',
            tokenAddress,
            rawAmountWei: '0', // Amount extraction from array structure not yet implemented
            relayerAddress: null,
            fromAddress: null,
            toAddress: null,
            metadata: {
              note: 'Polygon Shield - amount set to 0, structure too complex',
              blockNumber: log.blockNumber.toString(),
            },
          }];
        }
        
        // If we can't extract token, skip
        console.warn(`[decodeRelayEvent] Polygon Shield at block ${log.blockNumber} - could not extract token address`);
        return [];
      } catch (decodeErr) {
        console.warn(`[decodeRelayEvent] Failed to decode Polygon Shield at block ${log.blockNumber}: ${decodeErr}`);
        return [];
      }
    }
    
    // Log unknown event signatures for debugging
    if (log.topics && log.topics[0]) {
      console.warn(`[decodeRelayEvent] Unknown event signature: ${log.topics[0]} at block ${log.blockNumber}`);
    }
    // Unknown event signature - skip silently
    return [];
  }
}
