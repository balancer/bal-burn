import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaseError, createPublicClient, createWalletClient, custom, formatUnits, getAddress, http, type Address, type Hash } from 'viem'
import { mainnet } from 'viem/chains'
import { BAL, BAL_ABI, DEFAULT_RPC, EXPLORER, MERKL_ABI, MERKL_DISTRIBUTOR } from './config'
import { parseAmount, validateRpc } from './amount'
import { discoverWallets, type Wallet } from './wallet'
import { AddressScanCard } from "./AddressScanCard";
import { BurnClaims } from "./BurnClaims";
import { fetchMerklClaims, type MerklClaim } from "./merkl";

const short = (address: string) => address.slice(0, 6) + '…' + address.slice(-4)
const display = (value: bigint) => Number(formatUnits(value, 18)).toLocaleString('en-US', { maximumFractionDigits: 6 })
const message = (error: unknown) => error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Something went wrong.'
type Transaction = { phase: 'idle' | 'signing' | 'confirming' | 'success' | 'error'; hash?: Hash; amount?: string; error?: string }

export default function App() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const wallet = wallets[0]
  const [account, setAccount] = useState<Address | null>(null)
  const [scanTarget, setScanTarget] = useState<Address | null>(null)
  const readOnly = !account || !scanTarget || account.toLowerCase() !== scanTarget.toLowerCase()
  const [chainId, setChainId] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [rpc, setRpc] = useState(() => { try { return localStorage.getItem('bal-burn:rpc') || DEFAULT_RPC } catch { return DEFAULT_RPC } })
  const [rpcDraft, setRpcDraft] = useState(rpc)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [review, setReview] = useState(false)
  const [tx, setTx] = useState<Transaction>({ phase: 'idle' })
  const [claimingToken, setClaimingToken] = useState<Address | null>(null)
  const busy = tx.phase === 'signing' || tx.phase === 'confirming' || claimingToken !== null
  const transactionLock = useRef(false)
  const generation = useRef(0)
  const identity = useRef({ account, wallet, rpc, scanTarget })
  identity.current = { account, wallet, rpc, scanTarget }
  const client = useMemo(() => createPublicClient({ chain: mainnet, transport: http(rpc, { timeout: 15_000, retryCount: 1 }) }), [rpc])
  const parsed = parseAmount(amount)
  const amountError = amount && parsed === null ? 'Enter a positive amount with at most 18 decimals.' : parsed !== null && balance !== null && parsed > balance ? 'Amount exceeds your BAL balance.' : ''
  const canBurn = !!account && !readOnly && chainId === 1 && balance !== null && !loading && parsed !== null && parsed <= balance && !busy

  useEffect(() => discoverWallets(setWallets), [])
  useEffect(() => { setAmount(''); setReview(false) }, [scanTarget])
  useEffect(() => {
    setAccount(null); setChainId(null); setAmount(''); setReview(false)
    if (!wallet) return
    let active = true
    const accountsChanged = (accounts: string[]) => { if (!active) return; setAccount(accounts[0] ? getAddress(accounts[0]) : null); setAmount(''); setReview(false) }
    const chainChanged = (chain: string) => { if (active) { setChainId(Number(chain)); setReview(false) } }
    const disconnected = () => accountsChanged([])
    wallet.provider.on('accountsChanged', accountsChanged)
    wallet.provider.on('chainChanged', chainChanged)
    wallet.provider.on('disconnect', disconnected)
    return () => { active = false; wallet.provider.removeListener('accountsChanged', accountsChanged); wallet.provider.removeListener('chainChanged', chainChanged); wallet.provider.removeListener('disconnect', disconnected) }
  }, [wallet])

  const refresh = useCallback(async () => {
    if (identity.current.scanTarget !== scanTarget || identity.current.rpc !== rpc) return
    const current = ++generation.current
    setHistoryVersion(version => version + 1)
    setBalance(null); setError('')
    if (!scanTarget) { setLoading(false); return }
    setLoading(true)
    try {
      if (await client.getChainId() !== 1) throw new Error('RPC must point to Ethereum mainnet (chain ID 1).')
      const owned = await client.readContract({ address: BAL, abi: BAL_ABI, functionName: 'balanceOf', args: [scanTarget] })
      if (current === generation.current) { setBalance(owned) }
    } catch (e) { if (current === generation.current) setError(message(e)) }
    finally { if (current === generation.current) setLoading(false) }
  }, [client, scanTarget, rpc])
  useEffect(() => { void refresh(); return () => { generation.current++ } }, [refresh])

  async function connect() {
    setError(''); setConnecting(true)
    try {
      if (!wallet) throw new Error('No browser wallet detected. Install MetaMask, Rabby, or another Ethereum wallet.')
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' })
      if (!accounts[0]) throw new Error('No account returned. Unlock your wallet and try again.')
      const chain = await wallet.provider.request({ method: 'eth_chainId' })
      if (identity.current.wallet !== wallet) return
      setAccount(getAddress(accounts[0])); setChainId(Number(chain))
    } catch (e) { setError(message(e)) } finally { setConnecting(false) }
  }

  async function switchChain() {
    try { await wallet?.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }); if (wallet) setChainId(Number(await wallet.provider.request({ method: 'eth_chainId' }))) }
    catch (e) { setError(message(e)) }
  }

  async function burn() {
    if (!canBurn || !wallet || !account || parsed === null || transactionLock.current) return
    transactionLock.current = true
    const owner = account, selected = wallet, endpoint = rpc, quantity = amount
    setReview(false); setTx({ phase: 'signing', amount: quantity })
    let hash: Hash | undefined
    try {
      if (await client.getChainId() !== 1) throw new Error('RPC is not Ethereum mainnet.')
      const { request } = await client.simulateContract({ address: BAL, abi: BAL_ABI, functionName: 'burn', args: [parsed], account: owner })
      const accounts = await selected.provider.request({ method: 'eth_accounts' })
      const chain = await selected.provider.request({ method: 'eth_chainId' })
      if (identity.current.wallet !== selected || identity.current.account !== owner || identity.current.scanTarget?.toLowerCase() !== owner.toLowerCase() || identity.current.rpc !== endpoint || accounts[0]?.toLowerCase() !== owner.toLowerCase() || Number(chain) !== 1) throw new Error('Wallet, account, network, or RPC changed. Review your burn again.')
      const signer = createWalletClient({ chain: mainnet, transport: custom(selected.provider) })
      hash = await signer.writeContract(request)
      setTx({ phase: 'confirming', hash, amount: quantity })
      let cancelled = false
      const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000, onReplaced: replacement => { cancelled ||= replacement.reason !== 'repriced'; hash = replacement.transaction.hash; setTx({ phase: 'confirming', hash, amount: quantity }) } })
      if (cancelled) throw new Error('Transaction cancelled or replaced with a different call. This burn was not confirmed.')
      if (receipt.status !== 'success') throw new Error('Transaction reverted. BAL was not burned.')
      setTx({ phase: 'success', hash: receipt.transactionHash, amount: quantity })
      setAmount('');
    } catch (e) { setTx({ phase: 'error', hash, amount: quantity, error: message(e) }) }
    finally { transactionLock.current = false; void refresh() }
  }

  async function claimReward(claim: MerklClaim) {
    if (transactionLock.current || !account || !wallet || readOnly || chainId !== 1 || claim.available === 0n || claim.proofs === null) throw new Error('Connect the selected wallet on Ethereum to claim available rewards.')
    transactionLock.current = true
    setClaimingToken(claim.tokenAddress)
    const owner = account, selected = wallet, endpoint = rpc
    let hash: Hash | undefined
    try {
      if (await client.getChainId() !== 1) throw new Error('RPC is not Ethereum mainnet.')
      const rewards = await fetchMerklClaims(owner, new AbortController().signal, true)
      const reward = rewards.find(item => item.tokenAddress.toLowerCase() === claim.tokenAddress.toLowerCase())
      if (!reward || reward.available === 0n) throw new Error('No rewards remain available for this token.')
      if (reward.proofs === null) throw new Error('No supported Merkle proof is available for this reward.')
      const { request } = await client.simulateContract({ address: MERKL_DISTRIBUTOR, abi: MERKL_ABI, functionName: 'claim', args: [[owner], [reward.tokenAddress], [reward.amount], [reward.proofs]], account: owner })
      const accounts = await selected.provider.request({ method: 'eth_accounts' })
      const network = await selected.provider.request({ method: 'eth_chainId' })
      if (identity.current.wallet !== selected || identity.current.account !== owner || identity.current.scanTarget?.toLowerCase() !== owner.toLowerCase() || identity.current.rpc !== endpoint || accounts[0]?.toLowerCase() !== owner.toLowerCase() || Number(network) !== 1) throw new Error('Wallet, account, network, or RPC changed. Try claiming again.')
      const signer = createWalletClient({ chain: mainnet, transport: custom(selected.provider) })
      hash = await signer.writeContract(request)
      let replaced = false
      const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000, onReplaced: replacement => { replaced ||= replacement.reason !== 'repriced'; hash = replacement.transaction.hash } })
      if (replaced) throw new Error('Claim cancelled or replaced with a different transaction.')
      if (receipt.status !== 'success') throw new Error('Claim transaction reverted.')
    } catch (e) { throw new Error(message(e) + (hash ? ' Transaction: ' + hash + '. Check its status before retrying.' : '')) }
    finally { transactionLock.current = false; setClaimingToken(null) }
  }

  function saveRpc(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    try { const url = validateRpc(rpcDraft); localStorage.setItem('bal-burn:rpc', url); setRpc(url); setSettingsOpen(false); setReview(false); setError('') } catch (e) { setError(message(e)) }
    }

  useEffect(() => {
    if (!review) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setReview(false)
      if (event.key === 'Tab') {
        const buttons = document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.querySelector<HTMLButtonElement>('[data-review-burn]')?.focus() }
  }, [review])

  return <>
    <header style={{ padding: '24px 0 8px' }}>
      <div className="row-between" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="gradient-text" style={{ margin: 0, fontSize: 28 }}>BAL Burn</h1>
          <div className="muted" style={{ fontSize: 13 }}>Burn BAL on Ethereum mainnet</div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="secondary" onClick={() => setSettingsOpen(s => !s)} aria-expanded={settingsOpen}>RPC</button>
          {account ? <>
            <span className="badge badge-blue mono">{short(account)}</span>
            <button className="secondary" disabled={busy} onClick={() => { setAccount(null); setChainId(null); setReview(false); setError('') }}>Disconnect</button>
          </> : <button className="primary" disabled={!wallet || connecting || busy} title={wallet ? '' : 'No injected wallet detected'} onClick={() => void connect()}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>}
        </div>
      </div>
      {settingsOpen && <form className="card rpc-form" style={{ marginTop: 12 }} onSubmit={saveRpc}>
        <label className="muted" htmlFor="rpc">RPC for Ethereum (stored locally; used for all reads)</label>
        <div className="row">
          <input id="rpc" style={{ flex: 1 }} placeholder={rpc} value={rpcDraft} onChange={e => setRpcDraft(e.target.value)} disabled={busy}/>
          <button className="primary" disabled={busy || !rpcDraft.trim().startsWith('http')}>Save</button>
          <button className="secondary" type="button" disabled={busy} onClick={() => { localStorage.removeItem('bal-burn:rpc'); setRpc(DEFAULT_RPC); setRpcDraft(''); setReview(false); setError('') }}>Reset to default</button>
        </div>
        <div className="muted mono" style={{ marginTop: 6 }}>current: {rpc}</div>
      </form>}
    </header>
    <main>

      
      <AddressScanCard account={account} loading={loading} disabled={busy} onSelect={setScanTarget} onScan={() => void refresh()} />
      
      {scanTarget && <div className="layout"><section className="card burn-card" aria-label="Burn BAL">
        
        <div className="balance-row"><label htmlFor="amount">Amount to burn</label><span>Balance: <strong>{balance === null ? '—' : display(balance)} BAL</strong></span></div>
        <div className="amount-field"><input id="amount" inputMode="decimal" placeholder="0.0" autoComplete="off" value={amount} disabled={busy} onChange={e => { setAmount(e.target.value); setReview(false) }} aria-invalid={!!amountError} aria-describedby={amountError ? 'amount-error' : undefined}/><span>BAL</span><button className="max" disabled={balance === null || balance === 0n || busy || loading} onClick={() => { setAmount(formatUnits(balance!, 18)); }}>MAX</button></div>
        {amountError && <p id="amount-error" className="field-error">{amountError}</p>}
        {!account ? <button className="primary full" disabled={connecting || busy} onClick={() => void connect()}>Connect wallet to continue</button> : readOnly ? <button className="secondary full" disabled>Read-only address</button> : chainId !== 1 ? <button className="primary full" disabled={busy} onClick={() => void switchChain()}>Switch to Ethereum</button> : <button data-review-burn className="primary" style={{ width: 160, height: 40, flexShrink: 0, marginTop: 16, display: 'block', marginLeft: 'auto' }} disabled={!canBurn} onClick={() => setReview(true)}>{tx.phase === 'signing' ? 'Confirm in your wallet…' : tx.phase === 'confirming' ? 'Waiting for confirmation…' : 'Burn'}</button>}
        
      </section>
        <BurnClaims key={scanTarget} address={scanTarget} refreshKey={historyVersion} onClaim={claimReward} canClaim={!readOnly && chainId === 1} disabled={busy} /></div>}
        
        <section className="card about-card" aria-labelledby="about-title">
        <h2 id="about-title">About burning BAL</h2>
        <p><a href="https://forum.balancer.fi/t/bip-928-orderly-winddown-of-balancer-and-distribution-of-the-treasury/7107" target="_blank" rel="noreferrer">BIP-928<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: 'middle', transform: 'translateY(-6px)' }}><path d="M7 17 17 7M7 7h10v10" /></svg></a> proposes distributing Balancer’s treasury to BAL holders as part of an orderly winddown. The proposal sets out two distribution rounds.</p>
        <p><strong>Round one:</strong> From the end of May to the end of November 2027, holders redeem BAL through a claim contract, which burns it and distributes a proportional share of the treasury in the tokens held.</p>
        <p><strong>Round two:</strong> Within two months of round one closing, remaining funds—including unspent budget, later receipts and unredeemed shares—are airdropped to the same wallets, proportional to the BAL each redeemed. No further claim is needed.</p>
        <p>After burning your BAL, you can return in 24 hours to view your claims.</p>
        
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {(tx.phase === 'confirming' || tx.phase === 'error') && <section className={'card transaction ' + tx.phase} aria-live="polite"><strong>{tx.phase === 'error' ? 'Burn not confirmed' : 'Transaction submitted. Waiting for an on-chain receipt…'}</strong>{tx.error && <p role="alert">{tx.error}{tx.hash && ' Check the transaction before retrying; it may still confirm.'}</p>}{tx.hash && <a href={EXPLORER + '/tx/' + tx.hash} target="_blank" rel="noreferrer">View transaction on Etherscan ↗</a>}</section>}
      <footer className="muted" style={{ marginTop: 16 }}>
        BAL burns are irreversible and reduce the total supply.
        <br />
        This site is fully static; it talks to the RPC you configure and the Merkl API.
      </footer>
    </main>
    {review && <div className="modal-backdrop"><section className="card modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><h2 id="review-title">Burn {amount} BAL?</h2><p className="muted">Your wallet will show the final network fee before you sign.</p><div className="input-row"><button autoFocus className="secondary" onClick={() => setReview(false)}>Cancel</button><button className="danger" disabled={!canBurn} onClick={() => void burn()}>Burn {amount} BAL</button></div></section></div>}
  </>

}
