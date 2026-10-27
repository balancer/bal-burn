import { parseAbi } from 'viem'
// frontend-monorepo/packages/lib/config/networks/mainnet.ts: tokens.addresses.bal
export const BAL = '0xba100000625a3754423978a60c9317c58a424e3d' as const
export const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com'
export const EXPLORER = 'https://etherscan.io'
// Verified BalancerGovernanceToken ABI on Etherscan. burn destroys msg.sender's tokens.
export const BAL_ABI = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)', 'function burn(uint256 amount)'])
