import { describe, expect, it } from 'vitest'
import { scoreCaptureFidelity } from './fidelityScoring'
import { buildFidelityExport, formatFidelityReport, serializeFidelityForMeta } from './fidelityReporting'
import type { CaptureBundleV0 } from './types'

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

describe('fidelity reporting', () => {
  it('serializes scoring into a flat meta-friendly fidelity summary', () => {
    const scoring = scoreCaptureFidelity({ capture: buildCapture() })

    const meta = serializeFidelityForMeta(scoring, {
      benchmark: { suite: 'example-button', version: 'v1' },
    })

    expect(meta.visual).toBe(scoring.dimensions.visual.score)
    expect(meta.interaction).toBe(scoring.dimensions.interaction.score)
    expect(meta.assetCompleteness).toBe(scoring.dimensions.assetCompleteness.score)
    expect(meta.structuralConfidence).toBe(scoring.dimensions.structuralConfidence.score)
    expect(meta.overall).toBe(scoring.overall.score)
    expect(meta.overallConfidence).toBe(scoring.overall.confidence)
    expect(meta.benchmark).toEqual({ suite: 'example-button', version: 'v1' })
    expect(meta.notes).toContain('heuristic-score-no-pixel-diff')
  })

  it('formats a readable fidelity report with warnings and pixel diff context', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      pixelDiff: {
        mismatchPixels: 24,
        mismatchRatio: 0.12,
        dimensionsMatch: false,
        comparedDimensions: { width: 120, height: 44 },
        baselineDimensions: { width: 120, height: 44 },
        candidateDimensions: { width: 118, height: 44 },
      },
    })

    const report = formatFidelityReport(scoring, {
      heading: 'Benchmark Summary',
      benchmark: { suite: 'example-button', version: 'v1' },
    })

    expect(report).toContain('Benchmark Summary')
    expect(report).toContain('Overall:')
    expect(report).toContain('Confidence:')
    expect(report).toContain('Dimensions: visual=')
    expect(report).toContain('Benchmark: example-button @ v1')
    expect(report).toContain('Pixel diff: ratio=0.120, pixels=24, dimensionsMatch=false')
    expect(report).toContain('Warnings: ')
  })

  it('builds paired meta and report exports from one scoring payload', () => {
    const scoring = scoreCaptureFidelity({ capture: buildCapture() })

    const exported = buildFidelityExport(scoring)

    expect(exported.meta.overall).toBe(scoring.overall.score)
    expect(exported.report).toContain('Component Snap Fidelity Report')
    expect(exported.report.endsWith('\n')).toBe(true)
  })
})
