import { describe, expect, it } from 'vitest'
import { buildReplayCapsule } from './replayCapsule'

const page = {
  url: 'https://example.com',
  title: 'Example',
  viewport: { width: 1200, height: 800 },
  scroll: { x: 0, y: 0 },
  dpr: 2,
  userAgent: 'ua',
  colorScheme: 'light' as const,
  language: 'en',
}

describe('buildReplayCapsule', () => {
  it('wraps existing snapshot artifacts and keeps timeline typed but empty', () => {
    const result = buildReplayCapsule({
      createdAt: '2026-03-09T10:00:00.000Z',
      page,
      screenshot: { fullPageDataUrl: 'data:image/png;base64,abc' },
      domSnapshot: { raw: { documents: [] }, stats: { documents: 0, nodes: 0 } },
      nodeMapping: {
        resolved: true,
        confidence: 0.9,
        strategy: 'runtime-structural',
        evidence: ['mapped'],
        node: { nodeId: 42, backendNodeId: 24 },
      },
      cssGraph: {
        target: { nodeId: 42 },
        matchedRules: [],
      },
      shadowTopology: { roots: [], diagnostics: { totalShadowRoots: 0 } },
      targetSubtree: {
        source: 'runtime-object',
        html: '<button class="cta">Buy now</button>',
        nodeCount: 1,
        elementCount: 1,
        textNodeCount: 1,
        textLength: 7,
        maxDepth: 0,
      },
      resourceGraph: { nodes: [{ id: 'res_0', kind: 'document' }], edges: [] },
    })

    expect(result.replayCapsule.mode).toBe('snapshot-first')
    expect(result.replayCapsule.snapshot.page.url).toBe('https://example.com')
    expect(result.replayCapsule.timeline.events).toEqual([])
    expect(result.replayCapsule.diagnostics?.timelineEventCount).toBe(0)
    expect(result.warnings).toContain('replay-capsule-empty-timeline')
  })

  it('adds diagnostics warnings when key artifacts are missing', () => {
    const result = buildReplayCapsule({
      createdAt: '2026-03-09T10:00:00.000Z',
      page,
      screenshot: {},
      domSnapshot: {},
    })

    expect(result.warnings).toContain('replay-capsule-empty-timeline')
    expect(result.warnings.join(' ')).toContain('replay-capsule-missing-artifacts:')
    expect(result.replayCapsule.diagnostics?.missingArtifacts).toEqual([
      'screenshot',
      'domSnapshot',
      'nodeMapping',
      'cssGraph',
      'shadowTopology',
      'targetSubtree',
      'resourceGraph',
    ])
  })

  it('keeps typed action trace events in timeline', () => {
    const result = buildReplayCapsule({
      createdAt: '2026-03-09T10:00:00.000Z',
      page,
      screenshot: { fullPageDataUrl: 'data:image/png;base64,abc' },
      domSnapshot: { raw: { documents: [] }, stats: { documents: 0, nodes: 0 } },
      timelineEvents: [
        {
          kind: 'action-trace',
          atMs: 21,
          label: 'Click',
          action: { type: 'click', atMs: 21, selector: '.cta', tagName: 'button' },
          payload: { selector: '.cta' },
        },
      ],
    })

    expect(result.replayCapsule.timeline.events).toEqual([
      {
        kind: 'action-trace',
        atMs: 21,
        label: 'Click',
        action: { type: 'click', atMs: 21, selector: '.cta', tagName: 'button' },
        payload: { selector: '.cta' },
      },
    ])
    expect(result.replayCapsule.diagnostics?.timelineEventCount).toBe(1)
    expect(result.warnings).not.toContain('replay-capsule-empty-timeline')
  })
})
