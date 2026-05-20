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

const VENDOR_PREFIX_PATTERN = /^@-(?:webkit|moz|o|ms)-keyframes/i

const KEYFRAMES_HEADER_PATTERN =
  /@(-webkit-|-moz-|-o-|-ms-)?keyframes\s+([A-Za-z_][\w-]*|"[^"]*"|'[^']*')\s*\{/g

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

// Enumerates every CSSKeyframesRule reachable from the page: document.styleSheets,
// every shadowRoot.styleSheets, and adoptedStyleSheets on document and shadowRoots.
// Cross-origin stylesheets throw on `.cssRules` and are skipped silently — those
// are still picked up by the CDP `CSS.getStyleSheetText` path when their
// styleSheetId appears in matched rules.
const ENUMERATE_KEYFRAMES_EXPRESSION = `(() => {
  const out = []
  const seenSheets = new WeakSet()
  const seenRoots = new WeakSet()

  const readSheet = (sheet) => {
    if (!sheet || seenSheets.has(sheet)) return
    seenSheets.add(sheet)
    let rules
    try {
      rules = Array.from(sheet.cssRules || [])
    } catch (_err) {
      return
    }
    for (const rule of rules) {
      const ctorName = rule && rule.constructor && rule.constructor.name
      const isKeyframes = rule && (rule.type === 7 || ctorName === 'CSSKeyframesRule')
      if (!isKeyframes) continue
      const name = String(rule.name || '').trim()
      const cssText = String(rule.cssText || '').trim()
      if (name && cssText) out.push({ name, cssText })
    }
  }

  const collectFromRoot = (root) => {
    if (!root || seenRoots.has(root)) return
    seenRoots.add(root)
    const sheets = root.styleSheets ? Array.from(root.styleSheets) : []
    for (const sheet of sheets) readSheet(sheet)
    const adopted = Array.isArray(root.adoptedStyleSheets) ? root.adoptedStyleSheets : []
    for (const sheet of adopted) readSheet(sheet)
    const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : []
    for (const el of all) if (el.shadowRoot) collectFromRoot(el.shadowRoot)
  }

  collectFromRoot(document)
  return out
})()`

interface RuntimeEvaluateValueResponse<T> {
  result?: { value?: T }
}

type RuntimeKeyframeEntry = { name?: unknown; cssText?: unknown }

export const captureKeyframesFromRuntime = async (
  client: CDPClient,
  warnings: string[],
): Promise<ParsedKeyframeRule[]> => {
  let response: RuntimeEvaluateValueResponse<RuntimeKeyframeEntry[]>
  try {
    response = await client.send<RuntimeEvaluateValueResponse<RuntimeKeyframeEntry[]>>('Runtime.evaluate', {
      expression: ENUMERATE_KEYFRAMES_EXPRESSION,
      returnByValue: true,
      awaitPromise: false,
    })
  } catch {
    warnings.push('keyframes-runtime-enumeration-failed')
    return []
  }

  const value = Array.isArray(response?.result?.value) ? response.result!.value! : []
  const result: ParsedKeyframeRule[] = []
  for (const entry of value) {
    const name = String(entry?.name || '').trim()
    const rawCssText = String(entry?.cssText || '').trim()
    if (!name || !rawCssText) continue
    const isVendorPrefixed = VENDOR_PREFIX_PATTERN.test(rawCssText)
    const cssText = isVendorPrefixed
      ? rawCssText.replace(VENDOR_PREFIX_PATTERN, '@keyframes')
      : rawCssText
    result.push({ name, cssText, isVendorPrefixed })
  }
  return result
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
