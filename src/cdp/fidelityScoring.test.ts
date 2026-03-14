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
  targetSubtree: {
    source: 'runtime-object',
    html: '<button class="cta"><svg class="icon" viewBox="0 0 24 24"><path d="M1 1L23 23"></path></svg><span>Buy now</span></button>',
    nodeCount: 4,
    elementCount: 4,
    textNodeCount: 1,
    textLength: 7,
    maxDepth: 2,
  },
  candidateSubtree: {
    source: 'reconstructed-subtree',
    html: '<button class="cta"><svg class="icon" viewBox="0 0 24 24"><rect x="12%" y="12%" width="76%" height="76%" rx="18%"></rect></svg><span>Buy now</span></button>',
    removedTagCounts: {},
    removedAttributeCounts: {},
    collapsedWrapperCount: 0,
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
    warnings: ['target-candidate-compacted-svgs:1', 'target-candidate-profile:anchor-dense'],
  },
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
      targetSubtree: {
        source: 'runtime-object',
        html: '<button class="cta"><svg class="icon" viewBox="0 0 24 24"><path d="M1 1L23 23"></path></svg><span>Buy now</span></button>',
        nodeCount: 4,
        elementCount: 4,
        textNodeCount: 1,
        textLength: 7,
        maxDepth: 2,
      },
      candidateSubtree: {
        source: 'reconstructed-subtree',
        html: '<button class="cta"><svg class="icon" viewBox="0 0 24 24"><rect x="12%" y="12%" width="76%" height="76%" rx="18%"></rect></svg><span>Buy now</span></button>',
        removedTagCounts: {},
        removedAttributeCounts: {},
        collapsedWrapperCount: 0,
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
        warnings: ['target-candidate-compacted-svgs:1', 'target-candidate-profile:anchor-dense'],
      },
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
    expect(scoring.dimensions.structuralConfidence.evidence).toContain('structure-candidate-subtree-compacted-svgs:1')
    expect(scoring.dimensions.structuralConfidence.evidence).toContain('structure-candidate-subtree-profile:anchor-dense')
    expect(scoring.dimensions.structuralConfidence.evidence).toContain('structure-candidate-subtree-anchor-density:0.5')
    expect(scoring.dimensions.structuralConfidence.evidence).toContain('structure-candidate-subtree-reconstruction:semantic')
    expect(scoring.warnings).not.toContain('visual-screenshot-missing')
  })

  it('degrades interaction and structural signals when timeline and mapping are absent', () => {
    const capture = buildCapture()
    if (capture.replayCapsule) capture.replayCapsule.timeline.events = []
    capture.nodeMapping = undefined
    if (capture.replayCapsule) capture.replayCapsule.snapshot.nodeMapping = undefined
    capture.targetSubtree = undefined
    capture.candidateSubtree = undefined
    if (capture.replayCapsule) {
      capture.replayCapsule.snapshot.targetSubtree = undefined
      capture.replayCapsule.snapshot.candidateSubtree = undefined
    }
    capture.seed.targetFingerprint = undefined

    const scoring = scoreCaptureFidelity({ capture })
    expect(scoring.dimensions.interaction.score).toBeLessThan(0.3)
    expect(scoring.dimensions.structuralConfidence.score).toBeLessThan(0.65)
    expect(scoring.warnings).toContain('interaction-timeline-empty')
    expect(scoring.warnings).toContain('structure-candidate-subtree-missing')
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
    expect(scoring.warnings).toContain('fidelity-target-class:semantic-ui')
    expect(scoring.warnings).toContain('fidelity-export-mode:semantic-ui-portable')
    expect(scoring.warnings).toContain('fidelity-portable-diagnostics:portable-fallback-no-keyframes-captured')
  })

  it('boosts confidence when scene exports recover frame-preservation reasons', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'render-scene',
        exportMode: 'render-scene-freeze',
        warnings: [
          'replay-capsule-target-class:render-scene',
          'replay-capsule-scene-html-validated',
          'replay-capsule-preservation-reason:frame-chain-selector-hint-recovered',
          'replay-capsule-preservation-reason:scene-frame-hints-recovered',
        ],
        confidence: 0.64,
      },
    })

    expect(scoring.warnings).toContain('fidelity-preservation-reason:frame-chain-selector-hint-recovered')
    expect(scoring.warnings).toContain('fidelity-preservation-reason:scene-frame-hints-recovered')
    expect(scoring.notes).toContain('portable-scene-structure-recovery-detected')
    expect(scoring.notes).toContain('portable-preservation-reasons:frame-chain-selector-hint-recovered|scene-frame-hints-recovered')
    expect(scoring.overall.score).toBeGreaterThanOrEqual(0.58)
    expect(scoring.overall.confidence).toBeGreaterThanOrEqual(0.58)
  })

  it('boosts confidence when semantic exports recover wrapper-preservation reasons', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'semantic-ui',
        exportMode: 'semantic-ui-portable',
        warnings: [
          'replay-capsule-preservation-reason:semantic-wrapper-hints-recovered',
          'replay-capsule-preservation-reason:semantic-wrapper-depth-recovered:3',
        ],
        confidence: 0.59,
      },
    })

    expect(scoring.warnings).toContain('fidelity-preservation-reason:semantic-wrapper-hints-recovered')
    expect(scoring.warnings).toContain('fidelity-preservation-reason:semantic-wrapper-depth-recovered:3')
    expect(scoring.notes).toContain('portable-semantic-wrapper-recovery-detected')
    expect(scoring.notes).toContain('portable-preservation-reasons:semantic-wrapper-hints-recovered|semantic-wrapper-depth-recovered:3')
    expect(scoring.overall.score).toBeGreaterThanOrEqual(0.58)
    expect(scoring.overall.confidence).toBeGreaterThanOrEqual(0.56)
  })

  it('applies class-driven form-like preservation boosts', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'semantic-ui',
        targetClassHint: 'interactive-composite',
        targetSubtypeHint: 'form-like',
        classReasons: ['class-evidence:form-root'],
        exportMode: 'semantic-ui-portable',
        confidence: 0.62,
      },
    })

    expect(scoring.warnings).toContain('fidelity-target-class-hint:interactive-composite')
    expect(scoring.warnings).toContain('fidelity-target-subtype-hint:form-like')
    expect(scoring.warnings).toContain('fidelity-target-class-reason:class-evidence:form-root')
    expect(scoring.notes).toContain('class-policy:form-like-structure-preservation')
    expect(scoring.overall.score).toBeGreaterThanOrEqual(0.61)
  })

  it('applies class-driven semantic-leaf compactness penalties', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'semantic-ui',
        targetClassHint: 'semantic-leaf',
        targetSubtypeHint: 'generic',
        exportMode: 'semantic-ui-portable',
        warnings: ['replay-capsule-preservation-reason:semantic-wrapper-depth-recovered:6'],
        confidence: 0.9,
      },
    })

    expect(scoring.notes).toContain('class-policy:semantic-leaf-compactness-priority')
    expect(scoring.warnings).toContain('fidelity-semantic-leaf-wrapper-bloat-detected')
    expect(scoring.overall.confidence).toBeLessThanOrEqual(0.72)
  })

  it('surfaces render-scene target class and export mode in fidelity diagnostics', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'render-scene',
        exportMode: 'render-scene-freeze',
        warnings: ['replay-capsule-target-class:render-scene', 'replay-capsule-scene-html-validated'],
        confidence: 0.72,
      },
    })

    expect(scoring.targetClass).toBe('render-scene')
    expect(scoring.exportMode).toBe('render-scene-freeze')
    expect(scoring.warnings).toContain('fidelity-target-class:render-scene')
    expect(scoring.warnings).toContain('fidelity-export-mode:render-scene-freeze')
    expect(scoring.notes).toContain('render-scene-target-detected')
    expect(scoring.notes).toContain('render-scene-export-mode:render-scene-freeze')
  })

  it('does not apply generic fragile gating to validated render-scene exports', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        targetClass: 'render-scene',
        exportMode: 'render-scene-freeze',
        warnings: [
          'replay-capsule-target-class:render-scene',
          'replay-capsule-scene-html-validated',
          'replay-capsule-shadow-metadata-without-content',
        ],
        confidence: 0.61,
        outputQuality: 'fragile',
      },
    })

    expect(scoring.warnings).not.toContain('portable-output-empty-shell-gated')
    expect(scoring.warnings).not.toContain('portable-output-fragile-gated')
    expect(scoring.warnings).not.toContain('portable-output-scene-fragile-gated')
    expect(scoring.overall.score).toBeGreaterThan(0.5)
    expect(scoring.overall.confidence).toBeGreaterThan(0.4)
  })

  it('hard-gates overall fidelity when portable output collapses to an empty shell', () => {
    const scoring = scoreCaptureFidelity({
      capture: buildCapture(),
      portableDiagnostics: {
        source: 'replay-capsule',
        warnings: ['replay-capsule-empty-shell-export', 'replay-capsule-shadow-metadata-without-content'],
        confidence: 0.12,
        outputQuality: 'fragile',
      },
    })

    expect(scoring.overall.score).toBeLessThanOrEqual(0.28)
    expect(scoring.overall.confidence).toBeLessThanOrEqual(0.22)
    expect(scoring.warnings).toContain('portable-output-empty-shell-gated')
    expect(scoring.notes).toContain('portable-output-empty-shell-detected')
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
