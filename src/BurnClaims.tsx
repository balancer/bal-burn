import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { fetchMerklClaims, type MerklClaim } from './merkl'
import { formatTokenAmount } from "./amount";

export function BurnClaims({ address, refreshKey, onClaim, canClaim, disabled }: {
  address: Address
  refreshKey: number
  onClaim: (claims: MerklClaim[]) => Promise<void>
  canClaim: boolean
  disabled: boolean
}) {
  const [claims, setClaims] = useState<MerklClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [claimError, setClaimError] = useState('')
  const [retry, setRetry] = useState(0)
  const [claiming, setClaiming] = useState(false)
  const [overview, setOverview] = useState(false)
  const reload = useRef(false)

  const claimable = claims.filter(claim => claim.available > 0n && claim.proofs !== null)

  useEffect(() => {
    const controller = new AbortController()
    const reloadChain = reload.current
    reload.current = false
    setLoading(true); setError(''); setClaims([]); setOverview(false)
    void fetchMerklClaims(address, controller.signal, reloadChain).then(result => {
      if (!controller.signal.aborted) setClaims(result)
    }).catch((e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not fetch Merkl claims.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [address, refreshKey, retry])

  useEffect(() => {
    if (!overview) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverview(false)
      else if (event.key === 'Tab') {
        const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown) }
  }, [overview])

  async function claimAll() {
    if (claiming || disabled || !canClaim || claimable.length === 0) return
    setClaiming(true); setClaimError('')
    try {
      await onClaim(claimable)
      setOverview(false)
      reload.current = true
      setRetry(value => value + 1)
    } catch (e) { setClaimError(e instanceof Error ? e.message : 'Could not claim rewards.') }
    finally { setClaiming(false) }
  }


  return <section className="card claims-card" aria-labelledby="claims-title">
    <h2 id="claims-title">BAL Burn claims</h2>
    <p className="muted" style={{ fontSize: 13, margin: 0 }}>After burning BAL it takes about 24 hours before your claim will appear here</p>
    <div className="claims-body" aria-busy={loading}>
      {loading && <div className="history-overlay"><span className="spinner" role="status" aria-label="Loading Merkl claims" /></div>}
      {!loading && !error && claimable.length === 0 && <p className="muted">No claims found...</p>}
      {!loading && !error && claimable.length > 0 && <div className="claim-row">
        <span className="claim-reward">Rewards available</span>
        <button className="primary" disabled={disabled || claiming || !canClaim} title={!canClaim ? 'Connect this address on Ethereum to claim.' : undefined} onClick={() => { setClaimError(''); setOverview(true) }}>{claiming ? 'Claiming…' : 'Claim'}</button>
      </div>}
      {claimError && !overview && <p className="claims-error" role="alert">{claimError}</p>}
      {error && <p className="muted" role="alert">No claim data available, go to <a href="https://app.merkl.xyz" target="_blank" rel="noreferrer">Merkl<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', transform: 'translateY(-6px)' }}><path d="M7 17 17 7M7 7h10v10" /></svg></a> directly to claim</p>}
    </div>
    {overview && <div className="modal-backdrop"><section className="card modal rewards-modal" role="dialog" aria-modal="true" aria-labelledby="overview-title"><h2 id="overview-title">Rewards</h2>
      {claimable.map(claim => <div className="overview-row" key={claim.tokenAddress}><span>{claim.symbol}</span><span title={formatUnits(claim.available, claim.decimals) + ' ' + claim.symbol}>{formatTokenAmount(claim.available, claim.decimals)}</span></div>)}
      {claimError && <p className="claims-error" role="alert">{claimError}</p>}
      <div className="input-row"><button autoFocus className="secondary" onClick={() => setOverview(false)}>Cancel</button><button className="primary" disabled={claiming} onClick={() => void claimAll()}>{claiming ? 'Claiming…' : 'Claim all'}</button></div>
    </section></div>}
  </section>
}
