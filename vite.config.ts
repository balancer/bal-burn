import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

const merklProxy: Record<string, ProxyOptions> = {
  '/api/merkl': {
    target: 'https://api.merkl.xyz',
    changeOrigin: true,
    rewrite: path => path.replace(/^\/api\/merkl/, '/v4'),
    configure: proxy => {
      proxy.on('proxyReq', request => {
        request.removeHeader('origin')
        request.removeHeader('cookie')
        request.removeHeader('authorization')
      })
    },
  },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 3003, strictPort: true, proxy: merklProxy, watch: { usePolling: true } },
  preview: { proxy: merklProxy },
})
