# BAL Burn

Standalone, static Ethereum mainnet app, styled like ../vebal-unlocks. React + Vite + viem; no app backend, indexer, analytics, or API keys. Balances use the configured RPC; claims use the public Merkl API.

## Run

```sh
npm install
npm run dev       # http://localhost:3003
npm run build     # static site in dist/
npm test          # Playwright browser + validation tests
```

> **Note:** The e2e suite was removed; `npm test` currently finds no tests.

Install a browser for tests if needed: `npx playwright install chromium`. Deploy `dist/` behind a host that also proxies `/api/merkl/*` to `https://api.merkl.xyz/v4/*`; a purely static host needs a separate proxy service. Wallets require HTTPS except on localhost.

## Contract and behavior

- Ethereum BAL: `0xba100000625a3754423978a60c9317c58a424e3d`.
- Address source: `../frontend-monorepo/packages/lib/config/networks/mainnet.ts`, `tokens.addresses.bal` (line 23).
- `burn(uint256 amount)` verified against the deployed BalancerGovernanceToken ABI on [Etherscan](https://etherscan.io/address/0xba100000625a3754423978a60c9317c58a424e3d#code).
- Burns the connected account's own BAL, reducing total supply. No approval, transfer to a dead address, burnFrom, or intermediary contract.
- BAL has 18 decimals. Strict decimal validation rejects rounding, scientific notation, zero, negatives, and amounts exceeding balance.
- A review dialog precedes simulation and the wallet signature request. Gas is paid in ETH; there is no app fee or compensation.
- Checks RPC chain ID, wallet chain and account, and simulates the exact call before requesting a transaction. Success requires an on-chain successful receipt. Tracks replacement hashes and handles wallet cancellation.
- Select a connected wallet or add a read-only address, saved for the browser session. The burn and claims cards appear only when an address is selected. Only the selected connected account can burn.
- Only injected wallets (EIP-6963 discovery and legacy injection); no WalletConnect. Disconnect is local, not permission revocation.

## Merkl claims

The **BAL Burn claims** card sits below the burn form. It appears only after selecting an address, including a read-only address. It fetches the same-origin `/api/merkl/users/{address}/rewards/summary?chainId=1`, proxied to `https://api.merkl.xyz/v4/users/{address}/rewards/summary?chainId=1`, following `frontend-monorepo/packages/lib/modules/portfolio/merkl/useHasMerklRewards.ts`.

Amounts are `amount - claimed` (floored at zero), calculated with bigint. Positive display amounts below 0.01 appear as `<0.01`, with the exact amount in the tooltip; transaction amounts and proofs remain unchanged. Pending rewards are not included in this amount and cannot be claimed. Fully claimed rewards with nothing pending are hidden. Empty results show **No claims found...**; loading uses the overlay spinner, and API failures show an error and retry button. Switching the address cancels the previous request. Scan BAL and confirmed burns refresh claims.

This lists the selected address's Ethereum Merkl rewards, not only a particular BAL burn campaign; no campaign IDs have been configured. Each reward has its own **Claim** button, enabled only for the selected connected account on Ethereum and a positive claimable amount with supported Merkle proofs. It calls Ethereum’s Merkl Distributor (`0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae`) using the cumulative API `amount` and proofs, not the net displayed amount. Proofs and balances are refreshed before simulation; account and network are rechecked before signing. The app waits for a successful receipt and then refetches with `reloadChainId=1`. Burn and claim transactions share a lock to prevent concurrent submissions. Merkl receives the selected address and browser request; no wallet signature is requested for this lookup.

## Merkl CORS proxy

Merkl's response can omit `Access-Control-Allow-Origin` for browser requests from localhost. The app uses a same-origin `/api/merkl` route instead. Vite development and preview servers proxy it to Merkl, removing Origin, Cookie and Authorization headers from upstream requests. No CORS browser bypass or public third-party relay is used.

Production hosting must provide the equivalent reverse proxy: `/api/merkl/*` → `https://api.merkl.xyz/v4/*`. Do not forward app cookies or authorization headers. Vite's proxy is not bundled into `dist/`.

## RPC and privacy

Default RPC: `https://ethereum-rpc.publicnode.com`. Configure another Ethereum RPC through the header's **RPC** button; saved locally under `bal-burn:rpc`. Reads, simulation, and receipt polling use this endpoint; transactions go through the selected wallet. RPC providers see requests, address, and IP. Avoid putting secret API keys in a public browser app.

## Verification

`npm run build` typechecks and builds. For real transaction testing use a disposable mainnet fork and an injected wallet connected to that fork (chain ID 1), and point the app RPC at the same fork.

Burning is permanent. Never test by burning real tokens unless that loss is intentional.
