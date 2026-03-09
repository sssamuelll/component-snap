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
  const buildResourceGraph = vi.fn()
  const buildReplayCapsule = vi.fn()
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
    buildResourceGraph,
    buildReplayCapsule,
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

vi.mock('./resourceGraph', () => ({
  buildResourceGraph: mocks.buildResourceGraph,
}))

vi.mock('./replayCapsule', () => ({
  buildReplayCapsule: mocks.buildReplayCapsule,
}))

import { runCDPCapture } from './orchestrator'

const createSeed = (overrides?: Partial<CaptureSeed>): CaptureSeed => ({
  requestId: 'req-1',
  tabId: 23,
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  selectedSelector: '.target',
  ...overrides,
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

    mocks.buildResourceGraph.mockReturnValue({
      resourceGraph: {
        nodes: [{ id: 'res_0', kind: 'document', source: 'capture', url: 'https://example.com', label: 'document' }],
        edges: [],
      },
      warnings: [],
    })
    mocks.buildReplayCapsule.mockReturnValue({
      replayCapsule: {
        version: '0',
        mode: 'snapshot-first',
        createdAt: '2026-03-09T12:00:00.000Z',
        snapshot: {
          page: {
            url: 'https://example.com',
            title: 'Example',
            viewport: { width: 1200, height: 800 },
            scroll: { x: 0, y: 10 },
            dpr: 2,
            userAgent: 'ua',
            colorScheme: 'light',
            language: 'en',
          },
          screenshot: {
            fullPageDataUrl: 'data:image/png;base64,abc',
          },
          domSnapshot: {
            raw: { documents: [] },
            stats: { documents: 0, nodes: 0 },
          },
          resourceGraph: {
            nodes: [{ id: 'res_0', kind: 'document', source: 'capture', label: 'document' }],
            edges: [],
          },
        },
        timeline: {
          events: [],
        },
        diagnostics: {
          timelineEventCount: 0,
        },
      },
      warnings: ['replay-capsule-empty-timeline'],
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
    expect(bundle.resourceGraph?.nodes[0]?.kind).toBe('document')
    expect(bundle.replayCapsule?.mode).toBe('snapshot-first')
    expect((bundle.debug?.warnings || []).join(' ')).toContain('replay_capsule: replay-capsule-empty-timeline')
  })

  it('maps action traces from seed into replay capsule timeline input', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })

    await runCDPCapture(
      createSeed({
        actionTraceEvents: [
          { type: 'click', atMs: 40.2, selector: '.target', tagName: 'button' },
          { type: 'keyboard', atMs: 12.9, key: 'Enter', code: 'Enter' },
        ],
      }),
    )

    expect(mocks.buildReplayCapsule).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineEvents: [
          expect.objectContaining({
            kind: 'action-trace',
            atMs: 13,
            action: expect.objectContaining({ type: 'keyboard', atMs: 13 }),
          }),
          expect.objectContaining({
            kind: 'action-trace',
            atMs: 40,
            action: expect.objectContaining({ type: 'click', atMs: 40, selector: '.target' }),
          }),
        ],
      }),
    )
  })

  it('merges action and mutation traces into replay capsule timeline input', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })

    await runCDPCapture(
      createSeed({
        actionTraceEvents: [{ type: 'input', atMs: 12.2, selector: 'input.email', tagName: 'input', value: 's' }],
        mutationTraceEvents: [
          {
            type: 'attributes',
            atMs: 12.6,
            selector: 'input.email',
            tagName: 'input',
            attributeName: 'value',
            valuePreview: 's',
            actionRef: { type: 'input', atMs: 12.2 },
          },
        ],
      }),
    )

    expect(mocks.buildReplayCapsule).toHaveBeenCalledWith(
      expect.objectContaining({
        timelineEvents: [
          expect.objectContaining({
            kind: 'action-trace',
            atMs: 12,
            action: expect.objectContaining({ type: 'input', atMs: 12 }),
          }),
          expect.objectContaining({
            kind: 'mutation',
            atMs: 13,
            mutation: expect.objectContaining({
              type: 'attributes',
              atMs: 13,
              attributeName: 'value',
            }),
            payload: expect.objectContaining({
              transition: 'input-sync',
            }),
          }),
        ],
      }),
    )
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
    expect(bundle.resourceGraph).toBeDefined()
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

  it('passes through resource graph warnings as debug warnings', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })
    mocks.buildResourceGraph.mockReturnValue({
      resourceGraph: {
        nodes: [{ id: 'res_0', kind: 'document', source: 'capture', label: 'document' }],
        edges: [],
      },
      warnings: ['resource-graph-empty'],
    })

    const bundle = await runCDPCapture(createSeed())
    expect(bundle.resourceGraph?.nodes).toHaveLength(1)
    expect((bundle.debug?.warnings || []).join(' ')).toContain('resource_graph: resource-graph-empty')
  })

  it('passes through replay capsule warnings as debug warnings', async () => {
    mocks.mapTargetToCDPNode.mockResolvedValue({
      resolved: false,
      confidence: 0.1,
      strategy: 'unresolved',
      evidence: ['none'],
    })
    mocks.buildReplayCapsule.mockReturnValue({
      replayCapsule: {
        version: '0',
        mode: 'snapshot-first',
        createdAt: '2026-03-09T12:00:00.000Z',
        snapshot: {
          page: {
            url: 'https://example.com',
            title: 'Example',
            viewport: { width: 1200, height: 800 },
            scroll: { x: 0, y: 10 },
            dpr: 2,
            userAgent: 'ua',
            colorScheme: 'light',
            language: 'en',
          },
          screenshot: {},
          domSnapshot: {},
        },
        timeline: { events: [] },
        diagnostics: {
          missingArtifacts: ['resourceGraph'],
          timelineEventCount: 0,
          warnings: ['replay-capsule-missing-artifacts:resourceGraph', 'replay-capsule-empty-timeline'],
        },
      },
      warnings: ['replay-capsule-missing-artifacts:resourceGraph', 'replay-capsule-empty-timeline'],
    })

    const bundle = await runCDPCapture(createSeed())
    expect(bundle.replayCapsule?.diagnostics?.missingArtifacts).toEqual(['resourceGraph'])
    expect((bundle.debug?.warnings || []).join(' ')).toContain(
      'replay_capsule: replay-capsule-missing-artifacts:resourceGraph',
    )
  })
})
