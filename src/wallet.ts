import type { EIP1193Provider } from 'viem'
export interface Wallet { id: string; name: string; provider: EIP1193Provider }
const wallets = new Map<string, Wallet>()
export function discoverWallets(update: (wallets: Wallet[]) => void) {
  const publish = () => {
    const ethereum = (window as Window & { ethereum?: EIP1193Provider }).ethereum
    const values = [...wallets.values()]
    if (ethereum && !values.some(w => w.provider === ethereum)) values.push({ id: 'injected', name: 'Browser wallet', provider: ethereum })
    update(values)
  }
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<{ info: { uuid: string; name: string }; provider: EIP1193Provider }>).detail
    if (detail?.info?.uuid && typeof detail.provider?.request === 'function') { wallets.set(detail.info.uuid, { id: detail.info.uuid, name: detail.info.name, provider: detail.provider }); publish() }
  }
  window.addEventListener('eip6963:announceProvider', announce)
  window.addEventListener('ethereum#initialized', publish)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  publish()
  return () => { window.removeEventListener('eip6963:announceProvider', announce); window.removeEventListener('ethereum#initialized', publish) }
}
