import { buildPortableFallbackComponentJs } from '../portableFallback/extractor'
import type { TargetClass, TargetSubtype } from './nodeMappingTypes'
import type { CaptureBundleV0, MatchedRuleV0, ReplayCapsuleV0, ResourceGraphV0, ShadowTopologyV0, StyleDeclarationV0 } from './types'

type PortableExportSource = 'replay-capsule' | 'portable-fallback'
type PortableTargetClass = TargetClass | 'semantic-ui'
type PortableExportMode = 'semantic-ui-portable' | 'render-scene-freeze'

type PortableTargetClassResolution = {
  targetClass: PortableTargetClass
  coercionWarning?: string
}

export interface PortableExportDiagnostics {
  source: PortableExportSource
  targetClass: PortableTargetClass
  targetClassHint?: TargetClass
  targetSubtypeHint?: TargetSubtype
  classReasons?: string[]
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
  rootSelector: string
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
  const isChartLikeScene = capture.seed.targetClassHint === 'render-scene' && capture.seed.targetSubtypeHint === 'chart-like'

  if (isChartLikeScene) {
    return (
      capture.seed.targetFingerprint?.selectedSelector ||
      capture.seed.targetFingerprint?.stableSelector ||
      capture.seed.selectedSelector ||
      capture.seed.stableSelector ||
      capture.seed.targetFingerprint?.promotedSelectedSelector ||
      capture.seed.targetFingerprint?.promotedStableSelector ||
      replayCapsule.snapshot.cssGraph?.target?.selector ||
      fallbackSelector ||
      ''
    )
  }

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

const getPortableTargetClass = (
  candidateSubtree: CaptureBundleV0['candidateSubtree'],
  targetSubtree: CaptureBundleV0['targetSubtree'],
  targetClassHint?: TargetClass,
): PortableTargetClassResolution => {
  if (targetClassHint === 'render-scene') return { targetClass: 'render-scene' }
  if (['semantic-leaf', 'semantic-shell', 'interactive-composite', 'noisy-container'].includes(targetClassHint || '')) {
    return { targetClass: targetClassHint as TargetClass }
  }
  if (candidateSubtree?.quality?.profile === 'scene-like') return { targetClass: 'render-scene' }
  if (candidateSubtree?.reconstruction?.mode === 'scene-preserving') return { targetClass: 'render-scene' }
  if (asArray(candidateSubtree?.warnings).some((warning) => warning.includes('scene-like') || warning.includes('scene-preserving'))) {
    return { targetClass: 'render-scene' }
  }
  if (asArray(targetSubtree?.warnings).some((warning) => warning.includes('scene'))) return { targetClass: 'render-scene' }
  return { targetClass: 'semantic-ui' }
}

const getPortableExportMode = (targetClass: PortableTargetClass): PortableExportMode => {
  if (targetClass === 'render-scene') return 'render-scene-freeze'
  return 'semantic-ui-portable'
}

const selectorTokens = (selector: string) => {
  const firstCompound = selector
    .trim()
    .split(/\s+|>|\+|~/)[0]
    ?.replace(/:{1,2}[a-zA-Z0-9_-]+(\([^)]*\))?/g, '')
    .trim()

  if (!firstCompound) return { id: '', classes: [] as string[] }

  return {
    id: firstCompound.match(/#([a-zA-Z0-9_-]+)/)?.[1] || '',
    classes: Array.from(firstCompound.matchAll(/\.([a-zA-Z0-9_-]+)/g)).map((match) => match[1]),
  }
}

const htmlContainsSelectorFrameHints = (html: string, selector: string) => {
  const { id, classes } = selectorTokens(selector)
  if (id && new RegExp(`id=["'][^"']*${id}[^"']*["']`, 'i').test(html)) return true
  if (classes.some((className) => new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i').test(html))) return true
  return false
}

const hasSceneFrameHints = (html: string) => /(cg-wrap|cg-container|main-board|analyse__board|board-shell|scene-layer)/i.test(html)

const hasChartSceneRoot = (html: string, selector: string) => {
  const { id, classes } = selectorTokens(selector)
  if (!/<(svg|canvas)\b/i.test(html)) return false
  if (id && new RegExp(`<(?:svg|canvas)\\b[^>]*id=["'][^"']*${id}[^"']*["']`, 'i').test(html)) return true
  if (classes.some((className) => new RegExp(`<(?:svg|canvas)\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i').test(html))) return true
  return /<(svg|canvas)\b/i.test(html)
}

const countChartPrimitives = (html: string) => (html.match(/<(path|rect|line|polyline|polygon|circle|ellipse|g|defs|stop)\b/gi) || []).length

const countElementTags = (html: string) => (html.match(/<([a-zA-Z][^\s/>]*)\b[^>]*>/g) || []).length

const SEMANTIC_WRAPPER_CLASS_HINTS = ['A8SBwf', 'RNNXgb', 'search', 'searchbox', 'form']

const hasSemanticWrapperHints = (html: string, selector: string) => {
  const lower = html.toLowerCase()
  if (/<form\b/i.test(html)) return true
  const { id, classes } = selectorTokens(selector)
  if (id && new RegExp(`id=["'][^"']*${id}[^"']*["']`, 'i').test(html)) return true
  if (classes.some((className) => new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i').test(html))) return true
  return SEMANTIC_WRAPPER_CLASS_HINTS.some((token) => lower.includes(token.toLowerCase()))
}

const isSearchShellHtml = (html: string, selector: string) => {
  const lower = html.toLowerCase()
  return (
    /name=["']q["']/.test(lower) &&
    (/<textarea\b/i.test(html) || /<input\b/i.test(html)) &&
    (lower.includes('rnnxgb') || lower.includes('a8sbwf') || selector.toLowerCase().includes('rnnxgb') || selector.toLowerCase().includes('a8sbwf') || selector.toLowerCase().includes('role="search"'))
  )
}

const sanitizeSearchShellHtml = (html: string) => {
  let sanitized = html
  sanitized = sanitized.replace(/<input\b[^>]*type=["']file["'][^>]*>/gi, '')
  sanitized = sanitized.replace(/<ul\b[^>]*role=["']menu["'][^>]*>[\s\S]*?<\/ul>/gi, '')
  sanitized = sanitized.replace(/<button\b[^>]*aria-label=["'][^"']*(Dateien oder Bilder hochladen|Dateianhang entfernen)[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '')
  sanitized = sanitized.replace(/<button\b[^>]*class=["'][^"']*\bplR5qb\b[^"']*["'][^>]*>[\s\S]*?<\/button>/gi, '')
  sanitized = sanitized.replace(/<div\b[^>]*class=["'][^"']*\boMByyf\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()
  return sanitized
}

const sanitizeFormLikeHtml = (html: string) => {
  let sanitized = html
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  sanitized = sanitized.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  sanitized = sanitized.replace(/<input\b[^>]*type=["']hidden["'][^>]*>/gi, '')
  sanitized = sanitized.replace(/<[^>]+\s(hidden|aria-hidden=["']true["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, '')
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()
  return sanitized
}

const sanitizeLeafHtml = (html: string) => {
  let sanitized = html
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  sanitized = sanitized.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  sanitized = sanitized.replace(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>\s*(<\1\b[^>]*>[\s\S]*<\/\1>)\s*<\/\1>/gi, '$2')
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()
  return sanitized
}

const pickExportSubtreeHtml = (input: {
  selectedSelector: string
  targetClass: PortableTargetClass
  targetClassHint?: TargetClass
  targetSubtypeHint?: TargetSubtype
  candidateSubtreeHtml?: string
  targetSubtreeHtml?: string
}) => {
  const candidateHtmlRaw = input.candidateSubtreeHtml?.trim() || ''
  const targetHtmlRaw = input.targetSubtreeHtml?.trim() || ''
  const shouldSanitizeSearchShell =
    input.targetClass === 'semantic-ui' &&
    (input.targetSubtypeHint === 'search-like' || isSearchShellHtml(candidateHtmlRaw, input.selectedSelector) || isSearchShellHtml(targetHtmlRaw, input.selectedSelector))
  const shouldSanitizeFormLike = input.targetClassHint === 'interactive-composite' && input.targetSubtypeHint === 'form-like'
  const shouldSanitizeLeaf = input.targetClassHint === 'semantic-leaf'

  const sanitizeByClass = (html: string) => {
    if (shouldSanitizeSearchShell) return sanitizeSearchShellHtml(html)
    if (shouldSanitizeFormLike) return sanitizeFormLikeHtml(html)
    if (shouldSanitizeLeaf) return sanitizeLeafHtml(html)
    return html
  }

  const candidateHtml = sanitizeByClass(candidateHtmlRaw)
  const targetHtml = sanitizeByClass(targetHtmlRaw)
  const reasons: string[] = []

  if (!candidateHtml) {
    reasons.push('candidate-subtree-missing')
    return { html: targetHtml, reasons }
  }
  if (!targetHtml) {
    reasons.push('target-subtree-missing')
    return { html: candidateHtml, reasons }
  }

  if (input.targetClass === 'render-scene') {
    const candidateHasSelectorFrame = htmlContainsSelectorFrameHints(candidateHtml, input.selectedSelector)
    const targetHasSelectorFrame = htmlContainsSelectorFrameHints(targetHtml, input.selectedSelector)
    const candidateHasSceneFrame = hasSceneFrameHints(candidateHtml)
    const targetHasSceneFrame = hasSceneFrameHints(targetHtml)

    if (input.targetSubtypeHint === 'chart-like') {
      const candidateHasChartRoot = hasChartSceneRoot(candidateHtml, input.selectedSelector)
      const targetHasChartRoot = hasChartSceneRoot(targetHtml, input.selectedSelector)
      const candidatePrimitiveCount = countChartPrimitives(candidateHtml)
      const targetPrimitiveCount = countChartPrimitives(targetHtml)
      const candidateRetainsSceneRoot = candidateHasChartRoot && candidatePrimitiveCount >= Math.min(3, Math.max(1, targetPrimitiveCount))

      if (candidateRetainsSceneRoot) {
        return {
          html: candidateHtml,
          reasons: [
            'class-policy:chart-like-prefers-compact-candidate',
            `chart-scene-root-retained:${candidatePrimitiveCount}`,
          ],
        }
      }
      if (!candidateHasSelectorFrame && targetHasSelectorFrame) reasons.push('frame-chain-selector-hint-recovered')
      if (!candidateHasChartRoot && targetHasChartRoot) reasons.push('chart-scene-root-recovered')
      return reasons.length > 0 ? { html: targetHtml, reasons } : { html: candidateHtml, reasons }
    }

    if (!candidateHasSelectorFrame && targetHasSelectorFrame) reasons.push('frame-chain-selector-hint-recovered')
    if (!candidateHasSceneFrame && targetHasSceneFrame) reasons.push('scene-frame-hints-recovered')
    if (input.targetSubtypeHint === 'board-like' && targetHasSceneFrame && !candidateHasSceneFrame) {
      reasons.push('class-policy:board-like-prefers-framed-target')
    }

    if (reasons.length > 0) {
      return { html: targetHtml, reasons }
    }

    return { html: candidateHtml, reasons }
  }

  const candidateHasSemanticWrappers = hasSemanticWrapperHints(candidateHtml, input.selectedSelector)
  const targetHasSemanticWrappers = hasSemanticWrapperHints(targetHtml, input.selectedSelector)
  const candidateElementCount = countElementTags(candidateHtml)
  const targetElementCount = countElementTags(targetHtml)

  if (!candidateHasSemanticWrappers && targetHasSemanticWrappers) {
    reasons.push('semantic-wrapper-hints-recovered')
  }

  if (targetElementCount >= candidateElementCount + 2 && targetHasSemanticWrappers) {
    reasons.push(`semantic-wrapper-depth-recovered:${targetElementCount - candidateElementCount}`)
  }

  if (input.targetClassHint === 'semantic-shell' && input.targetSubtypeHint === 'search-like' && targetHasSemanticWrappers) {
    if (targetElementCount >= candidateElementCount) reasons.push('class-policy:search-like-prefers-wrappered-target')
  }

  if (input.targetClassHint === 'interactive-composite' && input.targetSubtypeHint === 'form-like') {
    if (targetHasSemanticWrappers && targetElementCount >= candidateElementCount) {
      reasons.push('class-policy:form-like-prefers-structured-target')
    }
  }

  if (input.targetClassHint === 'semantic-leaf') {
    if (candidateElementCount <= Math.max(3, targetElementCount) && candidateElementCount > 0) {
      return { html: candidateHtml, reasons: ['class-policy:semantic-leaf-prefers-compact-candidate'] }
    }
  }

  if (reasons.length > 0) {
    return { html: targetHtml, reasons }
  }

  return { html: candidateHtml, reasons }
}

const htmlStartsWithTag = (html: string, tagName: string) => {
  const trimmed = html.trim()
  return new RegExp(`^<${tagName}\\b`, 'i').test(trimmed)
}

const materializeExportRoot = (selector: string, subtreeHtml: string | undefined, shadowInfo: string) => {
  const skeleton = buildSkeletonFromSelector(selector)
  const attributes = [
    `data-csnap-root="true"`,
    `data-csnap-capsule-root="true"`,
    `data-csnap-selector="${escapeAttribute(selector)}"`,
    skeleton.id ? `id="${escapeAttribute(skeleton.id)}"` : '',
    skeleton.classList.length ? `class="${escapeAttribute(skeleton.classList.join(' '))}"` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const trimmedSubtreeHtml = subtreeHtml?.trim() || ''
  if (trimmedSubtreeHtml && htmlStartsWithTag(trimmedSubtreeHtml, skeleton.tagName)) {
    const existingRootTag = trimmedSubtreeHtml.match(/^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/)?.[0]
    if (existingRootTag) {
      return `${trimmedSubtreeHtml.replace(existingRootTag, `${existingRootTag.slice(0, -1)} ${attributes}>`)}${shadowInfo}`
    }
  }

  if (trimmedSubtreeHtml) {
    return `<${skeleton.tagName} ${attributes}>${trimmedSubtreeHtml}</${skeleton.tagName}>${shadowInfo}`
  }

  return `<${skeleton.tagName} ${attributes}></${skeleton.tagName}>${shadowInfo}`
}

const analyzePortableHtml = (html: string, targetClass: PortableTargetClass) => {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim()
  const elementTags = withoutScripts.match(/<([a-zA-Z][^\s/>]*)\b[^>]*>/g) || []
  const closingTags = withoutScripts.match(/<\/([a-zA-Z][^\s/>]*)>/g) || []
  const textLength = withoutScripts.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length
  const renderedElementCount = Math.max(0, elementTags.length)
  const hasOnlyRootShell = renderedElementCount <= 1 && closingTags.length <= 1 && textLength === 0
  const scenePrimitiveCount =
    (withoutScripts.match(/<(canvas|svg|video|img|piece|square|cg-board|cg-container|model-viewer|three-model|spline-viewer|lottie-player|dotlottie-player|iframe)\b/gi) || [])
      .length
  const absolutelyPositionedCount = (withoutScripts.match(/style\s*=\s*["'][^"']*position\s*:\s*absolute/gi) || []).length
  const sceneLayerHintCount =
    (withoutScripts.match(/\b(class|id|data-[a-z0-9_-]+)\s*=\s*["'][^"']*(board|scene|canvas|layer|sprite|piece|square|viewport|stage|overlay|backdrop)[^"']*["']/gi) || [])
      .length
  const sceneStructuralSignals = scenePrimitiveCount + absolutelyPositionedCount + sceneLayerHintCount
  const looksSceneLike = sceneStructuralSignals >= 2 || scenePrimitiveCount >= 1
  const isStructurallyThin = renderedElementCount <= 3 && textLength <= 8
  const shouldTreatThinHtmlAsFragile = targetClass !== 'render-scene' && isStructurallyThin

  return {
    renderedElementCount,
    textLength,
    hasOnlyRootShell,
    scenePrimitiveCount,
    absolutelyPositionedCount,
    sceneLayerHintCount,
    looksSceneLike,
    isStructurallyThin,
    shouldTreatThinHtmlAsFragile,
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

  const unresolvedRequiredAssets = getRequiredUnresolvedAssetCount(resourceGraph)
  const shadowMetadata = serializeShadowTopology(shadowTopology)
  const shadowRootCount = asArray(shadowTopology?.roots).length

  const shadowInfo = shadowMetadata
    ? `\n<script type="application/json" id="component-snap-shadow-topology">${escapeHtml(shadowMetadata)}</script>`
    : ''

  const targetClassHint = capture.seed.targetClassHint || capture.seed.targetFingerprint?.targetClassHint
  const targetSubtypeHint = capture.seed.targetSubtypeHint || capture.seed.targetFingerprint?.targetSubtypeHint
  const targetClassReasons = capture.seed.targetClassReasons || capture.seed.targetFingerprint?.targetClassReasons
  const { targetClass } = getPortableTargetClass(candidateSubtree, targetSubtree, targetClassHint)
  const exportMode = getPortableExportMode(targetClass)

  const exportSubtreeChoice = pickExportSubtreeHtml({
    selectedSelector,
    targetClass,
    targetClassHint,
    targetSubtypeHint,
    candidateSubtreeHtml: candidateSubtree?.html,
    targetSubtreeHtml: targetSubtree?.html,
  })
  const subtreeHtml = exportSubtreeChoice.html
  const html = materializeExportRoot(selectedSelector, subtreeHtml, shadowInfo)
  const htmlAnalysis = analyzePortableHtml(html, targetClass)

  const warnings = [
    'replay-capsule-portable-extractor-used',
    `replay-capsule-shadow-roots:${shadowRootCount}`,
    ...asArray(replayCapsule.diagnostics?.warnings).map((warning) => `replay-capsule-diagnostics:${warning}`),
  ]
  if (candidateSubtree?.html?.trim()) warnings.push('replay-capsule-candidate-subtree-used')
  if (targetClass === 'semantic-ui' && (targetSubtypeHint === 'search-like' || isSearchShellHtml(candidateSubtree?.html?.trim() || '', selectedSelector) || isSearchShellHtml(targetSubtree?.html?.trim() || '', selectedSelector))) {
    warnings.push('replay-capsule-search-shell-sanitized')
  }
  if (targetClassHint) warnings.push(`replay-capsule-target-class-hint:${targetClassHint}`)
  if (targetSubtypeHint) warnings.push(`replay-capsule-target-subtype-hint:${targetSubtypeHint}`)
  if (targetClassReasons?.length) warnings.push(...targetClassReasons.map((reason) => `replay-capsule-target-class-reason:${reason}`))
  if (subtreeHtml === (targetSubtree?.html?.trim() || '') && candidateSubtree?.html?.trim()) {
    if (targetClass === 'render-scene') warnings.push('replay-capsule-target-subtree-preferred-for-frame-integrity')
    else warnings.push('replay-capsule-target-subtree-preferred-for-wrapper-integrity')
  }
  if (exportSubtreeChoice.reasons.length > 0) {
    warnings.push(...exportSubtreeChoice.reasons.map((reason) => `replay-capsule-preservation-reason:${reason}`))
  }
  if (candidateSubtree?.reconstruction?.mode === 'scene-preserving') {
    warnings.push('replay-capsule-scene-preserving-subtree-used')
  }
  warnings.push(...asArray(candidateSubtree?.warnings).map((warning) => `replay-capsule-candidate-subtree:${warning}`))
  warnings.push(`replay-capsule-target-class:${targetClass}`)
  warnings.push(`replay-capsule-export-mode:${exportMode}`)
  warnings.push(`replay-capsule-rendered-elements:${htmlAnalysis.renderedElementCount}`)
  warnings.push(`replay-capsule-rendered-text-length:${htmlAnalysis.textLength}`)

  if (targetClass === 'render-scene') {
    warnings.push(`replay-capsule-scene-primitives:${htmlAnalysis.scenePrimitiveCount}`)
    warnings.push(`replay-capsule-scene-absolute-layers:${htmlAnalysis.absolutelyPositionedCount}`)
    warnings.push(`replay-capsule-scene-layer-hints:${htmlAnalysis.sceneLayerHintCount}`)
    if (htmlAnalysis.looksSceneLike) warnings.push('replay-capsule-scene-html-validated')
  } else if (htmlAnalysis.shouldTreatThinHtmlAsFragile) {
    warnings.push('replay-capsule-html-structurally-thin')
  }

  if (unresolvedRequiredAssets > 0) {
    warnings.push(`replay-capsule-required-assets-unresolved:${unresolvedRequiredAssets}`)
  }

  if (htmlAnalysis.hasOnlyRootShell) {
    warnings.push('replay-capsule-empty-shell-export')
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
    if (targetClass !== 'render-scene') confidencePenalty += 0.06
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
      rootSelector: '[data-csnap-root="true"]',
      js: buildPortableFallbackComponentJs('[data-csnap-root="true"]'),
    },
    diagnostics: {
      source: 'replay-capsule',
      targetClass,
      targetClassHint: capture.seed.targetFingerprint?.targetClassHint,
      targetSubtypeHint: capture.seed.targetFingerprint?.targetSubtypeHint,
      classReasons: capture.seed.targetFingerprint?.targetClassReasons,
      exportMode,
      warnings,
      confidencePenalty,
      confidence,
      outputQuality: 'portable',
    },
  }
}
