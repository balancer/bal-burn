import { useCallback, useEffect, useRef, useState } from 'react'
import { BaseError, formatUnits, type Address, type PublicClient } from 'viem'
import { EXPLORER } from './config'
import { fetchBurnPage, type BurnEntry } from './burnHistory'

export function BurnHistory({ client, address, refreshKey }: { client: PublicClient; address: Address; refreshKey: number }) {
  const [entries, setEntries] = useState<BurnEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const retryBlock = useRef<bigint | undefined>(undefined)

  const load = useCallback(async (endBlock?: bigint, reset = false) => {
    const current = ++requestId.current
    setLoading(true); setError('')
    if (reset) setEntries([])
    try {
      let cursor: bigint | undefined = endBlock
      while (current === requestId.current) {
        retryBlock.current = cursor
        const page = await fetchBurnPage(client, address, cursor)
        if (current !== requestId.current) return
        setEntries(saved => {
          const seen = new Set<string>()
          return [...saved, ...page.entries].filter(entry => {
            const key = entry.hash + ':' + entry.logIndex
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
        })
        if (page.nextBlock === null) break
        cursor = page.nextBlock
      }
    } catch (e) {
      if (current === requestId.current) setError(e instanceof BaseError ? [e.shortMessage, e.details].filter(Boolean).join(' ') : e instanceof Error ? e.message : 'Could not fetch burn history.')
    } finally { if (current === requestId.current) setLoading(false) }
  }, [client, address])

  useEffect(() => { void load(undefined, true); return () => { requestId.current++ } }, [load, refreshKey])

  return <section className="card history-card" aria-labelledby="history-title">
    <h2 id="history-title">BAL Burn history</h2>
    <div className="history-columns"><span>Amount</span><span>Date/Time</span></div>
    <div className="history-rows"><div className="history-content" tabIndex={0} role="region" aria-label="Burn history entries" aria-busy={loading}>
      {entries.map(entry => {
        const date = new Date(Number(entry.timestamp) * 1000)
        return <div className="burn-entry" key={entry.hash + ':' + entry.logIndex}>
          <strong>{formatUnits(entry.amount, 18)}</strong>
          <div className="burn-date"><time className="muted" dateTime={date.toISOString()} title={date.toISOString()}>{date.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short', hour12: false })}</time>
          <a href={EXPLORER + '/tx/' + entry.hash} target="_blank" rel="noreferrer" aria-label={'View burn transaction ' + entry.hash} title="View transaction on Etherscan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>
          </a></div>
        </div>
      })}
      {!entries.length && !loading && !error && <p className="muted" style={{ paddingTop: 12 }}>No BAL burns found.</p>}
      
      {error && <div className="history-error"><p role="alert">{error}</p><button className="secondary" onClick={() => void load(retryBlock.current, retryBlock.current === undefined)}>Retry history</button></div>}
    </div>
      {loading && <div className="history-overlay"><span className="spinner" role="status" aria-label="Loading burn events" /></div>}
    </div>
  </section>
}
