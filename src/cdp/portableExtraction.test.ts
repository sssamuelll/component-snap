import { describe, expect, it } from 'vitest'
import { LICHESS_LIKE_SCENE_HTML } from './__fixtures__/lichessLikeScene'
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
      html: '<rpl-tooltip data-csnap="1"><button class="cta"><span>Buy now</span></button></rpl-tooltip>',
      nodeCount: 3,
      elementCount: 3,
      textNodeCount: 1,
      textLength: 7,
      maxDepth: 2,
    },
    candidateSubtree: {
      source: 'reconstructed-subtree',
      html: '<button class="cta"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="12%" y="12%" width="76%" height="76%" rx="18%"></rect></svg><span>Buy now</span></button>',
      removedTagCounts: { 'rpl-tooltip': 1 },
      removedAttributeCounts: { 'data-csnap': 1 },
      collapsedWrapperCount: 1,
      compactedSvgCount: 1,
      nodeCount: 4,
      textLength: 7,
      quality: {
        anchorNodeCount: 2,
        wrapperNodeCount: 1,
        textNodeCount: 1,
        anchorDensity: 0.5,
        wrapperDensity: 0.25,
        wrapperToAnchorRatio: 0.5,
        profile: 'anchor-dense',
      },
      reconstruction: {
        mode: 'semantic',
        preservedEmptyScenePrimitiveCount: 0,
        preservedCustomElementCount: 0,
        preservedLayeredElementCount: 0,
      },
      warnings: [
        'target-candidate-collapsed-wrappers:1',
        'target-candidate-compacted-svgs:1',
        'target-candidate-noise-attributes-removed',
        'target-candidate-reconstruction:semantic',
        'target-candidate-profile:anchor-dense',
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
  it('builds capsule-driven portable artifacts with a materialized target subtree', () => {
    const result = extractPortableFromReplayCapsule(baseCapture(), '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.tier).toBe('capsule')
    expect(result.artifacts.selectedSelector).toBe('.cta')
    expect(result.artifacts.rootSelector).toBe('[data-csnap-root="true"]')
    expect(result.artifacts.js).toContain('const rootSelector = "[data-csnap-root=\\"true\\"]";')
    expect(result.artifacts.css).toContain('.cta, button.cta')
    expect(result.artifacts.css).toContain('--brand: #f00')
    expect(result.artifacts.css).toContain('@keyframes pulse')
    expect(result.artifacts.html).toContain('<div data-csnap-root="true" data-csnap-capsule-root="true" data-csnap-selector=".cta" class="cta"><button class="cta"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect')
    expect(result.artifacts.html).not.toContain('<rpl-tooltip')
    expect(result.artifacts.html).not.toContain('<path')
    expect(result.artifacts.html).toContain('component-snap-shadow-topology')
    expect(result.diagnostics.source).toBe('replay-capsule')
    expect(result.diagnostics.warnings).toContain('replay-capsule-portable-extractor-used')
    expect(result.diagnostics.warnings).toContain('replay-capsule-candidate-subtree-used')
    expect(result.diagnostics.warnings).toContain('replay-capsule-rendered-elements:5')
    expect(result.diagnostics.warnings).toContain('replay-capsule-candidate-subtree:target-candidate-compacted-svgs:1')
    expect(result.diagnostics.warnings).toContain('replay-capsule-candidate-subtree:target-candidate-profile:anchor-dense')
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
    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = undefined
      capture.replayCapsule.snapshot.candidateSubtree = undefined
    }
    capture.targetSubtree = undefined
    capture.candidateSubtree = undefined
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

  it('prefers the fuller target subtree when a semantic candidate loses wrapper integrity', () => {
    const capture = baseCapture()
    capture.seed.selectedSelector = 'form[role="search"]'
    capture.seed.stableSelector = 'form[role="search"]'
    capture.seed.targetFingerprint = {
      tagName: 'div',
      classList: ['A8SBwf'],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 1, y: 2, width: 688, height: 146 },
      promotedSelectedSelector: 'form[role="search"]',
      promotedStableSelector: 'form[role="search"]',
    }
    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = {
        source: 'runtime-object',
        html: '<form role="search"><div class="A8SBwf"><div class="RNNXgb"><textarea id="q"></textarea><button type="submit"></button></div></div></form>',
        nodeCount: 5,
        elementCount: 5,
        textNodeCount: 0,
        textLength: 0,
        maxDepth: 4,
      }
      capture.replayCapsule.snapshot.candidateSubtree = {
        source: 'reconstructed-subtree',
        html: '<textarea id="q"></textarea><button type="submit"></button>',
        removedTagCounts: {},
        removedAttributeCounts: {},
        collapsedWrapperCount: 2,
        compactedSvgCount: 0,
        nodeCount: 2,
        textLength: 0,
        quality: {
          anchorNodeCount: 2,
          wrapperNodeCount: 0,
          textNodeCount: 0,
          anchorDensity: 1,
          wrapperDensity: 0,
          wrapperToAnchorRatio: 0,
          profile: 'anchor-dense',
        },
        reconstruction: {
          mode: 'semantic',
          preservedEmptyScenePrimitiveCount: 0,
          preservedCustomElementCount: 0,
          preservedLayeredElementCount: 0,
        },
        warnings: ['target-candidate-collapsed-wrappers:2', 'target-candidate-reconstruction:semantic'],
      }
    }

    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.artifacts.html).toContain('<form role="search" data-csnap-root="true" data-csnap-capsule-root="true" data-csnap-selector="form[role=&quot;search&quot;]">')
    expect(result.artifacts.html).toContain('class="A8SBwf"')
    expect(result.artifacts.html).toContain('class="RNNXgb"')
    expect(result.diagnostics.warnings).toContain('replay-capsule-target-subtree-preferred-for-wrapper-integrity')
    expect(result.diagnostics.warnings).toContain('replay-capsule-preservation-reason:semantic-wrapper-hints-recovered')
    expect(result.diagnostics.warnings).toContain('replay-capsule-preservation-reason:semantic-wrapper-depth-recovered:3')
  })

  it('materializes the promoted export root when subtree html only contains inner content', () => {
    const capture = baseCapture()
    capture.seed.selectedSelector = 'form[role="search"]'
    capture.seed.stableSelector = 'form[role="search"]'
    capture.seed.targetFingerprint = {
      tagName: 'div',
      classList: ['A8SBwf'],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 1, y: 2, width: 100, height: 40 },
      promotedSelectedSelector: 'form[role="search"]',
      promotedStableSelector: 'form[role="search"]',
    }
    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = {
        source: 'runtime-object',
        html: '<button type="button"></button><textarea id="q"></textarea>',
        nodeCount: 2,
        elementCount: 2,
        textNodeCount: 0,
        textLength: 0,
        maxDepth: 1,
      }
      capture.replayCapsule.snapshot.candidateSubtree = {
        source: 'reconstructed-subtree',
        html: '<button type="button"></button><textarea id="q"></textarea>',
        removedTagCounts: {},
        removedAttributeCounts: {},
        collapsedWrapperCount: 1,
        compactedSvgCount: 0,
        nodeCount: 2,
        textLength: 0,
        quality: {
          anchorNodeCount: 1,
          wrapperNodeCount: 1,
          textNodeCount: 0,
          anchorDensity: 0.5,
          wrapperDensity: 0.5,
          wrapperToAnchorRatio: 1,
          profile: 'anchor-dense',
        },
        reconstruction: {
          mode: 'semantic',
          preservedEmptyScenePrimitiveCount: 0,
          preservedCustomElementCount: 0,
          preservedLayeredElementCount: 0,
        },
        warnings: ['target-candidate-collapsed-wrappers:1'],
      }
    }

    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.artifacts.html).toContain('<form data-csnap-root="true" data-csnap-capsule-root="true" data-csnap-selector="form[role=&quot;search&quot;]"><button type="button"></button><textarea id="q"></textarea></form>')
  })

  it('prefers the fuller target subtree when a render-scene candidate loses frame-chain hints', () => {
    const capture = baseCapture()
    capture.seed.selectedSelector = 'div.puzzle__board.main-board'
    capture.seed.stableSelector = 'div.puzzle__board.main-board'
    capture.seed.targetFingerprint = {
      tagName: 'cg-board',
      classList: [],
      attributeHints: [],
      ancestry: [],
      boundingBox: { x: 1, y: 2, width: 320, height: 320 },
      promotedSelectedSelector: 'div.puzzle__board.main-board',
      promotedStableSelector: 'div.puzzle__board.main-board',
    }

    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = {
        source: 'runtime-object',
        html: '<div class="puzzle__board main-board"><div class="cg-wrap"><cg-container><cg-board><piece class="white king"></piece></cg-board></cg-container></div></div>',
        nodeCount: 5,
        elementCount: 5,
        textNodeCount: 0,
        textLength: 0,
        maxDepth: 4,
      }
      capture.replayCapsule.snapshot.candidateSubtree = {
        source: 'reconstructed-subtree',
        html: '<cg-board><piece class="white king"></piece></cg-board>',
        removedTagCounts: {},
        removedAttributeCounts: {},
        collapsedWrapperCount: 2,
        compactedSvgCount: 0,
        nodeCount: 2,
        textLength: 0,
        quality: {
          anchorNodeCount: 1,
          wrapperNodeCount: 2,
          textNodeCount: 0,
          anchorDensity: 0.5,
          wrapperDensity: 1,
          wrapperToAnchorRatio: 2,
          profile: 'scene-like',
        },
        reconstruction: {
          mode: 'scene-preserving',
          preservedEmptyScenePrimitiveCount: 1,
          preservedCustomElementCount: 1,
          preservedLayeredElementCount: 1,
        },
        warnings: ['target-candidate-scene-like-subtree', 'target-candidate-reconstruction:scene-preserving'],
      }
    }

    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.artifacts.html).toContain('class="puzzle__board main-board"')
    expect(result.artifacts.html).toContain('class="cg-wrap"')
    expect(result.diagnostics.warnings).toContain('replay-capsule-target-subtree-preferred-for-frame-integrity')
    expect(result.diagnostics.warnings).toContain('replay-capsule-preservation-reason:frame-chain-selector-hint-recovered')
    expect(result.diagnostics.warnings).toContain('replay-capsule-preservation-reason:scene-frame-hints-recovered')
  })

  it('surfaces scene-preserving candidate exports for board-like captures', () => {
    const capture = baseCapture()
    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = {
        source: 'runtime-object',
        html: LICHESS_LIKE_SCENE_HTML,
        nodeCount: 18,
        elementCount: 18,
        textNodeCount: 3,
        textLength: 3,
        maxDepth: 6,
      }
      capture.replayCapsule.snapshot.candidateSubtree = {
        source: 'reconstructed-subtree',
        html: LICHESS_LIKE_SCENE_HTML,
        removedTagCounts: {},
        removedAttributeCounts: {},
        collapsedWrapperCount: 0,
        compactedSvgCount: 0,
        nodeCount: 18,
        textLength: 3,
        quality: {
          anchorNodeCount: 1,
          wrapperNodeCount: 4,
          textNodeCount: 3,
          anchorDensity: 0.056,
          wrapperDensity: 0.222,
          profile: 'scene-like',
        },
        reconstruction: {
          mode: 'scene-preserving',
          preservedEmptyScenePrimitiveCount: 6,
          preservedCustomElementCount: 2,
          preservedLayeredElementCount: 6,
        },
        warnings: [
          'target-candidate-scene-like-subtree',
          'target-candidate-reconstruction:scene-preserving',
          'target-candidate-profile:scene-like',
        ],
      }
    }

    const result = extractPortableFromReplayCapsule(capture, '.fallback')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.artifacts.html).toContain('<cg-board class="cg-board"')
    expect(result.artifacts.html).toContain('<piece class="white king"')
    expect(result.diagnostics.targetClass).toBe('render-scene')
    expect(result.diagnostics.exportMode).toBe('render-scene-freeze')
    expect(result.diagnostics.warnings).toContain('replay-capsule-scene-preserving-subtree-used')
    expect(result.diagnostics.warnings).toContain('replay-capsule-target-class:render-scene')
    expect(result.diagnostics.warnings).toContain('replay-capsule-export-mode:render-scene-freeze')
    expect(result.diagnostics.warnings).toContain('replay-capsule-scene-html-validated')
    expect(result.diagnostics.warnings).toContain('replay-capsule-candidate-subtree:target-candidate-reconstruction:scene-preserving')
  })
})
