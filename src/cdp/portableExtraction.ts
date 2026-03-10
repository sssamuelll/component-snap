import { buildPortableFallbackComponentJs } from '../portableFallback/extractor'
import type { CaptureBundleV0, MatchedRuleV0, ReplayCapsuleV0, ResourceGraphV0, ShadowTopologyV0, StyleDeclarationV0 } from './types'

type PortableExportSource = 'replay-capsule' | 'portable-fallback'
type PortableTargetClass = 'semantic-ui' | 'render-scene'
type PortableExportMode = 'semantic-ui-portable' | 'render-scene-freeze'

export interface PortableExportDiagnostics {
  source: PortableExportSource
  targetClass: PortableTargetClass
  exportMode: PortableExportMode
  warnings: string[]
  confidence: number
  confidencePenalty: number
  outputQuality?: 'portable' | 'fragile'
}

export interface PortableExportArtifacts {
  html: string
  css: string
  js: string
  freezeHtml: string
  selectedSelector: string
}

export interface PortableReplayExtractionSuccess {
  ok: true
  tier: 'capsule'
  artifacts: PortableExportArtifacts
  diagnostics: PortableExportDiagnostics
}

export interface PortableReplayExtractionFailure {
  ok: false
  reason: string
  warnings: string[]
}

export type PortableReplayExtractionResult = PortableReplayExtractionSuccess | PortableReplayExtractionFailure

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

const escapeAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const toCssBlock = (selectorList: string[], declarations: StyleDeclarationV0[]) => {
  const selectors = selectorList.map((token) => token.trim()).filter(Boolean)
  const lines = declarations
    .filter((declaration) => declaration.name?.trim() && declaration.value?.trim() && !declaration.disabled)
    .map((declaration) => {
      const important = declaration.important ? ' !important' : ''
      return `  ${declaration.name.trim()}: ${declaration.value.trim()}${important};`
    })

  if (!selectors.length || !lines.length) return ''
  return `${selectors.join(', ')} {\n${lines.join('\n')}\n}\n`
}

const serializeCssGraph = (replayCapsule: ReplayCapsuleV0, selectedSelector: string) => {
  const cssGraph = replayCapsule.snapshot.cssGraph
  if (!cssGraph) return ''

  let css = ''

  const customProperties = asArray(cssGraph.customProperties)
  if (customProperties.length > 0) {
    css += ':root {\n'
    for (const entry of customProperties) {
      if (!entry.name?.trim() || !entry.value?.trim()) continue
      css += `  ${entry.name.trim()}: ${entry.value.trim()};\n`
    }
    css += '}\n\n'
  }

  const inlineDeclarations = asArray(cssGraph.inline?.declarations)
  if (inlineDeclarations.length > 0) {
    css += toCssBlock([selectedSelector], inlineDeclarations)
    css += '\n'
  }

  for (const rule of asArray(cssGraph.matchedRules)) {
    css += toCssBlock(rule.selectorList, asArray(rule.declarations))
  }

  for (const keyframes of asArray(cssGraph.keyframes)) {
    if (!keyframes?.trim()) continue
    css += `${keyframes.trim()}\n\n`
  }

  return css.trim()
}

const hostLabel = (host: NonNullable<ShadowTopologyV0['roots']>[number]['host']) => {
  const tag = (host?.tagName || host?.nodeName || 'host').toLowerCase()
  const id = host?.id ? `#${host.id}` : ''
  const classPart = asArray(host?.classList)
    .slice(0, 3)
    .map((token) => token.trim())
    .filter(Boolean)
  const classes = classPart.length ? `.${classPart.join('.')}` : ''
  return `${tag}${id}${classes}`
}

const serializeShadowTopology = (shadowTopology: ShadowTopologyV0 | undefined) => {
  const roots = asArray(shadowTopology?.roots)
  if (!roots.length) return ''
  return JSON.stringify(
    roots.map((root) => ({
      mode: root.mode,
      depth: root.depth,
      host: hostLabel(root.host),
      adoptedStyleSheetCount: asArray(root.adoptedStyleSheets).length,
    })),
  )
}

const buildSkeletonFromSelector = (selector: string) => {
  const fallback = {
    tagName: 'div',
    id: '',
    classList: [] as string[],
  }

  const firstCompound = selector
    .trim()
    .split(/\s+|>|\+|~/)[0]
    ?.replace(/:{1,2}[a-zA-Z0-9_-]+(\([^)]*\))?/g, '')
    .trim()

  if (!firstCompound) return fallback

  const tagMatch = firstCompound.match(/^[a-zA-Z][a-zA-Z0-9-]*/)
  const idMatch = firstCompound.match(/#([a-zA-Z0-9_-]+)/)
  const classMatches = Array.from(firstCompound.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((match) => match[1])

  return {
    tagName: (tagMatch?.[0] || 'div').toLowerCase(),
    id: idMatch?.[1] || '',
    classList: classMatches,
  }
}

const pickSelector = (capture: CaptureBundleV0, replayCapsule: ReplayCapsuleV0, fallbackSelector?: string) => {
  return (
    capture.seed.targetFingerprint?.promotedSelectedSelector ||
    capture.seed.targetFingerprint?.promotedStableSelector ||
    capture.seed.targetFingerprint?.selectedSelector ||
    capture.seed.targetFingerprint?.stableSelector ||
    capture.seed.selectedSelector ||
    capture.seed.stableSelector ||
    replayCapsule.snapshot.cssGraph?.target?.selector ||
    fallbackSelector ||
    ''
  )
}

const getRequiredUnresolvedAssetCount = (resourceGraph: ResourceGraphV0 | undefined) => {
  return asArray(resourceGraph?.bundler?.assets).filter((asset) => asset.required && asset.fetchMode === 'unresolved').length
}

const hasAnyUsableRule = (rules: MatchedRuleV0[] | undefined) =>
  asArray(rules).some((rule) => rule.selectorList?.length && asArray(rule.declarations).some((declaration) => !declaration.disabled))

const getPortableTargetClass = (candidateSubtree: CaptureBundleV0['candidateSubtree'], targetSubtree: CaptureBundleV0['targetSubtree']): PortableTargetClass => {
  if (candidateSubtree?.quality?.profile === 'scene-like') return 'render-scene'
  if (candidateSubtree?.reconstruction?.mode === 'scene-preserving') return 'render-scene'
  if (asArray(candidateSubtree?.warnings).some((warning) => warning.includes('scene-like') || warning.includes('scene-preserving'))) {
    return 'render-scene'
  }
  if (asArray(targetSubtree?.warnings).some((warning) => warning.includes('scene'))) return 'render-scene'
  return 'semantic-ui'
}

const getPortableExportMode = (targetClass: PortableTargetClass, source: PortableExportSource): PortableExportMode => {
  if (targetClass === 'render-scene') return 'render-scene-freeze'
  return 'semantic-ui-portable'
}

const analyzePortableHtml = (html: string) => {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim()
  const elementTags = withoutScripts.match(/<([a-zA-Z][^\s/>]*)\b[^>]*>/g) || []
  const closingTags = withoutScripts.match(/<\/([a-zA-Z][^\s/>]*)>/g) || []
  const textLength = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
  const renderedElementCount = Math.max(0, elementTags.length)
  const hasOnlyRootShell = renderedElementCount <= 1 && closingTags.length <= 1 && textLength === 0

  return {
    renderedElementCount,
    textLength,
    hasOnlyRootShell,
  }
}

export const extractPortableFromReplayCapsule = (
  capture: CaptureBundleV0 | undefined,
  fallbackSelector?: string,
): PortableReplayExtractionResult => {
  if (!capture?.replayCapsule) {
    return { ok: false, reason: 'replay-capsule-missing', warnings: ['replay-capsule-export-unavailable'] }
  }

  const replayCapsule = capture.replayCapsule
  const cssGraph = replayCapsule.snapshot.cssGraph
  const resourceGraph = replayCapsule.snapshot.resourceGraph
  const shadowTopology = replayCapsule.snapshot.shadowTopology
  const targetSubtree = replayCapsule.snapshot.targetSubtree || capture.targetSubtree
  const candidateSubtree = replayCapsule.snapshot.candidateSubtree || capture.candidateSubtree
  const selectedSelector = pickSelector(capture, replayCapsule, fallbackSelector)

  if (!selectedSelector) {
    return { ok: false, reason: 'selector-missing', warnings: ['replay-capsule-selector-missing'] }
  }

  if (!cssGraph) {
    return { ok: false, reason: 'css-graph-missing', warnings: ['replay-capsule-css-graph-missing'] }
  }

  if (!hasAnyUsableRule(cssGraph.matchedRules) && asArray(cssGraph.inline?.declarations).length === 0) {
    return { ok: false, reason: 'css-rules-empty', warnings: ['replay-capsule-css-rules-empty'] }
  }

  const css = serializeCssGraph(replayCapsule, selectedSelector)
  if (!css.trim()) {
    return { ok: false, reason: 'css-serialize-empty', warnings: ['replay-capsule-css-serialize-empty'] }
  }

  const skeleton = buildSkeletonFromSelector(selectedSelector)
  const unresolvedRequiredAssets = getRequiredUnresolvedAssetCount(resourceGraph)
  const shadowMetadata = serializeShadowTopology(shadowTopology)
  const shadowRootCount = asArray(shadowTopology?.roots).length

  const attributes = [
    `data-csnap-capsule-root="true"`,
    `data-csnap-selector="${escapeAttribute(selectedSelector)}"`,
    skeleton.id ? `id="${escapeAttribute(skeleton.id)}"` : '',
    skeleton.classList.length ? `class="${escapeAttribute(skeleton.classList.join(' '))}"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const shadowInfo = shadowMetadata
    ? `\n<script type="application/json" id="component-snap-shadow-topology">${escapeHtml(shadowMetadata)}</script>`
    : ''

  const targetClass = getPortableTargetClass(candidateSubtree, targetSubtree)
  const exportMode = getPortableExportMode(targetClass, 'replay-capsule')

  const subtreeHtml = candidateSubtree?.html?.trim() || targetSubtree?.html?.trim()
  const html = subtreeHtml
    ? `${subtreeHtml}${shadowInfo}`
    : `<${skeleton.tagName} ${attributes}></${skeleton.tagName}>${shadowInfo}`
  const htmlAnalysis = analyzePortableHtml(html)

  const warnings = [
    'replay-capsule-portable-extractor-used',
    `replay-capsule-shadow-roots:${shadowRootCount}`,
    ...asArray(replayCapsule.diagnostics?.warnings).map((warning) => `replay-capsule-diagnostics:${warning}`),
  ]
  if (candidateSubtree?.html?.trim()) warnings.push('replay-capsule-candidate-subtree-used')
  if (candidateSubtree?.reconstruction?.mode === 'scene-preserving') {
    warnings.push('replay-capsule-scene-preserving-subtree-used')
  }
  warnings.push(...asArray(candidateSubtree?.warnings).map((warning) => `replay-capsule-candidate-subtree:${warning}`))
  warnings.push(`replay-capsule-target-class:${targetClass}`)
  warnings.push(`replay-capsule-export-mode:${exportMode}`)

  if (unresolvedRequiredAssets > 0) {
    warnings.push(`replay-capsule-required-assets-unresolved:${unresolvedRequiredAssets}`)
  }

  if (htmlAnalysis.hasOnlyRootShell) {
    warnings.push('replay-capsule-empty-shell-export')
    warnings.push(`replay-capsule-rendered-elements:${htmlAnalysis.renderedElementCount}`)
    warnings.push(`replay-capsule-rendered-text-length:${htmlAnalysis.textLength}`)
    if (shadowRootCount > 0) warnings.push('replay-capsule-shadow-metadata-without-content')
    return {
      ok: false,
      reason: 'empty-shell-export',
      warnings,
    }
  }

  let confidencePenalty = 0.14

  if (!targetSubtree?.html?.trim()) {
    warnings.push('replay-capsule-target-subtree-missing')
    confidencePenalty += 0.18
  }
  if (targetSubtree && targetSubtree.textLength === 0) {
    warnings.push('replay-capsule-target-subtree-text-thin')
    confidencePenalty += 0.06
  }
  if (shadowRootCount > 0) confidencePenalty += 0.06
  if (unresolvedRequiredAssets > 0) {
    confidencePenalty += Math.min(0.35, unresolvedRequiredAssets * 0.08)
  }
  if (asArray(cssGraph.keyframes).length === 0) {
    warnings.push('replay-capsule-keyframes-missing')
    confidencePenalty += 0.04
  }
  if (!capture.seed.targetFingerprint) {
    warnings.push('replay-capsule-target-fingerprint-missing')
    confidencePenalty += 0.12
  }
  if (!resourceGraph) {
    warnings.push('replay-capsule-resource-graph-missing')
    confidencePenalty += 0.18
  }

  confidencePenalty = clamp(confidencePenalty, 0, 0.92)
  const confidence = clamp(1 - confidencePenalty, 0.08, 1)

  return {
    ok: true,
    tier: 'capsule',
    artifacts: {
      html,
      css,
      freezeHtml: html,
      selectedSelector,
      js: buildPortableFallbackComponentJs(selectedSelector),
    },
    diagnostics: {
      source: 'replay-capsule',
      targetClass,
      exportMode,
      warnings,
      confidencePenalty,
      confidence,
      outputQuality: 'portable',
    },
  }
}
