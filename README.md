# BAL Burn

Standalone, static Ethereum mainnet app, styled like ../vebal-unlocks. React + Vite + viem; no backend, indexer, analytics, or API keys.

## Run

```sh
npm install
npm run dev       # http://localhost:3003
npm run build     # static site in dist/
npm test          # Playwright browser + validation tests
```

Install a browser for tests if needed: `npx playwright install chromium`. Deploy `dist/` to any static host; wallets require HTTPS except on localhost.

## Contract and behavior

- Ethereum BAL: `0xba100000625a3754423978a60c9317c58a424e3d`.
- Address source: `../frontend-monorepo/packages/lib/config/networks/mainnet.ts`, `tokens.addresses.bal` (line 23).
- `burn(uint256 amount)` verified against the deployed BalancerGovernanceToken ABI on [Etherscan](https://etherscan.io/address/0xba100000625a3754423978a60c9317c58a424e3d#code).
- Burns the connected account's own BAL, reducing total supply. No approval, transfer to a dead address, burnFrom, or intermediary contract.
- BAL has 18 decimals. Strict decimal validation rejects rounding, scientific notation, zero, negatives, and amounts exceeding balance.
- A review dialog precedes simulation and the wallet signature request. Gas is paid in ETH; there is no app fee or compensation.
- Checks RPC chain ID, wallet chain and account, and simulates the exact call before requesting a transaction. Success requires an on-chain successful receipt. Tracks replacement hashes and handles wallet cancellation.
- Select a connected wallet or add a read-only address, saved for the browser session. The burn and history cards appear only when an address is selected. Only the selected connected account can burn.
- Only injected wallets (EIP-6963 discovery and legacy injection); no WalletConnect. Disconnect is local, not permission revocation.

## Burn history

History is fetched from the configured RPC using BAL's ERC-20 `Transfer` events, filtered to the selected address as `from` and the zero address as `to`. BAL emits these when tokens are burned; there is no separate Burn event. Rows show the exact BAL amount, the block’s date/time in UTC, and an arrow linking to the transaction, newest first. Block timestamps are fetched once per unique block in each batch.

History starts on **1 October 2026, 00:00 UTC**, at Ethereum block **26,093,738** (00:00:11 UTC; the preceding block is 30 September 23:59:59 UTC). The scan automatically fetches 5,000-block batches backwards to that cutoff, showing results as they arrive. There is no manual pagination button. Empty history is shown only after the scan completes; failed requests remain visible with a retry action. Scan BAL and confirmed burns refresh history. Switching address or RPC clears stale results. RPC log errors are displayed separately from the balance with a retry action.

## RPC and privacy

Default RPC: `https://ethereum-rpc.publicnode.com`. Configure another Ethereum RPC through the header's **RPC** button; saved locally under `bal-burn:rpc`. Reads, simulation, and receipt polling use this endpoint; transactions go through the selected wallet. RPC providers see requests, address, and IP. Avoid putting secret API keys in a public browser app.

## Verification

`npm run build` typechecks and builds. `npm test` covers exact precision, validation, mobile overflow, balance/MAX, review/cancel, direct burn calldata and receipt confirmation, rejected signatures, failed simulations, and chain mismatch. Browser tests mock RPC and wallet calls; they do not spend funds or establish live-chain execution. For real transaction testing use a disposable mainnet fork and an injected wallet connected to that fork (chain ID 1), and point the app RPC at the same fork.

Burning is permanent. Never test by burning real tokens unless that loss is intentional.
