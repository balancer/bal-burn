import { expect, test, type Page } from '@playwright/test'
import { encodeFunctionResult, parseUnits, encodeAbiParameters, encodeEventTopics, zeroAddress, type PublicClient } from 'viem'
import { BAL, BAL_ABI } from '../src/config'
import { parseAmount, validateRpc } from '../src/amount'
import { BURN_TRANSFER, BURN_HISTORY_START_BLOCK, fetchBurnPage } from "../src/burnHistory";

const owner = '0x1111111111111111111111111111111111111111'
async function setup(page: Page, options: { chain?: string; reject?: boolean; simulateFail?: boolean; rpcChain?: string; reverted?: boolean; changedAccount?: boolean; history?: boolean; historyError?: boolean; pagedHistory?: boolean } = {}) {
  await page.addInitScript(({ owner, options }) => {
    const handlers: Record<string, ((value: unknown) => void)[]> = {}
    let chain = options.chain ?? '0x1'
    ;(window as any).sent = []
    ;(window as any).ethereum = {
      on: (event: string, handler: (value: unknown) => void) => { (handlers[event] ??= []).push(handler) },
      removeListener: (event: string, handler: (value: unknown) => void) => { handlers[event] = (handlers[event] ?? []).filter(h => h !== handler) },
      request: async ({ method, params }: { method: string; params: unknown[] }) => {
        if (method === 'eth_requestAccounts') return [owner]
        if (method === 'eth_accounts') return [options.changedAccount ? '0x2222222222222222222222222222222222222222' : owner]
        if (method === 'eth_chainId') return chain
        if (method === 'wallet_switchEthereumChain') { chain = '0x1'; handlers.chainChanged?.forEach(h => h(chain)); return null }
        if (method === 'eth_sendTransaction') { if (options.reject) throw { code: 4001, message: 'User rejected the request.' }; (window as any).sent.push(params[0]); return '0x' + 'a'.repeat(64) }
        throw new Error('Unexpected method: ' + method)
      },
    }
  }, { owner, options })
  let mined = false
  const head = BURN_HISTORY_START_BLOCK + (options.pagedHistory ? 7000n : 256n)
  await page.route('https://ethereum-rpc.publicnode.com/**', async route => {
    const body = route.request().postDataJSON()
    const respond = (req: any) => {
      if (req.method === 'eth_getTransactionReceipt' && !options.reverted) mined = true
      let result: unknown
      if (req.method === 'eth_chainId') result = options.rpcChain ?? '0x1'
      else if (req.method === 'eth_call') {
        const data: string = req.params[0].data
        if (data.startsWith('0x18160ddd')) result = encodeFunctionResult({ abi: BAL_ABI, functionName: 'totalSupply', result: parseUnits('100000000', 18) })
        else if (data.startsWith('0x70a08231')) result = encodeFunctionResult({ abi: BAL_ABI, functionName: 'balanceOf', result: parseUnits('12.345', 18) })
        else if (data.startsWith('0x42966c68')) { if (options.simulateFail) return { jsonrpc: '2.0', id: req.id, error: { code: 3, message: 'execution reverted' } }; result = '0x' }
        else throw new Error('Unexpected call: ' + data)
      } else if (req.method === 'eth_getTransactionReceipt') result = { transactionHash: '0x' + 'a'.repeat(64), transactionIndex: '0x0', blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x' + head.toString(16), from: owner, to: BAL, cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1', logs: [], logsBloom: '0x' + '0'.repeat(512), status: options.reverted ? '0x0' : '0x1', type: '0x2', contractAddress: null }
      else if (req.method === 'eth_blockNumber') result = '0x' + head.toString(16)
      else if (req.method === 'eth_getBlockByNumber') result = { number: req.params[0], hash: '0x' + 'b'.repeat(64), timestamp: '0x' + (1790812811n + (BigInt(req.params[0]) - BURN_HISTORY_START_BLOCK) * 12n).toString(16), transactions: [] }
      else if (req.method === 'eth_getLogs') {
        if (options.historyError) return { jsonrpc: '2.0', id: req.id, error: { code: -32000, message: 'History RPC unavailable' } }
        const filter = req.params[0]
        const correctOwner = filter.topics[1]?.toLowerCase() === ('0x' + owner.slice(2).padStart(64, '0')).toLowerCase()
        const older = options.pagedHistory && BigInt(filter.toBlock) < head
        const value = mined ? '1.25' : older ? '3' : '2.5'
        result = correctOwner && (options.history || mined) ? [{ address: BAL, topics: encodeEventTopics({ abi: [BURN_TRANSFER], eventName: 'Transfer', args: { from: owner, to: zeroAddress } }), data: encodeAbiParameters([{ type: 'uint256' }], [parseUnits(value, 18)]), blockNumber: '0x' + (options.pagedHistory ? older ? BURN_HISTORY_START_BLOCK : BURN_HISTORY_START_BLOCK + 6000n : head).toString(16), blockHash: '0x' + 'b'.repeat(64), transactionHash: '0x' + (older ? 'c' : mined ? 'a' : 'd').repeat(64), transactionIndex: '0x0', logIndex: '0x0', removed: false }] : []
      }
      else throw new Error('Unexpected RPC: ' + req.method)
      return { jsonrpc: '2.0', id: req.id, result }
    }
    await route.fulfill({ json: Array.isArray(body) ? body.map(respond) : respond(body) })
  })
  await page.goto('/')
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByText('12.345 BAL', { exact: true })).toBeVisible()
  await expect(page.locator('header .badge-blue')).toHaveText('0x1111…1111')
  await expect(page.locator('header').getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
}
async function review(page: Page) {
  await connect(page)
  await page.getByLabel('Amount to burn').fill('1.25')
  
  await page.getByRole('button', { name: 'Burn', exact: true }).click()
}
test('burn history clamps to the October cutoff and skips earlier blocks', async () => {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
  const client = { getChainId: async () => 1, getLogs: async (range: { fromBlock: bigint; toBlock: bigint }) => { ranges.push(range); return [] } } as unknown as PublicClient
  const before = await fetchBurnPage(client, owner, BURN_HISTORY_START_BLOCK - 1n)
  expect(before.entries).toEqual([])
  expect(before.nextBlock).toBeNull()
  expect(ranges).toHaveLength(0)
  const atCutoff = await fetchBurnPage(client, owner, BURN_HISTORY_START_BLOCK)
  expect(ranges[0]).toMatchObject({ fromBlock: BURN_HISTORY_START_BLOCK, toBlock: BURN_HISTORY_START_BLOCK })
  expect(atCutoff.nextBlock).toBeNull()
  const page = await fetchBurnPage(client, owner, BURN_HISTORY_START_BLOCK + 5000n)
  expect(page.fromBlock).toBe(BURN_HISTORY_START_BLOCK + 1n)
  expect(page.nextBlock).toBe(BURN_HISTORY_START_BLOCK)
})
test('strict exact-precision amount validation', () => {
  for (const value of ['', '0', '-1', '1e3', '0.0000000000000000001', '1.1234567890123456789', 'NaN', ' 1', '1.', '0x10']) expect(parseAmount(value)).toBeNull()
  expect(parseAmount('0.000000000000000001')).toBe(1n)
  expect(parseAmount('12.345')).toBe(12345000000000000000n)
  expect(parseAmount((2n ** 256n).toString())).toBeNull()
  expect(() => validateRpc('javascript:alert(1)')).toThrow()
  expect(() => validateRpc('https://user:pass@example.com')).toThrow()
})
test('disconnected page and mobile have no horizontal overflow', async ({ page }) => {
  await setup(page)
  await expect(page.getByRole('heading', { name: 'Burn BAL', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Select address to scan for BAL:')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scan BAL', exact: true })).toBeDisabled()
  await expect(page.locator('.burn-card')).toHaveCount(0)
  await expect(page.locator('.history-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'About burning BAL' })).toBeVisible()
  await expect(page.locator('.about-card')).not.toContainText('This tool calls')
  await expect(page.getByRole('link', { name: 'BIP-928', exact: true })).toHaveAttribute('href', 'https://forum.balancer.fi/t/bip-928-orderly-winddown-of-balancer-and-distribution-of-the-treasury/7107')
  await expect(page.getByText('Total BAL supply', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Token contract', exact: true })).toHaveCount(0)
  await expect(page.locator('header h1.gradient-text')).toHaveText('BAL Burn')
  await expect(page.locator('header')).not.toContainText('Looking to withdraw')
  await expect(page.locator('header .network')).toHaveCount(0)
  await expect(page.locator('footer br')).toHaveCount(1)
  await expect(page.locator('footer')).not.toContainText('USD pricing')
  await page.screenshot({ path: 'artifacts/bal-burn-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/bal-burn-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test('read-only address selection reveals cards and cannot burn another wallet balance', async ({ page }) => {
  await setup(page)
  const selector = page.getByLabel('Select address to scan for BAL:')
  await selector.selectOption('add')
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await page.getByLabel('Read-only address to add').fill('not an address')
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  const watched = '0x2222222222222222222222222222222222222222'
  await page.getByLabel('Read-only address to add').fill(watched)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.burn-card')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'BAL Burn history' })).toBeVisible()
  await expect(page.getByText('12.345 BAL', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Read-only address', exact: true })).toBeDisabled()
  await page.getByLabel('Amount to burn').fill('1')
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toHaveCount(0)
  await selector.selectOption('wallet')
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.locator('.burn-card')).toHaveCount(0)
  await expect(page.locator('.history-card')).toHaveCount(0)
  await expect(page.locator('.about-card')).toBeVisible()
  await selector.selectOption(watched)
  await expect(page.locator('.history-card')).toBeVisible()
  await page.reload()
  await expect(selector.locator('option', { hasText: watched })).toHaveCount(1)
  await expect(page.locator('.burn-card')).toHaveCount(0)
})
test('history matches burn height and scrolls internally on desktop and mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page); await connect(page)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => page.evaluate(() => Math.abs(document.querySelector('.history-card')!.getBoundingClientRect().height - document.querySelector('.burn-card')!.getBoundingClientRect().height))).toBeLessThan(1)
    const before = await page.locator('.burn-card').evaluate(el => el.getBoundingClientRect().height)
    await expect(page.locator('.history-content')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.history-overlay')).toHaveCount(0)
    await page.locator('.history-content').evaluate(el => { el.innerHTML = Array.from({ length: 40 }, (_, i) => '<p>Burn entry ' + i + '</p>').join('') })
    await expect.poll(async () => page.evaluate(() => Math.abs(document.querySelector('.history-card')!.getBoundingClientRect().height - document.querySelector('.burn-card')!.getBoundingClientRect().height))).toBeLessThan(1)
    expect(await page.locator('.burn-card').evaluate(el => el.getBoundingClientRect().height)).toBe(before)
    expect(await page.locator('.history-content').evaluate(el => { el.scrollTop = 100; return el.scrollHeight > el.clientHeight && el.scrollTop > 0 })).toBe(true)
    await page.locator('.history-content').evaluate(el => { el.textContent = 'No BAL burns found for this address.' })
    await expect(page.locator('.card-foot')).toHaveCount(0)
    await page.screenshot({ path: width === 1280 ? 'artifacts/history-layout-desktop.png' : 'artifacts/history-layout-mobile.png', fullPage: true })
  }
})
test('spinner overlays rows only while loading', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await setup(page)
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('https://ethereum-rpc.publicnode.com/**', async route => {
    const body = route.request().postDataJSON()
    if ((Array.isArray(body) ? body : [body]).some(request => request.method === 'eth_getLogs')) await pending
    await route.fallback()
  })
  try {
    await connect(page)
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const spinner = page.locator('.history-overlay .spinner')
      await expect(spinner).toBeVisible()
      await expect(spinner).toHaveCSS('width', '40px')
      await expect(spinner).toHaveCSS('border-top-width', '4px')
      await expect(spinner).toHaveCSS('animation-name', 'spin')
      await expect(spinner).toHaveCSS('animation-play-state', 'running')
      const overlay = await page.locator('.history-overlay').boundingBox()
      const rows = await page.locator('.history-content').boundingBox()
      expect(overlay).toEqual(rows)
    }
  } finally { release() }
  await expect(page.locator('.history-content')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.history-overlay')).toHaveCount(0)
})
test('loads filtered burn events newest first and paginates older blocks', async ({ page }) => {
  const queries: any[] = []
  page.on('request', request => { if (request.method() === 'POST') { const body = request.postDataJSON(); for (const item of Array.isArray(body) ? body : [body]) if (item?.method === 'eth_getLogs') queries.push(item.params[0]) } })
  await setup(page, { history: true, pagedHistory: true }); await connect(page)
  await expect(page.locator('.burn-entry strong')).toHaveText(['2.5', '3'])
  expect(queries.at(-1).fromBlock).toBe('0x' + BURN_HISTORY_START_BLOCK.toString(16))
  expect(queries.at(-1).toBlock).toBe('0x' + (BURN_HISTORY_START_BLOCK + 2000n).toString(16))
  await expect(page.getByRole('button', { name: 'Load older burns' })).toHaveCount(0)
  await expect(page.locator('.history-range')).toHaveCount(0)
  await expect(page.locator('.history-content')).not.toContainText('Blocks ')
  await expect(page.locator('.burn-entry time')).toHaveText(['01/10/2026, 20:00', '01/10/2026, 00:00'])
  await expect(page.locator('.burn-entry time').last()).toHaveAttribute('datetime', '2026-10-01T00:00:11.000Z')
  for (const query of queries) {
    expect(BigInt(query.fromBlock)).toBeGreaterThanOrEqual(BURN_HISTORY_START_BLOCK)
    expect(query.address.toLowerCase()).toBe(BAL)
    expect(query.topics).toEqual(encodeEventTopics({ abi: [BURN_TRANSFER], eventName: 'Transfer', args: { from: owner, to: zeroAddress } }))
  }
  await expect(page.locator('.burn-entry a').first()).toHaveAttribute('href', 'https://etherscan.io/tx/0x' + 'd'.repeat(64))
  await expect(page.getByRole('heading', { name: 'BAL Burn history', exact: true })).toBeVisible()
  await expect(page.locator('.burn-entry a svg')).toHaveCount(2)
  expect(await page.locator('.burn-entry').first().evaluate(el => [...el.children].map(child => child.tagName))).toEqual(['STRONG', 'DIV'])
  expect(await page.locator('.burn-date').first().evaluate(el => [...el.children].map(child => child.tagName))).toEqual(['TIME', 'A'])
  await expect(page.locator('.history-columns')).toHaveText('AmountDate/Time')
  const fonts = await page.evaluate(() => [...document.querySelectorAll('.history-columns span, .burn-entry:first-child strong, .burn-entry:first-child time')].map(el => { const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight, s.color] }))
  expect(fonts).toEqual(fonts.map(() => fonts[0]))
  const sizes = await page.evaluate(() => [...document.querySelectorAll('h2:not(#history-title),h3,p,button,input,select,label,time,.history-columns span,.burn-entry strong')].filter(el => el.getClientRects().length > 0).map(el => getComputedStyle(el).fontSize))
  expect([...new Set(sizes)]).toEqual(['15px'])
  await expect(page.locator('footer')).toHaveCSS('font-size', '12px')
  await expect(page.locator('#history-title')).toHaveCSS('font-size', '18px')
  await expect(page.locator('header h1')).toHaveCSS('font-size', '28px')
  await expect(page.locator('header .muted').first()).toHaveCSS('font-size', '13px')
  await page.locator('.history-content').evaluate(el => { el.scrollTop = 0 })
  await page.screenshot({ path: 'artifacts/burn-events-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/burn-events-mobile.png', fullPage: true })
  await page.getByLabel('Select address to scan for BAL:').selectOption('add')
  await page.getByLabel('Read-only address to add').fill('0x2222222222222222222222222222222222222222')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.history-content')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.burn-entry')).toHaveCount(0)
  await expect(page.locator('.history-content')).toContainText('No BAL burns found.')
})
test('history RPC errors are retryable without blocking the balance', async ({ page }) => {
  await setup(page, { historyError: true }); await connect(page)
  await expect(page.locator('.history-error')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry history' })).toBeVisible()
  await page.getByLabel('Amount to burn').fill('1')
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Retry history' }).click()
  await expect(page.locator('.history-content')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.history-error')).toBeVisible()
})
test('balance validation, MAX and cancel', async ({ page }) => {
  await setup(page); await connect(page)
  await page.getByLabel('Amount to burn').fill('13')
  await expect(page.getByText('Amount exceeds your BAL balance.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'MAX', exact: true }).click()
  await expect(page.getByLabel('Amount to burn')).toHaveValue('12.345')
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.locator('.warning')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeEnabled()
  const buttonStyles = await page.evaluate(() => [document.querySelector('[data-review-burn]')!, document.querySelector('.scan-card button')!].map(el => { const s = getComputedStyle(el); return [s.width, s.height, s.backgroundImage, s.backgroundColor, s.color, s.padding, s.borderRadius, s.fontSize, s.fontWeight] }))
  expect(buttonStyles[0]).toEqual(buttonStyles[1])
  await page.getByRole('button', { name: 'Burn', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(0)
})
test('simulates and sends burn(uint256) directly, then verifies receipt', async ({ page }) => {
  await setup(page); await review(page)
  await page.getByRole('button', { name: 'Burn 1.25 BAL' }).click()
  await expect(page.getByLabel('Amount to burn')).toHaveValue('')
  await expect(page.locator('.burn-entry strong')).toHaveText(['1.25'])
  await expect(page.locator('.transaction')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'View transaction on Etherscan ↗' })).toHaveCount(0)
  const sent = await page.evaluate(() => (window as any).sent)
  expect(sent).toHaveLength(1)
  expect(sent[0].to.toLowerCase()).toBe(BAL)
  expect(sent[0].data).toBe('0x42966c68' + parseUnits('1.25', 18).toString(16).padStart(64, '0'))
})
test('wallet rejection never shows success', async ({ page }) => {
  await setup(page, { reject: true }); await review(page)
  await page.getByRole('button', { name: 'Burn 1.25 BAL' }).click()
  await expect(page.getByText('Burn not confirmed')).toBeVisible()
  await expect(page.getByText('1.25 BAL burned successfully.')).toHaveCount(0)
})
test('failed simulation never requests a transaction', async ({ page }) => {
  await setup(page, { simulateFail: true }); await review(page)
  await page.getByRole('button', { name: 'Burn 1.25 BAL' }).click()
  await expect(page.getByText('Burn not confirmed')).toBeVisible()
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(0)
})
test('wrong wallet network requires explicit switch', async ({ page }) => {
  await setup(page, { chain: '0x89' }); await connect(page)
  await page.getByRole('button', { name: 'Switch to Ethereum' }).click()
  await expect(page.getByRole('button', { name: 'Burn', exact: true })).toBeVisible()
})
test('reverted receipt never shows a successful burn', async ({ page }) => {
  await setup(page, { reverted: true }); await review(page)
  await page.getByRole('button', { name: 'Burn 1.25 BAL' }).click()
  await expect(page.getByText('Burn not confirmed')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Transaction reverted')
  await expect(page.getByText('1.25 BAL burned successfully.')).toHaveCount(0)
})
test('account change during simulation blocks signing', async ({ page }) => {
  await setup(page, { changedAccount: true }); await review(page)
  await page.getByRole('button', { name: 'Burn 1.25 BAL' }).click()
  await expect(page.getByRole('alert')).toContainText('changed. Review your burn again.')
  expect(await page.evaluate(() => (window as any).sent.length)).toBe(0)
})
test('non-mainnet RPC fails closed', async ({ page }) => {
  await setup(page, { rpcChain: '0x89' })
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.locator('main > .error')).toContainText('RPC must point to Ethereum mainnet')
  await expect(page.getByRole('button', { name: 'MAX', exact: true })).toBeDisabled()
})
