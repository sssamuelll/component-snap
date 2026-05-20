import { defineConfig } from 'vitest/config'
import { buildDefines } from './scripts/buildMetadata'

export default defineConfig({
  define: buildDefines({
    commitSha: 'test',
    timestamp: '1970-01-01T00:00:00.000Z',
    pipelineVersion: '0.0.0-test',
  }),
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
  },
})
