import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Component Snap',
  description: 'Capture and inspect UI components from any page.',
  version: '0.0.1',
  action: {
    default_title: 'Component Snap',
    default_popup: 'index.html',
  },
  permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'downloads'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content.ts'],
      run_at: 'document_idle',
    },
  ],
})
