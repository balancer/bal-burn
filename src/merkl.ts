import { getAddress, isAddress, type Address, type Hex } from 'viem'

// frontend-monorepo/packages/lib/modules/portfolio/merkl/useHasMerklRewards.ts
export const MERKL_API = '/api/merkl'
export interface MerklClaim { tokenAddress: Address; symbol: string; decimals: number; amount: bigint; available: bigint; pending: bigint; proofs: Hex[] | null }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Merkl rewards response.')
  return value as Record<string, unknown>
}
function atomic(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid Merkl reward amount.')
  return BigInt(value)
}

export function parseMerklClaims(data: unknown, address: Address): MerklClaim[] {
  if (!Array.isArray(data)) throw new Error('Invalid Merkl rewards response.')
  const claims: MerklClaim[] = []
  for (const entry of data) {
    const group = object(entry)
    if (object(group.chain).id !== 1) continue
    if (!Array.isArray(group.rewards)) throw new Error('Invalid Merkl rewards response.')
    for (const item of group.rewards) {
      const reward = object(item), token = object(reward.token)
      if (token.chainId !== 1) continue
      if (reward.recipient !== undefined && (typeof reward.recipient !== 'string' || reward.recipient.toLowerCase() !== address.toLowerCase())) continue
      if (typeof token.address !== 'string' || !isAddress(token.address, { strict: false }) || typeof token.symbol !== 'string' || !Number.isInteger(token.decimals) || (token.decimals as number) < 0 || (token.decimals as number) > 255) throw new Error('Invalid Merkl reward token.')
      const amount = atomic(reward.amount), claimed = atomic(reward.claimed), pending = atomic(reward.pending ?? '0')
      const available = amount > claimed ? amount - claimed : 0n
      if (available === 0n && pending === 0n) continue
      const proofs = (reward.distributionLayer === undefined || reward.distributionLayer === 'TREE') && Array.isArray(reward.proofs) && reward.proofs.every(proof => typeof proof === 'string' && /^0x[0-9a-fA-F]{64}$/.test(proof)) ? reward.proofs as Hex[] : null
      claims.push({ amount, proofs, tokenAddress: getAddress(token.address.toLowerCase()), symbol: token.symbol, decimals: token.decimals as number, available, pending })
    }
  }
  return claims
}

export async function fetchMerklClaims(address: Address, signal: AbortSignal, reload = false): Promise<MerklClaim[]> {
  const response = await fetch(MERKL_API + '/users/' + address + '/rewards/summary?chainId=1' + (reload ? '&reloadChainId=1' : ''), { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
  if (!response.ok) throw new Error('Unable to fetch Merkl claims (' + response.status + ').')
  return parseMerklClaims(await response.json(), address)
}

