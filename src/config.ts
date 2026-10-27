import { parseAbi } from 'viem'
// frontend-monorepo/packages/lib/config/networks/mainnet.ts: tokens.addresses.bal
export const BAL = '0xba100000625a3754423978a60c9317c58a424e3d' as const
export const DEFAULT_RPC = 'https://ethereum-rpc.publicnode.com'
export const EXPLORER = 'https://etherscan.io'
// Verified BalancerGovernanceToken ABI on Etherscan. burn destroys msg.sender's tokens.
export const BAL_ABI = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)', 'function burn(uint256 amount)'])
// frontend-monorepo/packages/lib/config/networks/mainnet.ts: merkl.claims
export const MERKL_DISTRIBUTOR = '0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae' as const
export const MERKL_ABI = parseAbi(['function claim(address[] users, address[] tokens, uint256[] amounts, bytes32[][] proofs)'])
