import type { MatchedStyleGraphV0, MatchedRuleV0, StyleDeclarationV0 } from './types'

type CSSRuleOrigin = 'regular' | 'user-agent' | 'injected' | 'inspector' | 'inline'

type CSSProperty = {
  name?: string
  value?: string
  important?: boolean
  disabled?: boolean
  implicit?: boolean
}

type CSSStyle = {
  cssProperties?: CSSProperty[]
  styleSheetId?: string
  range?: {
    startLine?: number
    startColumn?: number
  }
}

type CSSSelector = { text?: string }
type CSSMedia = { text?: string }
type CSSSupports = { text?: string }
type CSSLayer = { text?: string; name?: string }

type CSSRule = {
  origin?: CSSRuleOrigin
  styleSheetId?: string
  sourceURL?: string
  selectorList?: {
    selectors?: CSSSelector[]
    text?: string
  }
  style?: CSSStyle
  media?: CSSMedia[]
  supports?: CSSSupports[]
  layer?: CSSLayer
}

type RuleMatch = {
  rule?: CSSRule
}

export type MatchedStylesResponse = {
  matchedCSSRules?: RuleMatch[]
}

export type ComputedStyleResponse = {
  computedStyle?: Array<{ name?: string; value?: string }>
}

export type InlineStylesResponse = {
  inlineStyle?: CSSStyle
}

export type NormalizeInput = {
  target: {
    nodeId?: number
    backendNodeId?: number
    selector?: string
  }
  matched?: MatchedStylesResponse
  computed?: ComputedStyleResponse
  inline?: InlineStylesResponse
  warnings?: string[]
}

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

const parseDeclaration = (property: CSSProperty): StyleDeclarationV0 | null => {
  const name = (property.name || '').trim()
  const value = (property.value || '').trim()
  if (!name) return null
  return {
    name,
    value,
    important: property.important || undefined,
    disabled: property.disabled || undefined,
    implicit: property.implicit || undefined,
  }
}

const normalizeDeclarations = (style?: CSSStyle): StyleDeclarationV0[] =>
  asArray(style?.cssProperties).map(parseDeclaration).filter((declaration): declaration is StyleDeclarationV0 => !!declaration)

const normalizeSpaces = (value: string) => value.replace(/\s+/g, ' ').trim()

const splitSelectorListText = (value: string): string[] =>
  value
    .split(',')
    .map((selector) => normalizeSpaces(selector))
    .filter(Boolean)

const normalizeSelectorList = (selectorList?: CSSRule['selectorList']): string[] => {
  const cleaned: string[] = []

  for (const selector of asArray(selectorList?.selectors)) {
    for (const token of splitSelectorListText(selector.text || '')) {
      if (!cleaned.includes(token)) cleaned.push(token)
    }
  }

  if (!cleaned.length && selectorList?.text) {
    for (const token of splitSelectorListText(selectorList.text)) {
      if (!cleaned.includes(token)) cleaned.push(token)
    }
  }

  return cleaned
}

const normalizeSourceUrl = (sourceURL?: string) => {
  const value = (sourceURL || '').trim()
  return value || undefined
}

const normalizeStyleSheetMetadata = (rule: CSSRule) => {
  const styleSheetId = (rule.styleSheetId || rule.style?.styleSheetId || '').trim() || undefined
  const sourceURL = normalizeSourceUrl(rule.sourceURL)
  const isInline =
    rule.origin === 'inline' ||
    !!styleSheetId?.startsWith('inspector-inline-sheet') ||
    !!sourceURL?.startsWith('inspector://')

  return {
    styleSheetId,
    sourceURL,
    isInline,
    startLine: typeof rule.style?.range?.startLine === 'number' ? rule.style.range.startLine : undefined,
    startColumn: typeof rule.style?.range?.startColumn === 'number' ? rule.style.range.startColumn : undefined,
  }
}

const normalizeRuleOrigin = (rule: CSSRule, isInline: boolean): MatchedRuleV0['origin'] => {
  if (rule.origin) return rule.origin
  if (isInline) return 'inline'
  return undefined
}

const normalizeRule = (match: RuleMatch): MatchedRuleV0 | null => {
  const rule = match.rule
  if (!rule) return null

  const stylesheet = normalizeStyleSheetMetadata(rule)

  return {
    origin: normalizeRuleOrigin(rule, stylesheet.isInline),
    selectorList: normalizeSelectorList(rule.selectorList),
    stylesheet,
    media: asArray(rule.media).map((entry) => entry.text || '').filter(Boolean),
    supports: asArray(rule.supports).map((entry) => entry.text || '').filter(Boolean),
    layer: rule.layer?.text || rule.layer?.name,
    declarations: normalizeDeclarations(rule.style),
  }
}

const ANIMATION_KEYWORDS = new Set([
  'infinite',
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse',
  'forwards',
  'backwards',
  'both',
  'none',
  'running',
  'paused',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'linear',
  'step-start',
  'step-end',
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
])

const looksLikeDurationOrDelay = (token: string) => /^-?[\d.]+m?s$/i.test(token)
const looksLikeIterationCount = (token: string) => /^-?[\d.]+$/.test(token)
const stripQuotes = (input: string) => input.replace(/^["']|["']$/g, '')

const extractAnimationNameFromShorthandChunk = (chunk: string): string | undefined => {
  const tokens = chunk
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  const candidate = tokens.find((token) => {
    if (ANIMATION_KEYWORDS.has(token.toLowerCase())) return false
    if (looksLikeDurationOrDelay(token)) return false
    if (looksLikeIterationCount(token)) return false
    if (token.startsWith('cubic-bezier(') || token.startsWith('steps(')) return false
    return true
  })

  if (!candidate) return undefined
  const normalized = stripQuotes(candidate.trim())
  if (!normalized || normalized === 'none') return undefined
  return normalized
}

const pushUnique = (items: string[], value: string) => {
  if (!items.includes(value)) items.push(value)
}

type KeyframeSource = 'inline' | 'matched' | 'computed'

type KeyframeDeclaration = {
  name: string
  value: string
  source: KeyframeSource
}

const deriveKeyframeNames = (sources: KeyframeDeclaration[]) => {
  const names: string[] = []
  let usedHeuristic = false
  let fromComputed = false

  for (const declaration of sources) {
    const propertyName = declaration.name.toLowerCase()
    if (propertyName === 'animation-name') {
      for (const token of declaration.value.split(',')) {
        const name = stripQuotes(token.trim())
        if (!name || name === 'none') continue
        pushUnique(names, name)
        if (declaration.source === 'computed') fromComputed = true
      }
    }

    if (propertyName === 'animation') {
      usedHeuristic = true
      for (const chunk of declaration.value.split(',')) {
        const name = extractAnimationNameFromShorthandChunk(chunk.trim())
        if (name) {
          pushUnique(names, name)
          if (declaration.source === 'computed') fromComputed = true
        }
      }
    }
  }

  return { names, usedHeuristic, fromComputed }
}

type CustomPropertyEntry = { name: string; value: string; source?: string }

const collectCustomProperties = (
  rules: MatchedRuleV0[],
  inlineDeclarations: StyleDeclarationV0[],
  computed: Array<{ name: string; value: string }>,
) => {
  const computedByName = new Map<string, string>()
  for (const declaration of computed) {
    if (!declaration.name.startsWith('--')) continue
    if (!computedByName.has(declaration.name)) computedByName.set(declaration.name, declaration.value)
  }

  const entries: CustomPropertyEntry[] = []
  const seen = new Set<string>()
  const declaredNames = new Set<string>()
  const referencedNames = new Set<string>()

  const pushEntry = (name: string, value: string, source?: string) => {
    const key = `${name}|${value}|${source || ''}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ name, value, source })
  }

  const parseVarReferences = (value: string) => {
    const names: string[] = []
    const regex = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:[,)]|$)/g
    let match = regex.exec(value)
    while (match) {
      const name = match[1]
      if (name && !names.includes(name)) names.push(name)
      match = regex.exec(value)
    }
    return names
  }

  const pushReference = (name: string, source: string) => {
    referencedNames.add(name)
    const computedValue = computedByName.get(name) || ''
    pushEntry(name, computedValue, source)
  }

  for (const declaration of inlineDeclarations) {
    if (declaration.name.startsWith('--')) {
      declaredNames.add(declaration.name)
      pushEntry(declaration.name, declaration.value, 'inline')
    }
    for (const name of parseVarReferences(declaration.value)) pushReference(name, 'reference:inline')
  }

  for (const rule of rules) {
    const source = `rule:${rule.selectorList.join(', ') || 'unknown'}`
    for (const declaration of rule.declarations) {
      if (declaration.name.startsWith('--')) {
        declaredNames.add(declaration.name)
        pushEntry(declaration.name, declaration.value, source)
      }
      for (const name of parseVarReferences(declaration.value)) pushReference(name, `reference:${source}`)
    }
  }

  for (const declaration of computed) {
    if (declaration.name.startsWith('--')) {
      declaredNames.add(declaration.name)
      pushEntry(declaration.name, declaration.value, 'computed')
    }
    for (const name of parseVarReferences(declaration.value)) pushReference(name, 'reference:computed')
  }

  const referenceOnlyNames = [...referencedNames].filter((name) => !declaredNames.has(name))
  const unresolvedReferenceNames = referenceOnlyNames.filter((name) => !computedByName.has(name))

  return {
    entries,
    referenceOnlyNames,
    unresolvedReferenceNames,
    referenceCount: referencedNames.size,
  }
}

const normalizeComputedDeclarations = (
  computed: ComputedStyleResponse | undefined,
  warnings: string[],
): Array<{ name: string; value: string }> => {
  if (computed?.computedStyle && !Array.isArray(computed.computedStyle)) warnings.push('computed-style-malformed')

  return asArray(computed?.computedStyle)
    .map((entry) => ({
      name: (entry.name || '').trim(),
      value: (entry.value || '').trim(),
    }))
    .filter((entry) => entry.name.length > 0)
}

const normalizeMatchedRules = (matched: MatchedStylesResponse | undefined, warnings: string[]) => {
  if (matched?.matchedCSSRules && !Array.isArray(matched.matchedCSSRules)) warnings.push('matched-rules-malformed')

  return asArray(matched?.matchedCSSRules).map(normalizeRule).filter((rule): rule is MatchedRuleV0 => !!rule)
}

const hasIncompleteStylesheetMetadata = (rule: MatchedRuleV0) => {
  const styleSheetId = rule.stylesheet?.styleSheetId
  const sourceURL = rule.stylesheet?.sourceURL
  if (rule.stylesheet?.isInline) return false
  if (styleSheetId && sourceURL) return false
  if (!styleSheetId && !sourceURL) return false
  return true
}

export const normalizeMatchedStyleGraph = (input: NormalizeInput): MatchedStyleGraphV0 => {
  const warnings = [...(input.warnings || [])]

  const matchedRules = normalizeMatchedRules(input.matched, warnings)
  if (!matchedRules.length) warnings.push('matched-rules-empty')

  const computed = normalizeComputedDeclarations(input.computed, warnings)
  if (!computed.length) warnings.push('computed-style-empty')
  if (!matchedRules.length && computed.length > 0) warnings.push('provenance-degraded-computed-only')

  if (input.inline?.inlineStyle?.cssProperties && !Array.isArray(input.inline.inlineStyle.cssProperties)) {
    warnings.push('inline-style-malformed')
  }
  const inlineDeclarations = normalizeDeclarations(input.inline?.inlineStyle)
  if (!inlineDeclarations.length) warnings.push('inline-style-empty')

  const selectorsMissing = matchedRules.some((rule) => rule.selectorList.length === 0)
  if (selectorsMissing) warnings.push('selector-list-empty')

  const missingRuleOrigin = matchedRules.some((rule) => !rule.origin)
  if (missingRuleOrigin) warnings.push('rule-origin-missing')

  const stylesheetSourceMissing = matchedRules.some(
    (rule) => rule.stylesheet?.styleSheetId && !rule.stylesheet?.sourceURL && !rule.stylesheet?.isInline,
  )
  if (stylesheetSourceMissing) warnings.push('stylesheet-source-missing')

  const stylesheetMetadataIncomplete = matchedRules.some(hasIncompleteStylesheetMetadata)
  if (stylesheetMetadataIncomplete) warnings.push('stylesheet-metadata-incomplete')

  const keyframeSourceDeclarations: KeyframeDeclaration[] = [
    ...inlineDeclarations.map((declaration) => ({ name: declaration.name, value: declaration.value, source: 'inline' as const })),
    ...matchedRules
      .flatMap((rule) => rule.declarations)
      .map((declaration) => ({ name: declaration.name, value: declaration.value, source: 'matched' as const })),
    ...computed.map((declaration) => ({ name: declaration.name, value: declaration.value, source: 'computed' as const })),
  ]
  const keyframeResult = deriveKeyframeNames(keyframeSourceDeclarations)
  if (keyframeResult.usedHeuristic && keyframeResult.names.length > 0) warnings.push('keyframes-derived-heuristically')
  if (keyframeResult.fromComputed) warnings.push('keyframes-from-computed')

  const customPropertyResult = collectCustomProperties(matchedRules, inlineDeclarations, computed)
  if (customPropertyResult.referenceOnlyNames.length > 0) warnings.push('custom-property-reference-only')
  if (customPropertyResult.unresolvedReferenceNames.length > 0) warnings.push('custom-property-reference-unresolved')
  if ((input.computed?.computedStyle || []).length === 0) warnings.push('custom-properties-partial')

  const stylesheetCount = new Set(
    matchedRules.map((rule) => rule.stylesheet?.styleSheetId).filter((value): value is string => !!value),
  ).size
  const matchedRuleWithOriginCount = matchedRules.filter((rule) => !!rule.origin).length
  const matchedRuleWithoutOriginCount = matchedRules.length - matchedRuleWithOriginCount
  const matchedRuleWithoutSelectorCount = matchedRules.filter((rule) => rule.selectorList.length === 0).length
  const matchedRuleUserAgentCount = matchedRules.filter((rule) => rule.origin === 'user-agent').length
  const matchedRuleWithIncompleteStylesheetMetadataCount = matchedRules.filter(hasIncompleteStylesheetMetadata).length

  return {
    target: input.target,
    inline: { declarations: inlineDeclarations },
    matchedRules,
    computed,
    customProperties: customPropertyResult.entries,
    keyframes: keyframeResult.names,
    diagnostics: {
      stylesheetCount,
      ruleCount: matchedRules.length,
      computedCount: computed.length,
      inlineDeclarationCount: inlineDeclarations.length,
      customPropertyCount: customPropertyResult.entries.length,
      customPropertyReferenceCount: customPropertyResult.referenceCount,
      customPropertyReferenceOnlyCount: customPropertyResult.referenceOnlyNames.length,
      unresolvedCustomPropertyReferenceCount: customPropertyResult.unresolvedReferenceNames.length,
      keyframeCount: keyframeResult.names.length,
      matchedRuleWithOriginCount,
      matchedRuleWithoutOriginCount,
      matchedRuleWithoutSelectorCount,
      matchedRuleUserAgentCount,
      matchedRuleWithIncompleteStylesheetMetadataCount,
      warnings: Array.from(new Set(warnings)),
    },
  }
}
