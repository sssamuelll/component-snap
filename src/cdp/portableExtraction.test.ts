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
  it('fails explicitly when capsule portable extraction collapses to an empty selector shell', () => {
    const result = extractPortableFromReplayCapsule(baseCapture(), '.fallback')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.reason).toBe('empty-shell-export')
    expect(result.warnings).toContain('replay-capsule-empty-shell-export')
    expect(result.warnings).toContain('replay-capsule-shadow-metadata-without-content')
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

  it('preserves unresolved-asset warnings when capsule export collapses and must fall back', () => {
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
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.warnings).toContain('replay-capsule-required-assets-unresolved:1')
    expect(result.warnings).toContain('replay-capsule-empty-shell-export')
  })
})
