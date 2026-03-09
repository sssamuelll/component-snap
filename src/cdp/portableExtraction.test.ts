import { describe, expect, it } from 'vitest'
import type { CaptureBundleV0, ReplayCapsuleV0 } from './types'
import { extractPortableFromReplayCapsule } from './portableExtraction'

const baseReplayCapsule = (): ReplayCapsuleV0 => ({
  version: '0',
  mode: 'snapshot-first',
  createdAt: '2026-03-09T10:00:00.000Z',
  snapshot: {
    page: {
      url: 'https://example.com',
      title: 'Example',
      viewport: { width: 1200, height: 800 },
      scroll: { x: 0, y: 0 },
      dpr: 2,
    },
    screenshot: { clipDataUrl: 'data:image/png;base64,clip' },
    domSnapshot: { raw: { documents: [] }, stats: { documents: 1, nodes: 10 } },
    cssGraph: {
      target: { selector: '.cta' },
      inline: { declarations: [{ name: 'display', value: 'inline-flex' }] },
      matchedRules: [
        {
          selectorList: ['.cta', 'button.cta'],
          declarations: [
            { name: 'background', value: 'linear-gradient(red, blue)' },
            { name: 'color', value: 'white', important: true },
          ],
        },
      ],
      customProperties: [{ name: '--brand', value: '#f00' }],
      keyframes: ['@keyframes pulse { from { opacity: 0.8; } to { opacity: 1; } }'],
    },
    shadowTopology: {
      roots: [
        {
          mode: 'open',
          depth: 1,
          host: { tagName: 'x-card', id: 'host-1', classList: ['shell'] },
        },
      ],
    },
    targetSubtree: {
      source: 'runtime-object',
      html: '<button class="cta"><span>Buy now</span></button>',
      nodeCount: 2,
      elementCount: 2,
      textNodeCount: 1,
      textLength: 7,
      maxDepth: 1,
    },
    resourceGraph: {
      nodes: [{ id: 'doc', kind: 'document' }],
      edges: [],
      bundler: {
        mode: 'light',
        assets: [{ nodeId: 'font-1', kind: 'font', fetchMode: 'network', required: true }],
      },
    },
  },
  timeline: { events: [] },
})

const baseCapture = (): CaptureBundleV0 => ({
  version: '0',
  captureId: 'cdp_1',
  createdAt: '2026-03-09T10:00:00.000Z',
  backend: 'cdp',
  seed: {
    requestId: 'req_1',
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    selectedSelector: '.cta',
    stableSelector: '.cta',
    targetFingerprint: {
      tagName: 'button',
      classList: ['cta'],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 1, y: 2, width: 100, height: 40 },
    },
  },
  page: baseReplayCapsule().snapshot.page,
  screenshot: baseReplayCapsule().snapshot.screenshot,
  domSnapshot: baseReplayCapsule().snapshot.domSnapshot,
  runtimeHints: {},
  replayCapsule: baseReplayCapsule(),
})

describe('extractPortableFromReplayCapsule', () => {
  it('builds capsule-driven portable artifacts with a materialized target subtree', () => {
    const result = extractPortableFromReplayCapsule(baseCapture(), '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tier).toBe('capsule')
    expect(result.artifacts.selectedSelector).toBe('.cta')
    expect(result.artifacts.css).toContain('.cta, button.cta')
    expect(result.artifacts.css).toContain('--brand: #f00')
    expect(result.artifacts.css).toContain('@keyframes pulse')
    expect(result.artifacts.html).toContain('<button class="cta"><span>Buy now</span></button>')
    expect(result.artifacts.html).toContain('component-snap-shadow-topology')
    expect(result.diagnostics.source).toBe('replay-capsule')
    expect(result.diagnostics.warnings).toContain('replay-capsule-portable-extractor-used')
    expect(result.diagnostics.confidence).toBeGreaterThan(0.4)
  })

  it('returns explicit failure for missing css graph to trigger fallback', () => {
    const capture = baseCapture()
    if (capture.replayCapsule) capture.replayCapsule.snapshot.cssGraph = undefined
    const result = extractPortableFromReplayCapsule(capture, '.fallback')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('css-graph-missing')
    expect(result.warnings).toContain('replay-capsule-css-graph-missing')
  })

  it('fails explicitly when capsule portable extraction collapses to an empty selector shell', () => {
    const capture = baseCapture()
    if (capture.replayCapsule) capture.replayCapsule.snapshot.targetSubtree = undefined
    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.reason).toBe('empty-shell-export')
    expect(result.warnings).toContain('replay-capsule-empty-shell-export')
    expect(result.warnings).toContain('replay-capsule-shadow-metadata-without-content')
  })

  it('preserves unresolved-asset warnings when capsule export succeeds from a materialized subtree', () => {
    const capture = baseCapture()
    if (capture.replayCapsule?.snapshot.resourceGraph?.bundler?.assets) {
      capture.replayCapsule.snapshot.resourceGraph.bundler.assets.push({
        nodeId: 'font-2',
        kind: 'font',
        fetchMode: 'unresolved',
        required: true,
      })
    }

    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.warnings).toContain('replay-capsule-required-assets-unresolved:1')
    expect(result.diagnostics.confidence).toBeLessThan(0.8)
  })
})
