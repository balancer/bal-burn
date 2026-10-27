import { useEffect, useId, useState } from 'react'
import { getAddress, isAddress, type Address } from 'viem'

const STORAGE_KEY = 'bal-burn:scan-addresses'
function readSessionAddresses(): Address[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(stored)) return []
    const addresses: Address[] = []
    for (const value of stored) {
      if (typeof value === 'string' && isAddress(value, { strict: false }) && !addresses.some(address => address.toLowerCase() === value.toLowerCase())) addresses.push(getAddress(value.toLowerCase()))
    }
    return addresses
  } catch { return [] }
}

export function AddressScanCard({ account, loading, disabled, onSelect, onScan }: {
  account: Address | null
  loading: boolean
  disabled: boolean
  onSelect: (address: Address | null) => void
  onScan: () => void
}) {
  const [addresses, setAddresses] = useState(readSessionAddresses)
  const [selected, setSelected] = useState('wallet')
  const [input, setInput] = useState('')
  const headingId = useId()
  const target = selected === 'wallet' ? account : addresses.find(address => address === selected) ?? null

  useEffect(() => { onSelect(target) }, [target, onSelect])
  useEffect(() => {
    if (!account) return
    setSelected(value => value.toLowerCase() === account.toLowerCase() ? 'wallet' : value)
    setAddresses(saved => saved.some(address => address.toLowerCase() === account.toLowerCase()) ? saved : [...saved, account])
  }, [account])
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(addresses)) } catch { /* Selection remains usable without storage. */ }
  }, [addresses])

  function addAddress() {
    const value = input.trim()
    if (!isAddress(value, { strict: false })) return
    if (account?.toLowerCase() === value.toLowerCase()) { setSelected('wallet'); setInput(''); return }
    const existing = addresses.find(saved => saved.toLowerCase() === value.toLowerCase())
    const address = existing ?? getAddress(value.toLowerCase())
    if (!existing) setAddresses(saved => [...saved, address])
    setSelected(address); setInput('')
  }

  return <div className="card scan-card">
    <strong id={headingId}>Select address to scan for BAL:</strong>
    <div className="row" style={{ flexWrap: 'wrap', marginTop: 16, gap: 20 }}>
      <select className="mono address-selector" aria-labelledby={headingId} style={{ flex: '1 1 280px', minWidth: 0, maxWidth: '100%', height: 40 }} value={selected} disabled={disabled} onChange={event => setSelected(event.target.value)}>
        <option value="wallet" disabled={!account}>{account ?? 'Connect a wallet'}</option>
        {addresses.filter(address => address.toLowerCase() !== account?.toLowerCase()).map(address => <option key={address} value={address}>{address}</option>)}
        <option value="add">Add a read-only address...</option>
      </select>
      <button type="button" className="primary" style={{ width: 160, height: 40, flexShrink: 0 }} disabled={!target || loading || disabled} onClick={onScan}>{loading ? 'Scanning...' : 'Scan BAL'}</button>
    </div>
    {selected === 'add' && <form className="row" style={{ flexWrap: 'wrap', marginTop: 20, gap: 20 }} onSubmit={event => { event.preventDefault(); addAddress() }}>
      <input aria-label="Read-only address to add" className="mono" style={{ flex: '1 1 220px', minWidth: 0, height: 40 }} placeholder="0x... (read-only)" value={input} disabled={disabled} onChange={event => setInput(event.target.value)}/>
      <button type="submit" className="secondary" style={{ width: 160, height: 40, flexShrink: 0 }} disabled={disabled || !isAddress(input.trim(), { strict: false })}>Add</button>
    </form>}
  </div>
}
