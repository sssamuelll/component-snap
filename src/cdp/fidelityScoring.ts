import type {
  CaptureBundleV0,
  FidelityDimensionScoreV0,
  FidelityScoringV0,
  PixelDiffMetricsV0,
  ReplayTimelineEventV0,
  ResourceGraphV0,
} from './types'

export interface FidelityPortableDiagnosticsInput {
  source?: 'replay-capsule' | 'portable-fallback'
  warnings?: string[]
  confidencePenalty?: number
  confidence?: number
  outputQuality?: 'portable' | 'fragile'
}

export interface ScoreCaptureFidelityInput {
  capture?: CaptureBundleV0
  portableDiagnostics?: FidelityPortableDiagnosticsInput
  pixelDiff?: PixelDiffMetricsV0
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const round3 = (value: number) => Math.round(clamp(value) * 1000) / 1000

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

const buildVisualScore = (
  capture: CaptureBundleV0 | undefined,
  pixelDiff: PixelDiffMetricsV0 | undefined,
): FidelityDimensionScoreV0 => {
  const replay = capture?.replayCapsule
  const screenshot = replay?.snapshot.screenshot || capture?.screenshot
  const cssGraph = replay?.snapshot.cssGraph || capture?.cssGraph
  const domSnapshot = replay?.snapshot.domSnapshot || capture?.domSnapshot

  const warnings: string[] = []
  const evidence: string[] = []
  let score = 0.16
  let confidence = 0.34

  const hasClipScreenshot = !!screenshot?.clipDataUrl
  const hasAnyScreenshot = !!(screenshot?.clipDataUrl || screenshot?.fullPageDataUrl)
  const ruleCount = cssGraph?.diagnostics?.ruleCount ?? asArray(cssGraph?.matchedRules).length
  const inlineDeclarationCount = asArray(cssGraph?.inline?.declarations).length
  const hasCssRules = ruleCount > 0
  const keyframeCount = asArray(cssGraph?.keyframes).length
  const hasDomSnapshot = typeof domSnapshot?.raw !== 'undefined'
  const cssWarnings = asArray(cssGraph?.diagnostics?.warnings)

  if (hasAnyScreenshot) {
    score += 0.3
    confidence += 0.2
    evidence.push('visual-screenshot-captured')
  } else {
    score -= 0.1
    confidence -= 0.12
    warnings.push('visual-screenshot-missing')
  }

  if (hasClipScreenshot) {
    score += 0.07
    confidence += 0.06
    evidence.push('visual-target-clip-captured')
  }

  if (hasCssRules) {
    score += 0.24
    confidence += 0.2
    evidence.push(`visual-css-rules:${ruleCount}`)
  } else {
    warnings.push('visual-css-rules-missing')
    score -= 0.08
    confidence -= 0.1
  }

  if (inlineDeclarationCount > 0) {
    score += 0.07
    confidence += 0.05
    evidence.push(`visual-inline-style-declarations:${inlineDeclarationCount}`)
  }

  if (keyframeCount > 0) {
    score += 0.08
    evidence.push(`visual-keyframes:${keyframeCount}`)
  } else {
    warnings.push('visual-keyframes-missing')
  }

  if (hasDomSnapshot) {
    score += 0.1
    confidence += 0.08
    evidence.push('visual-dom-snapshot-present')
  } else {
    warnings.push('visual-dom-snapshot-missing')
  }

  if (cssWarnings.includes('provenance-degraded-computed-only')) {
    score -= 0.08
    confidence -= 0.1
    warnings.push('visual-css-provenance-degraded')
  }

  if (pixelDiff) {
    const parityScore = 1 - clamp(pixelDiff.mismatchRatio)
    score = score * 0.45 + parityScore * 0.55
    confidence += 0.24
    evidence.push(`visual-pixel-diff-pixels:${pixelDiff.mismatchPixels}`)
    evidence.push(`visual-pixel-diff-ratio:${round3(pixelDiff.mismatchRatio)}`)

    if (!pixelDiff.dimensionsMatch) {
      warnings.push('visual-pixel-diff-dimensions-mismatch')
      score -= 0.08
    }

    if (pixelDiff.mismatchRatio > 0.15) warnings.push('visual-pixel-diff-high-mismatch')
    else if (pixelDiff.mismatchRatio > 0) warnings.push('visual-pixel-diff-nonzero-mismatch')
  }

  return {
    score: round3(score),
    confidence: round3(confidence),
    evidence,
    warnings: warnings.length ? uniq(warnings) : undefined,
  }
}

const buildInteractionScore = (timelineEvents: ReplayTimelineEventV0[]): FidelityDimensionScoreV0 => {
  const warnings: string[] = []
  const evidence: string[] = []

  const actionEvents = timelineEvents.filter((event) => event.kind === 'action-trace')
  const mutationEvents = timelineEvents.filter((event) => event.kind === 'mutation')
  const linkedMutationCount = mutationEvents.filter((event) => !!event.mutation.actionRef).length
  const totalEvents = timelineEvents.length

  let score = 0.1
  let confidence = 0.3

  if (actionEvents.length > 0) {
    score += 0.38
    confidence += 0.16
    evidence.push(`interaction-action-events:${actionEvents.length}`)
  } else {
    warnings.push('interaction-action-timeline-missing')
  }

  if (mutationEvents.length > 0) {
    score += 0.34
    confidence += 0.16
    evidence.push(`interaction-mutation-events:${mutationEvents.length}`)
  } else {
    warnings.push('interaction-mutation-timeline-missing')
  }

  if (actionEvents.length > 0 && mutationEvents.length > 0) {
    score += 0.1
    confidence += 0.08
    evidence.push('interaction-action-mutation-coverage')
  }

  if (linkedMutationCount > 0) {
    score += 0.08
    confidence += 0.06
    evidence.push(`interaction-linked-mutations:${linkedMutationCount}`)
  } else if (mutationEvents.length > 0) {
    warnings.push('interaction-mutations-unlinked')
  }

  if (totalEvents > 8) {
    score += 0.05
    confidence += 0.04
    evidence.push(`interaction-event-volume:${totalEvents}`)
  }

  if (totalEvents === 0) {
    warnings.push('interaction-timeline-empty')
    confidence -= 0.15
  }

  return {
    score: round3(score),
    confidence: round3(confidence),
    evidence,
    warnings: warnings.length ? uniq(warnings) : undefined,
  }
}

const buildAssetScore = (resourceGraph: ResourceGraphV0 | undefined): FidelityDimensionScoreV0 => {
  const warnings: string[] = []
  const evidence: string[] = []

  if (!resourceGraph) {
    return {
      score: 0.25,
      confidence: 0.2,
      evidence: [],
      warnings: ['assets-resource-graph-missing'],
    }
  }

  const assets = asArray(resourceGraph.bundler?.assets)
  const requiredAssets = assets.filter((asset) => asset.required)
  const unresolvedRequired = requiredAssets.filter((asset) => asset.fetchMode === 'unresolved').length
  const unresolvedOptional = assets.filter((asset) => !asset.required && asset.fetchMode === 'unresolved').length
  const unresolvedTotal = unresolvedRequired + unresolvedOptional
  const diagnosticsWarnings = asArray(resourceGraph.diagnostics?.warnings)
  const resourceNodeCount =
    resourceGraph.diagnostics?.resourceNodeCount ??
    asArray(resourceGraph.nodes).filter((node) => !['document', 'origin'].includes(node.kind)).length

  let score = 0.45
  let confidence = 0.45

  if (assets.length > 0) {
    const coverage = (assets.length - unresolvedTotal) / assets.length
    const requiredCoverage =
      requiredAssets.length > 0 ? (requiredAssets.length - unresolvedRequired) / requiredAssets.length : coverage
    score = 0.25 + coverage * 0.45 + requiredCoverage * 0.3
    confidence += 0.2
    evidence.push(`assets-bundle-assets:${assets.length}`)
    evidence.push(`assets-required-unresolved:${unresolvedRequired}`)
  } else if (resourceNodeCount > 0) {
    score = 0.5
    confidence = 0.35
    warnings.push('assets-bundler-assets-missing')
    evidence.push(`assets-resource-nodes:${resourceNodeCount}`)
  } else {
    score = 0.38
    confidence = 0.28
    warnings.push('assets-resource-evidence-thin')
  }

  if (unresolvedRequired > 0) warnings.push(`assets-required-unresolved:${unresolvedRequired}`)
  if (unresolvedOptional > 0) warnings.push(`assets-optional-unresolved:${unresolvedOptional}`)
  if (diagnosticsWarnings.length > 0) {
    confidence -= Math.min(0.2, diagnosticsWarnings.length * 0.05)
    warnings.push('assets-resource-graph-warnings-present')
  }

  return {
    score: round3(score),
    confidence: round3(confidence),
    evidence,
    warnings: warnings.length ? uniq(warnings) : undefined,
  }
}

const buildStructuralScore = (capture: CaptureBundleV0 | undefined): FidelityDimensionScoreV0 => {
  const replay = capture?.replayCapsule
  const nodeMapping = replay?.snapshot.nodeMapping || capture?.nodeMapping
  const domSnapshot = replay?.snapshot.domSnapshot || capture?.domSnapshot
  const shadowTopology = replay?.snapshot.shadowTopology || capture?.shadowTopology
  const targetSubtree = replay?.snapshot.targetSubtree || capture?.targetSubtree
  const candidateSubtree = replay?.snapshot.candidateSubtree || capture?.candidateSubtree
  const fingerprint = capture?.seed.targetFingerprint

  const warnings: string[] = []
  const evidence: string[] = []

  let score = 0.25
  let confidence = 0.35

  if (nodeMapping?.resolved) {
    const mappingConfidence = clamp(nodeMapping.confidence || 0.5)
    score += 0.2 + mappingConfidence * 0.25
    confidence += mappingConfidence * 0.25
    evidence.push(`structure-node-mapped:${nodeMapping.strategy}`)
  } else {
    warnings.push('structure-node-mapping-unresolved')
  }

  if (typeof domSnapshot?.raw !== 'undefined') {
    score += 0.2
    confidence += 0.1
    const domNodeCount = domSnapshot.stats?.nodes || 0
    if (domNodeCount > 0) evidence.push(`structure-dom-nodes:${domNodeCount}`)
  } else {
    warnings.push('structure-dom-snapshot-missing')
  }

  if (fingerprint) {
    score += 0.08
    confidence += 0.1
    evidence.push('structure-target-fingerprint-present')
  } else {
    warnings.push('structure-target-fingerprint-missing')
  }

  if (targetSubtree?.html?.trim()) {
    score += 0.08
    confidence += 0.06
    evidence.push(`structure-target-subtree-nodes:${targetSubtree.nodeCount}`)
  } else {
    warnings.push('structure-target-subtree-missing')
  }

  if (candidateSubtree?.html?.trim()) {
    score += 0.12
    confidence += 0.1
    evidence.push(`structure-candidate-subtree-nodes:${candidateSubtree.nodeCount}`)

    const rawLength = targetSubtree?.html?.length || 0
    const candidateLength = candidateSubtree.html.length
    if (rawLength > 0 && candidateLength < rawLength) {
      evidence.push(`structure-candidate-subtree-reduction:${rawLength - candidateLength}`)
    }
    if (candidateSubtree.compactedSvgCount > 0) {
      evidence.push(`structure-candidate-subtree-compacted-svgs:${candidateSubtree.compactedSvgCount}`)
    }
    if (candidateSubtree.quality) {
      evidence.push(`structure-candidate-subtree-profile:${candidateSubtree.quality.profile}`)
      evidence.push(`structure-candidate-subtree-anchor-density:${candidateSubtree.quality.anchorDensity}`)
      if (typeof candidateSubtree.quality.wrapperToAnchorRatio === 'number') {
        evidence.push(`structure-candidate-subtree-wrapper-anchor-ratio:${candidateSubtree.quality.wrapperToAnchorRatio}`)
      }
    }
    if (candidateSubtree.reconstruction) {
      evidence.push(`structure-candidate-subtree-reconstruction:${candidateSubtree.reconstruction.mode}`)
      if (candidateSubtree.reconstruction.preservedEmptyScenePrimitiveCount > 0) {
        evidence.push(
          `structure-candidate-subtree-scene-primitives:${candidateSubtree.reconstruction.preservedEmptyScenePrimitiveCount}`,
        )
      }
      if (candidateSubtree.reconstruction.preservedCustomElementCount > 0) {
        evidence.push(
          `structure-candidate-subtree-scene-custom-elements:${candidateSubtree.reconstruction.preservedCustomElementCount}`,
        )
      }
      if (candidateSubtree.reconstruction.preservedLayeredElementCount > 0) {
        evidence.push(
          `structure-candidate-subtree-scene-layered-elements:${candidateSubtree.reconstruction.preservedLayeredElementCount}`,
        )
      }
    }
  } else {
    warnings.push('structure-candidate-subtree-missing')
  }

  if (shadowTopology) {
    const totalRoots = shadowTopology.diagnostics?.totalShadowRoots ?? asArray(shadowTopology.roots).length
    const closedRoots = shadowTopology.diagnostics?.closedShadowRootCount ?? 0
    score += 0.1
    confidence += 0.08
    evidence.push(`structure-shadow-roots:${totalRoots}`)
    if (closedRoots > 0) {
      warnings.push(`structure-closed-shadow-roots:${closedRoots}`)
      score -= Math.min(0.12, closedRoots * 0.03)
      confidence -= Math.min(0.1, closedRoots * 0.02)
    }
  }

  return {
    score: round3(score),
    confidence: round3(confidence),
    evidence,
    warnings: warnings.length ? uniq(warnings) : undefined,
  }
}

export const scoreCaptureFidelity = (input: ScoreCaptureFidelityInput): FidelityScoringV0 => {
  const capture = input.capture
  const replay = capture?.replayCapsule
  const timelineEvents = asArray(replay?.timeline?.events)
  const resourceGraph = replay?.snapshot.resourceGraph || capture?.resourceGraph

  const visual = buildVisualScore(capture, input.pixelDiff)
  const interaction = buildInteractionScore(timelineEvents)
  const assetCompleteness = buildAssetScore(resourceGraph)
  const structuralConfidence = buildStructuralScore(capture)

  let overallScore =
    visual.score * 0.38 +
    interaction.score * 0.24 +
    assetCompleteness.score * 0.2 +
    structuralConfidence.score * 0.18
  let overallConfidence =
    visual.confidence * 0.34 +
    interaction.confidence * 0.26 +
    assetCompleteness.confidence * 0.2 +
    structuralConfidence.confidence * 0.2

  const warnings = uniq([
    ...asArray(visual.warnings),
    ...asArray(interaction.warnings),
    ...asArray(assetCompleteness.warnings),
    ...asArray(structuralConfidence.warnings),
  ])
  const notes = [
    'weights:visual=0.38,interaction=0.24,assets=0.20,structure=0.18',
    'portable-diagnostics-adjust-overall-only',
  ]

  if (input.portableDiagnostics) {
    const portable = input.portableDiagnostics
    const portableConfidence = clamp(
      typeof portable.confidence === 'number'
        ? portable.confidence
        : typeof portable.confidencePenalty === 'number'
          ? 1 - portable.confidencePenalty
          : overallScore,
    )
    const source = portable.source || 'portable-fallback'
    const portableWarnings = asArray(portable.warnings)
    warnings.push(`fidelity-portable-source:${source}`)
    warnings.push(...portableWarnings.map((warning) => `fidelity-portable-diagnostics:${warning}`))

    overallScore = overallScore * 0.85 + portableConfidence * 0.15
    overallConfidence = Math.min(overallConfidence, clamp(portableConfidence + 0.15))

    if (source === 'portable-fallback') {
      overallScore = Math.min(overallScore, 0.82)
      overallConfidence = Math.min(overallConfidence, 0.8)
    }

    const hasEmptyShellFailure = portableWarnings.includes('replay-capsule-empty-shell-export')
    const hasShadowMetadataWithoutContent = portableWarnings.includes('replay-capsule-shadow-metadata-without-content')
    const outputQuality = portable.outputQuality || (hasEmptyShellFailure ? 'fragile' : undefined)

    if (hasEmptyShellFailure || outputQuality === 'fragile') {
      overallScore = Math.min(overallScore, 0.28)
      overallConfidence = Math.min(overallConfidence, 0.22)
      warnings.push('portable-output-empty-shell-gated')
      notes.unshift('portable-output-empty-shell-detected')
    } else if (hasShadowMetadataWithoutContent || portableConfidence < 0.25) {
      overallScore = Math.min(overallScore, 0.42)
      overallConfidence = Math.min(overallConfidence, 0.35)
      warnings.push('portable-output-fragile-gated')
      notes.unshift('portable-output-fragile-detected')
    }
  }

  if (!input.pixelDiff) notes.unshift('heuristic-score-no-pixel-diff')

  return {
    version: '0',
    computedAt: new Date().toISOString(),
    overall: {
      score: round3(overallScore),
      confidence: round3(overallConfidence),
    },
    dimensions: {
      visual,
      interaction,
      assetCompleteness,
      structuralConfidence,
    },
    pixelDiff: input.pixelDiff,
    warnings: uniq(warnings),
    notes,
  }
}
