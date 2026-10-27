import { parseAbiItem, zeroAddress, type Address, type Hash, type PublicClient } from 'viem'
import { BAL } from './config'

export const BURN_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
export const HISTORY_BLOCK_RANGE = 5_000n

// First Ethereum block at/after 2026-10-01 00:00:00 UTC (timestamp 1790812811).
export const BURN_HISTORY_START_BLOCK = 26_093_738n
export interface BurnEntry { hash: Hash; logIndex: number; blockNumber: bigint; amount: bigint; timestamp: bigint }
export interface BurnPage { entries: BurnEntry[]; fromBlock: bigint; toBlock: bigint; nextBlock: bigint | null }

export async function fetchBurnPage(client: PublicClient, address: Address, endBlock?: bigint): Promise<BurnPage> {
  if (await client.getChainId() !== 1) throw new Error('Burn history requires an Ethereum mainnet RPC (chain ID 1).')
  const toBlock = endBlock ?? await client.getBlockNumber({ cacheTime: 0 })
  if (toBlock < BURN_HISTORY_START_BLOCK) return { entries: [], fromBlock: BURN_HISTORY_START_BLOCK, toBlock, nextBlock: null }
  const pageStart = toBlock >= HISTORY_BLOCK_RANGE ? toBlock - HISTORY_BLOCK_RANGE + 1n : 0n
  const fromBlock = pageStart > BURN_HISTORY_START_BLOCK ? pageStart : BURN_HISTORY_START_BLOCK
  const logs = await client.getLogs({ address: BAL, event: BURN_TRANSFER, args: { from: address, to: zeroAddress }, fromBlock, toBlock, strict: true })
  const events: Omit<BurnEntry, 'timestamp'>[] = []
  const seen = new Set<string>()
  for (const log of logs) {
    if (log.removed || log.transactionHash === null || log.blockNumber === null || log.logIndex === null) continue
    const key = log.transactionHash + ':' + log.logIndex
    if (seen.has(key)) continue
    seen.add(key)
    events.push({ hash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber, amount: log.args.value })
  }
  events.sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1)
  const timestamps = new Map<bigint, bigint>()
  const blocks = [...new Set(events.map(entry => entry.blockNumber))]
  for (let index = 0; index < blocks.length; index += 8) {
    await Promise.all(blocks.slice(index, index + 8).map(async blockNumber => {
      const block = await client.getBlock({ blockNumber })
      timestamps.set(blockNumber, block.timestamp)
    }))
  }
  const entries = events.map(entry => ({ ...entry, timestamp: timestamps.get(entry.blockNumber)! }))
  return { entries, fromBlock, toBlock, nextBlock: fromBlock === BURN_HISTORY_START_BLOCK ? null : fromBlock - 1n }
}
