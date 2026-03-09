import { describe, expect, it } from 'vitest'
import type { CaptureBundleV0 } from './types'
import { scoreCaptureFidelity } from './fidelityScoring'

const buildCapture = (): CaptureBundleV0 => ({
  version: '0',
  captureId: 'cdp_1',
  createdAt: '2026-03-09T12:00:00.000Z',
  backend: 'cdp',
  seed: {
    requestId: 'req_1',
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    selectedSelector: '.cta',
    targetFingerprint: {
      tagName: 'button',
      classList: ['cta'],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 1, y: 2, width: 120, height: 44 },
    },
    actionTraceEvents: [{ type: 'click', atMs: 10, selector: '.cta', tagName: 'button' }],
    mutationTraceEvents: [
      {
        type: 'attributes',
        atMs: 16,
        selector: '.cta',
        tagName: 'button',
        attributeName: 'aria-pressed',
        actionRef: { type: 'click', atMs: 10 },
      },
    ],
  },
  page: {
    url: 'https://example.com',
    title: 'Example',
    viewport: { width: 1200, height: 800 },
    scroll: { x: 0, y: 0 },
    dpr: 2,
  },
  screenshot: {
    fullPageDataUrl: 'data:image/png;base64,full',
    clipDataUrl: 'data:image/png;base64,clip',
    clipRect: { x: 1, y: 2, width: 120, height: 44, dpr: 2 },
  },
  domSnapshot: { raw: { documents: [] }, stats: { documents: 1, nodes: 150 } },
  runtimeHints: {},
  nodeMapping: {
    resolved: true,
    confidence: 0.93,
    strategy: 'runtime-structural',
    evidence: ['mapped'],
    node: { nodeId: 10, backendNodeId: 20 },
  },
  cssGraph: {
    target: { nodeId: 10, selector: '.cta' },
    inline: { declarations: [{ name: 'display', value: 'inline-flex' }] },
    matchedRules: [{ selectorList: ['.cta'], declarations: [{ name: 'color', value: '#fff' }] }],
    keyframes: ['@keyframes pulse { from { opacity: 0.9; } to { opacity: 1; } }'],
    diagnostics: { ruleCount: 1 },
  },
  shadowTopology: {
    roots: [{ mode: 'open', depth: 1, host: { tagName: 'x-card' } }],
    diagnostics: { totalShadowRoots: 1, openShadowRootCount: 1 },
  },
  resourceGraph: {
    nodes: [{ id: 'doc', kind: 'document' }, { id: 'font_1', kind: 'font' }],
    edges: [],
    bundler: {
      mode: 'light',
      assets: [
        { nodeId: 'font_1', kind: 'font', fetchMode: 'network', required: true },
        { nodeId: 'img_1', kind: 'image', fetchMode: 'inline-data', required: false },
      ],
    },
  },
  replayCapsule: {
    version: '0',
    mode: 'snapshot-first',
    createdAt: '2026-03-09T12:00:00.000Z',
    snapshot: {
      page: {
        url: 'https://example.com',
        title: 'Example',
        viewport: { width: 1200, height: 800 },
        scroll: { x: 0, y: 0 },
        dpr: 2,
      },
      screenshot: {
        fullPageDataUrl: 'data:image/png;base64,full',
        clipDataUrl: 'data:image/png;base64,clip',
        clipRect: { x: 1, y: 2, width: 120, height: 44, dpr: 2 },
      },
      domSnapshot: { raw: { documents: [] }, stats: { documents: 1, nodes: 150 } },
      nodeMapping: {
        resolved: true,
        confidence: 0.93,
        strategy: 'runtime-structural',
        evidence: ['mapped'],
        node: { nodeId: 10, backendNodeId: 20 },
      },
      cssGraph: {
        target: { nodeId: 10, selector: '.cta' },
        inline: { declarations: [{ name: 'display', value: 'inline-flex' }] },
        matchedRules: [{ selectorList: ['.cta'], declarations: [{ name: 'color', value: '#fff' }] }],
        keyframes: ['@keyframes pulse { from { opacity: 0.9; } to { opacity: 1; } }'],
        diagnostics: { ruleCount: 1 },
      },
      shadowTopology: {
        roots: [{ mode: 'open', depth: 1, host: { tagName: 'x-card' } }],
        diagnostics: { totalShadowRoots: 1, openShadowRootCount: 1 },
      },
      resourceGraph: {
        nodes: [{ id: 'doc', kind: 'document' }, { id: 'font_1', kind: 'font' }],
        edges: [],
        bundler: {
          mode: 'light',
          assets: [
            { nodeId: 'font_1', kind: 'font', fetchMode: 'network', required: true },
            { nodeId: 'img_1', kind: 'image', fetchMode: 'inline-data', required: false },
          ],
        },
      },
    },
    timeline: {
      events: [
        {
          kind: 'action-trace',
          atMs: 10,
          action: { type: 'click', atMs: 10, selector: '.cta', tagName: 'button' },
        },
        {
          kind: 'mutation',
          atMs: 16,
          mutation: {
            type: 'attributes',
            atMs: 16,
            selector: '.cta',
            tagName: 'button',
            attributeName: 'aria-pressed',
            actionRef: { type: 'click', atMs: 10 },
          },
        },
      ],
    },
    diagnostics: { timelineEventCount: 2 },
  },
})

describe('scoreCaptureFidelity', () => {
  it('scores replay-backed captures with usable artifacts as high confidence heuristics', () => {
    const scoring = scoreCaptureFidelity({ capture: buildCapture() })

    expect(scoring.overall.score).toBeGreaterThan(0.7)
    expect(scoring.overall.confidence).toBeGreaterThan(0.65)
    expect(scoring.dimensions.visual.score).toBeGreaterThan(0.75)
    expect(scoring.dimensions.interaction.score).toBeGreaterThan(0.8)
    expect(scoring.warnings).not.toContain('visual-screenshot-missing')
  })

  it('degrades interaction and structural signals when timeline and mapping are absent', () => {
    const capture = buildCapture()
    if (capture.replayCapsule) capture.replayCapsule.timeline.events = []
    capture.nodeMapping = undefined
    if (capture.replayCapsule) capture.replayCapsule.snapshot.nodeMapping = undefined
    capture.seed.targetFingerprint = undefined

    const scoring = scoreCaptureFidelity({ capture })
    expect(scoring.dimensions.interaction.score).toBeLessThan(0.3)
    expect(scoring.dimensions.structuralConfidence.score).toBeLessThan(0.65)
    expect(scoring.warnings).toContain('interaction-timeline-empty')
    expect(scoring.warnings).toContain('structure-target-fingerprint-missing')
  })

  it('applies portable fallback diagnostics to overall confidence without pretending pixel parity', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'portable-fallback',
        warnings: ['portable-fallback-no-keyframes-captured'],
        confidencePenalty: 0.65,
      },
    })

    expect(scoring.overall.score).toBeLessThan(0.83)
    expect(scoring.overall.confidence).toBeLessThanOrEqual(0.8)
    expect(scoring.warnings).toContain('fidelity-portable-source:portable-fallback')
    expect(scoring.warnings).toContain('fidelity-portable-diagnostics:portable-fallback-no-keyframes-captured')
  })

  it('uses measured pixel diff input to penalize visual fidelity', () => {
    const pixelDiff = {
      mismatchPixels: 100,
      mismatchRatio: 0.5,
      dimensionsMatch: true,
      comparedDimensions: { width: 20, height: 10 },
      baselineDimensions: { width: 20, height: 10 },
      candidateDimensions: { width: 20, height: 10 },
    }

    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      pixelDiff,
    })

    expect(scoring.pixelDiff).toEqual(pixelDiff)
    expect(scoring.dimensions.visual.score).toBeLessThan(0.8)
    expect(scoring.warnings).toContain('visual-pixel-diff-high-mismatch')
    expect(scoring.notes).not.toContain('heuristic-score-no-pixel-diff')
  })
})
