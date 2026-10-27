import { parseUnits, formatUnits } from 'viem'
export function parseAmount(value: string): bigint | null {
  if (!/^(?:\d+)(?:\.\d{1,18})?$/.test(value)) return null
  try { const amount = parseUnits(value, 18); return amount > 0n && amount < 2n ** 256n ? amount : null } catch { return null }
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  return amount > 0n && amount * 100n < 10n ** BigInt(decimals) ? '<0.01' : formatUnits(amount, decimals)
}
export function validateRpc(value: string): string {
  const url = new URL(value.trim())
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) RPC URL without embedded credentials.')
  return url.href
}
