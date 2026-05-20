import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'
import { buildDefines, collectBuildMetadata } from './scripts/buildMetadata'

export default defineConfig({
  define: buildDefines(collectBuildMetadata()),
  plugins: [react(), crx({ manifest })],
})
