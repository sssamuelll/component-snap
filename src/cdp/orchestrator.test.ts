import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureSeed } from './types'

const mocks = vi.hoisted(() => {
  const attach = vi.fn(async () => undefined)
  const detach = vi.fn(async () => undefined)
  const send = vi.fn()
  const mapTargetToCDPNode = vi.fn()
  const captureRuntimeEnvironment = vi.fn()
  const captureScreenshots = vi.fn()
  const captureDomSnapshot = vi.fn()
  const captureCSSProvenanceGraph = vi.fn()
  const captureShadowTopology = vi.fn()
  return {
    attach,
    detach,
    send,
    mapTargetToCDPNode,
    captureRuntimeEnvironment,
    captureScreenshots,
    captureDomSnapshot,
    captureCSSProvenanceGraph,
    captureShadowTopology,
  }
})

vi.mock('./client', () => ({
  createCDPClientForTab: () => ({
    attach: mocks.attach,
    detach: mocks.detach,
    send: mocks.send,
  }),
}))

vi.mock('./nodeMapping', () => ({
  mapTargetToCDPNode: mocks.mapTargetToCDPNode,
}))

vi.mock('./runtimeCapture', () => ({
  captureRuntimeEnvironment: mocks.captureRuntimeEnvironment,
}))

vi.mock('./pageCapture', () => ({
  captureScreenshots: mocks.captureScreenshots,
}))

vi.mock('./domSnapshotCapture', () => ({
  captureDomSnapshot: mocks.captureDomSnapshot,
}))

vi.mock('./cssCapture', () => ({
  captureCSSProvenanceGraph: mocks.captureCSSProvenanceGraph,
}))

vi.mock('./shadowTopology', () => ({
  captureShadowTopology: mocks.captureShadowTopology,
}))

import { runCDPCapture } from './orchestrator'

const createSeed = (): CaptureSeed => ({
  requestId: 'req-1',
  tabId: 23,
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  selectedSelector: '.target',
})

describe('runCDPCapture css integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.captureRuntimeEnvironment.mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      viewport: { width: 1200, height: 800 },
      scroll: { x: 0, y: 10 },
      dpr: 2,
      userAgent: 'ua',
      colorScheme: 'light',
      language: 'en',
      runtimeHints: {
        shadowDomPresent: false,
        iframePresent: false,
        canvasPresent: false,
        webglPresent: false,
      },
    })

    mocks.captureScreenshots.mockResolvedValue({
      fullPageDataUrl: 'data:image/png;base64,abc',
      clipDataUrl: undefined,
      clipRect: undefined,
    })

    mocks.captureDomSnapshot.mockResolvedValue({
      raw: { documents: [] },
      stats: { documents: 0, nodes: 0 },
    })

    mocks.captureShadowTopology.mockResolvedValue({
      shadowTopology: { roots: [], diagnostics: { totalShadowRoots: 0 } },
      warnings: [],
    })
  })

  it('attaches cssGraph when node mapping resolves a nodeId', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: true,
      confidence: 0.95,
      strategy: 'runtime-structural',
      evidence: ['resolved'],
      node: { nodeId: 44, backendNodeId: 77 },
    })
    mocks.captureCSSProvenanceGraph.mockResolvedValue({
      cssGraph: {
        target: { nodeId: 44 },
        matchedRules: [],
      },
      warnings: [],
    })

    const bundle = await runCDPCapture(createSeed())
    expect(mocks.captureCSSProvenanceGraph).toHaveBeenCalledWith(expect.anything(), {
      nodeId: 44,
      backendNodeId: 77,
      selector: '.target',
    })
    expect(bundle.cssGraph?.target.nodeId).toBe(44)
    expect(bundle.shadowTopology?.diagnostics?.totalShadowRoots).toBe(0)
  })

  it('fails soft with warning when node mapping is unresolved', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })

    const bundle = await runCDPCapture(createSeed())
    expect(mocks.captureCSSProvenanceGraph).not.toHaveBeenCalled()
    expect(bundle.cssGraph).toBeUndefined()
    expect((bundle.debug?.warnings || []).join(' ')).toContain('css_capture_skipped: node-unresolved')
  })

  it('passes through shadow topology warnings as debug warnings', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })
    mocks.captureShadowTopology.mockResolvedValue({
      shadowTopology: {
        roots: [{ mode: 'closed', depth: 1, host: { nodeName: 'APP-SHELL', tagName: 'app-shell' } }],
        diagnostics: { totalShadowRoots: 1, closedShadowRootCount: 1 },
      },
      warnings: ['closed-shadow-root-unavailable'],
    })

    const bundle = await runCDPCapture(createSeed())
    expect(bundle.shadowTopology?.diagnostics?.closedShadowRootCount).toBe(1)
    expect((bundle.debug?.warnings || []).join(' ')).toContain('shadow_topology: closed-shadow-root-unavailable')
  })
})
