import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ReplayViewer } from './ReplayViewer'
import type { ReplayCapsuleV0 } from '../../cdp/types'

// Required by React when using act() with createRoot in tests.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseCapsule = (screenshot: ReplayCapsuleV0['snapshot']['screenshot']): ReplayCapsuleV0 => ({
  version: '0',
  mode: 'snapshot-first',
  createdAt: '2026-03-09T10:00:00.000Z',
  snapshot: {
    page: {
      url: 'https://example.com/page',
      title: 'Example Page',
      viewport: { width: 1000, height: 600 },
      scroll: { x: 0, y: 0 },
      dpr: 2,
      userAgent: 'ua',
      colorScheme: 'light',
      language: 'en',
    },
    screenshot,
    domSnapshot: {},
    nodeMapping: {
      resolved: true,
      strategy: 'runtime-structural',
      confidence: 0.95,
      evidence: ['ok'],
      node: { nodeId: 42 },
    },
  },
  timeline: { events: [] },
  diagnostics: {},
})

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
    root = null
  }

  if (container) {
    container.remove()
    container = null
  }
})

const renderViewer = async (capsule: ReplayCapsuleV0) => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root?.render(<ReplayViewer replayCapsule={capsule} />)
  })

  return container
}

describe('ReplayViewer', () => {
  it('renders spotlight mode by default with target overlay', async () => {
    const capsule = baseCapsule({
      fullPageDataUrl: 'data:image/png;base64,full',
      clipRect: { x: 20, y: 10, width: 140, height: 80, dpr: 2 },
    })

    const node = await renderViewer(capsule)

    const stage = node.querySelector('[data-testid="replay-stage"]')
    const spotlight = node.querySelector('[data-testid="replay-spotlight"]')

    expect(stage).not.toBeNull()
    expect(spotlight).not.toBeNull()
  })

  it('uses clip screenshot when both clip and full are present', async () => {
    const capsule = baseCapsule({
      clipDataUrl: 'data:image/png;base64,clip',
      fullPageDataUrl: 'data:image/png;base64,full',
      clipRect: { x: 10, y: 12, width: 120, height: 64, dpr: 2 },
    })

    const node = await renderViewer(capsule)
    const img = node.querySelector('[data-testid="replay-image"]') as HTMLImageElement

    expect(img.src).toContain('data:image/png;base64,clip')
    expect(node.textContent).toContain('image: clip')
  })

  it('switches to crop mode and applies CSS translate crop for full screenshot fallback', async () => {
    const capsule = baseCapsule({
      fullPageDataUrl: 'data:image/png;base64,full',
      clipRect: { x: 44, y: 30, width: 180, height: 70, dpr: 1 },
    })

    const node = await renderViewer(capsule)
    const cropButton = Array.from(node.querySelectorAll('button')).find((button) => button.textContent === 'crop')
    expect(cropButton).toBeDefined()

    await act(async () => {
      cropButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const img = node.querySelector('[data-testid="replay-image"]') as HTMLImageElement
    expect(img.style.transform).toContain('translate(')
    expect(img.style.transform).toContain('-14px')
    expect(img.style.transform).toContain('-10px')
  })

  it('shows warning state when screenshot artifacts are missing', async () => {
    const capsule = baseCapsule({})
    const node = await renderViewer(capsule)

    expect(node.textContent).toContain('No screenshot artifact available.')
    const warnings = node.querySelector('[data-testid="replay-warnings"]')
    expect(warnings?.textContent).toContain('No screenshot available in replay capsule.')
  })
})
