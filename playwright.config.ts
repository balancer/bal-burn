import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: './e2e', fullyParallel: true, use: { baseURL: 'http://localhost:3003', headless: true }, webServer: { command: 'npm run dev', url: 'http://localhost:3003', reuseExistingServer: !process.env.CI } })
