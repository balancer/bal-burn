import { useEffect, useState, useRef } from 'react'
import { formatUnits, type Address } from 'viem'
import { fetchMerklClaims, type MerklClaim } from './merkl'
import { formatTokenAmount } from "./amount";

export function BurnClaims({ address, refreshKey, onClaim, canClaim, disabled }: {
  address: Address
  refreshKey: number
  onClaim: (claim: MerklClaim) => Promise<void>
  canClaim: boolean
  disabled: boolean
}) {
  const [claims, setClaims] = useState<MerklClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [claimError, setClaimError] = useState('')
  const [retry, setRetry] = useState(0)
  const [activeToken, setActiveToken] = useState<Address | null>(null)
  const submitting = useRef(false)
  const reload = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const reloadChain = reload.current
    reload.current = false
    setLoading(true); setError(''); setClaims([])
    void fetchMerklClaims(address, controller.signal, reloadChain).then(result => {
      if (!controller.signal.aborted) setClaims(result)
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not fetch Merkl claims.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [address, refreshKey, retry])

  async function claimReward(claim: MerklClaim) {
    if (submitting.current || disabled || !canClaim || claim.available === 0n || claim.proofs === null) return
    submitting.current = true
    setActiveToken(claim.tokenAddress); setClaimError('')
    try {
      await onClaim(claim)
      reload.current = true
      setRetry(value => value + 1)
    } catch (e) { setClaimError(e instanceof Error ? e.message : 'Could not claim rewards.') }
    finally { submitting.current = false; setActiveToken(null) }
  }

  return <section className="card claims-card" aria-labelledby="claims-title">
    <h2 id="claims-title">BAL Burn claims</h2>
    <div className="claims-body" aria-busy={loading}>
      {loading && <div className="history-overlay"><span className="spinner" role="status" aria-label="Loading Merkl claims" /></div>}
      {!loading && !error && claims.length === 0 && <p className="muted">No claims found...</p>}
      {!loading && claims.length > 0 && <div className="claims-table">
        
        {claims.map((claim, index) => <div className="claim-row" key={claim.tokenAddress + ':' + index}>
          
          <span className="claim-reward" title={formatUnits(claim.available, claim.decimals) + ' ' + claim.symbol + (claim.pending > 0n ? ' · Pending: ' + formatUnits(claim.pending, claim.decimals) : '')}>{formatTokenAmount(claim.available, claim.decimals)} {claim.symbol}</span>
          <button className="primary" disabled={disabled || activeToken !== null || !canClaim || claim.available === 0n || claim.proofs === null} title={!canClaim ? 'Connect this address on Ethereum to claim.' : claim.available === 0n ? 'Pending rewards are not claimable yet.' : claim.proofs === null ? 'No supported Merkle proof available.' : undefined} onClick={() => void claimReward(claim)}>{activeToken === claim.tokenAddress ? 'Claiming…' : 'Claim'}</button>
        </div>)}
      </div>}
      {claimError && <p className="claims-error" role="alert">{claimError}</p>}
      {error && <div className="claims-error"><p role="alert">{error}</p><button className="primary" style={{ width: 160, height: 40, flexShrink: 0, marginTop: 16, display: 'block', marginLeft: 'auto' }} onClick={() => setRetry(value => value + 1)}>Retry claims</button></div>}
    </div>
  </section>
}
