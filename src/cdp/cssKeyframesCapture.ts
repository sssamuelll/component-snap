import type { CDPClient } from './client'
import type { MatchedStylesResponse } from './cssCaptureNormalization'

export interface KeyframeRuleV0 {
  name: string
  cssText: string
}

export interface ParsedKeyframeRule extends KeyframeRuleV0 {
  isVendorPrefixed: boolean
}

interface GetStyleSheetTextResponse {
  text?: string
}

const stripQuotes = (input: string) => input.replace(/^["']|["']$/g, '')

const KEYFRAMES_HEADER_PATTERN =
  /@(-webkit-)?keyframes\s+([A-Za-z_][\w-]*|"[^"]*"|'[^']*')\s*\{/g

export const parseKeyframeRulesFromStylesheet = (text: string): ParsedKeyframeRule[] => {
  const rules: ParsedKeyframeRule[] = []
  if (!text) return rules

  const pattern = new RegExp(KEYFRAMES_HEADER_PATTERN.source, KEYFRAMES_HEADER_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const openBraceIndex = pattern.lastIndex - 1
    const rawName = match[2] || ''
    const name = stripQuotes(rawName.trim())
    if (!name) continue
    const isVendorPrefixed = !!match[1]

    let depth = 1
    let i = openBraceIndex + 1
    while (i < text.length && depth > 0) {
      const ch = text[i]

      if (ch === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2)
        i = end === -1 ? text.length : end + 2
        continue
      }

      if (ch === '"' || ch === "'") {
        const quote = ch
        let j = i + 1
        while (j < text.length) {
          if (text[j] === '\\') {
            j += 2
            continue
          }
          if (text[j] === quote) break
          j++
        }
        i = j + 1
        continue
      }

      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }

    if (depth !== 0) continue

    const closeBraceIndex = i - 1
    const inner = text.slice(openBraceIndex + 1, closeBraceIndex)
    rules.push({
      name,
      cssText: `@keyframes ${name} {${inner}}`,
      isVendorPrefixed,
    })

    pattern.lastIndex = i
  }

  return rules
}

const collectStyleSheetIds = (matched: MatchedStylesResponse | undefined): string[] => {
  const ids = new Set<string>()
  for (const match of matched?.matchedCSSRules || []) {
    const rule = match?.rule
    if (!rule) continue
    const id = (rule.style?.styleSheetId || rule.styleSheetId || '').trim()
    if (id) ids.add(id)
  }
  return [...ids]
}

export const captureKeyframeRules = async (
  client: CDPClient,
  matched: MatchedStylesResponse | undefined,
  warnings: string[],
): Promise<ParsedKeyframeRule[]> => {
  const styleSheetIds = collectStyleSheetIds(matched)
  if (!styleSheetIds.length) return []

  const parsed: ParsedKeyframeRule[] = []
  for (const styleSheetId of styleSheetIds) {
    try {
      const response = await client.send<GetStyleSheetTextResponse>('CSS.getStyleSheetText', { styleSheetId })
      const text = response?.text || ''
      parsed.push(...parseKeyframeRulesFromStylesheet(text))
    } catch {
      warnings.push(`keyframes-stylesheet-text-unavailable:${styleSheetId}`)
    }
  }

  return parsed
}

export const resolveKeyframes = (
  referencedNames: string[],
  parsedRules: ParsedKeyframeRule[] | undefined,
  warnings: string[],
): KeyframeRuleV0[] => {
  if (!referencedNames.length) return []

  // Dedupe by name: non-prefixed wins; on ties (both prefixed or both non-prefixed)
  // the last definition encountered wins.
  const byName = new Map<string, ParsedKeyframeRule>()
  for (const rule of parsedRules || []) {
    const existing = byName.get(rule.name)
    if (!existing) {
      byName.set(rule.name, rule)
      continue
    }
    if (existing.isVendorPrefixed && !rule.isVendorPrefixed) {
      byName.set(rule.name, rule)
    } else if (existing.isVendorPrefixed === rule.isVendorPrefixed) {
      byName.set(rule.name, rule)
    }
  }

  const resolved: KeyframeRuleV0[] = []
  for (const name of referencedNames) {
    const rule = byName.get(name)
    if (!rule) {
      warnings.push(`keyframes-name-undefined:${name}`)
      continue
    }
    resolved.push({ name: rule.name, cssText: rule.cssText })
  }
  return resolved
}
