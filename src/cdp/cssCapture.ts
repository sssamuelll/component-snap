import type { CDPClient } from './client'
import {
  normalizeMatchedStyleGraph,
  type ComputedStyleResponse,
  type InlineStylesResponse,
  type MatchedStylesResponse,
} from './cssCaptureNormalization'
import { captureKeyframeRules, captureKeyframesFromRuntime } from './cssKeyframesCapture'

export interface CSSCaptureResult {
  cssGraph?: ReturnType<typeof normalizeMatchedStyleGraph>
  warnings: string[]
}
export { normalizeMatchedStyleGraph } from './cssCaptureNormalization'

type DOMNode = {
  nodeId?: number
  backendNodeId?: number
  nodeType?: number
  nodeName?: string
  children?: DOMNode[]
  shadowRoots?: DOMNode[]
  contentDocument?: DOMNode
}

type DOMDescribeNodeResponse = { node?: DOMNode }

interface RawRuleMatch {
  rule?: {
    origin?: string
    styleSheetId?: string
    sourceURL?: string
    selectorList?: { selectors?: Array<{ text?: string }>; text?: string }
    style?: { styleSheetId?: string; range?: { startLine?: number; startColumn?: number } }
  }
}

export interface SubtreeMatchedRulesResult {
  matchedCSSRules: RawRuleMatch[]
  warnings: string[]
  stats: {
    nodesWalked: number
    elementsConsidered: number
    matchedStyleCalls: number
    failedStyleCalls: number
    truncated: boolean
  }
}

const fingerprintRule = (match: RawRuleMatch): string => {
  const rule = match.rule
  if (!rule) return `null:${Math.random().toString(36)}`
  const sheetId = rule.styleSheetId || rule.style?.styleSheetId || ''
  const startLine = rule.style?.range?.startLine ?? ''
  const startColumn = rule.style?.range?.startColumn ?? ''
  const selectorText = (rule.selectorList?.selectors || [])
    .map((selector) => selector.text || '')
    .join(',') || rule.selectorList?.text || ''
  const origin = rule.origin || ''
  return `${origin}|${sheetId}|${startLine}|${startColumn}|${selectorText}`
}

const collectDescendantElementIds = (root: DOMNode, maxNodes: number, maxDepth: number) => {
  const ids: number[] = []
  let truncated = false
  let nodesWalked = 0

  const walk = (node: DOMNode, depth: number, isRoot: boolean) => {
    if (truncated) return
    nodesWalked += 1
    if (!isRoot && node.nodeType === 1 && typeof node.nodeId === 'number') {
      if (ids.length >= maxNodes) {
        truncated = true
        return
      }
      ids.push(node.nodeId)
    }
    if (depth >= maxDepth) return
    for (const child of node.children || []) walk(child, depth + 1, false)
    for (const shadow of node.shadowRoots || []) walk(shadow, depth + 1, false)
    if (node.contentDocument) walk(node.contentDocument, depth + 1, false)
  }

  walk(root, 0, true)
  return { ids, nodesWalked, truncated }
}

export const captureSubtreeMatchedRules = async (
  client: CDPClient,
  rootNodeId: number,
  options: { maxNodes?: number; maxDepth?: number } = {},
): Promise<SubtreeMatchedRulesResult> => {
  const maxNodes = options.maxNodes ?? 300
  const maxDepth = options.maxDepth ?? 8
  const warnings: string[] = []

  let tree: DOMNode | undefined
  try {
    const response = await client.send<DOMDescribeNodeResponse>('DOM.describeNode', {
      nodeId: rootNodeId,
      depth: -1,
      pierce: true,
    })
    tree = response.node
  } catch (error) {
    warnings.push(`subtree-describe-failed: ${String(error)}`)
    return {
      matchedCSSRules: [],
      warnings,
      stats: { nodesWalked: 0, elementsConsidered: 0, matchedStyleCalls: 0, failedStyleCalls: 0, truncated: false },
    }
  }

  if (!tree) {
    warnings.push('subtree-describe-empty')
    return {
      matchedCSSRules: [],
      warnings,
      stats: { nodesWalked: 0, elementsConsidered: 0, matchedStyleCalls: 0, failedStyleCalls: 0, truncated: false },
    }
  }

  const { ids, nodesWalked, truncated } = collectDescendantElementIds(tree, maxNodes, maxDepth)
  if (truncated) warnings.push(`subtree-walker-truncated:${maxNodes}`)

  const seen = new Set<string>()
  const combined: RawRuleMatch[] = []
  let matchedStyleCalls = 0
  let failedStyleCalls = 0

  for (const nodeId of ids) {
    matchedStyleCalls += 1
    try {
      const response = await client.send<MatchedStylesResponse>('CSS.getMatchedStylesForNode', { nodeId })
      for (const match of (response.matchedCSSRules as RawRuleMatch[] | undefined) || []) {
        const key = fingerprintRule(match)
        if (seen.has(key)) continue
        seen.add(key)
        combined.push(match)
      }
    } catch {
      failedStyleCalls += 1
    }
  }

  if (failedStyleCalls > 0) warnings.push(`subtree-matched-style-failures:${failedStyleCalls}`)

  return {
    matchedCSSRules: combined,
    warnings,
    stats: { nodesWalked, elementsConsidered: ids.length, matchedStyleCalls, failedStyleCalls, truncated },
  }
}

export const captureCSSProvenanceGraph = async (
  client: CDPClient,
  target: {
    nodeId: number
    backendNodeId?: number
    selector?: string
  },
  options: { walkSubtree?: boolean; subtreeMaxNodes?: number; subtreeMaxDepth?: number } = {},
): Promise<CSSCaptureResult> => {
  const warnings: string[] = []
  const failedCalls: string[] = []

  try {
    await client.send('CSS.enable')
  } catch (error) {
    warnings.push(`css-domain-unavailable: ${String(error)}`)
    return { warnings }
  }

  let matched: MatchedStylesResponse | undefined
  let computed: ComputedStyleResponse | undefined
  let inline: InlineStylesResponse | undefined

  try {
    matched = await client.send<MatchedStylesResponse>('CSS.getMatchedStylesForNode', { nodeId: target.nodeId })
  } catch (error) {
    failedCalls.push('matched')
    warnings.push('matched-styles-failed')
    warnings.push(`matched-styles-failed: ${String(error)}`)
  }

  try {
    computed = await client.send<ComputedStyleResponse>('CSS.getComputedStyleForNode', { nodeId: target.nodeId })
  } catch (error) {
    failedCalls.push('computed')
    warnings.push('computed-style-failed')
    warnings.push(`computed-style-failed: ${String(error)}`)
  }

  try {
    inline = await client.send<InlineStylesResponse>('CSS.getInlineStylesForNode', { nodeId: target.nodeId })
  } catch (error) {
    failedCalls.push('inline')
    warnings.push('inline-style-failed')
    warnings.push(`inline-style-failed: ${String(error)}`)
  }

  if (failedCalls.length > 0 && failedCalls.length < 3) warnings.push('css-capture-partial-failure')
  if (!matched && !computed && !inline) return { warnings: Array.from(new Set([...warnings, 'css-capture-no-data'])) }

  // Two complementary sources for @keyframes:
  // 1. CDP CSS.getStyleSheetText over matched stylesheets — survives cross-origin,
  //    but only covers sheets that have matched rules for this node.
  // 2. Runtime.evaluate walking document + shadowRoots + adoptedStyleSheets —
  //    finds @keyframes defined in any same-origin sheet (e.g. a shared
  //    animations.css that isn't matched by this element).
  // Runtime goes last so resolveKeyframes' last-wins tiebreaker picks it.
  const keyframeRulesFromMatched = await captureKeyframeRules(client, matched, warnings)
  const keyframeRulesFromRuntime = await captureKeyframesFromRuntime(client, warnings)
  const keyframeRules = [...keyframeRulesFromMatched, ...keyframeRulesFromRuntime]

  let combinedMatched: MatchedStylesResponse | undefined = matched

  if (options.walkSubtree) {
    const subtreeResult = await captureSubtreeMatchedRules(client, target.nodeId, {
      maxNodes: options.subtreeMaxNodes,
      maxDepth: options.subtreeMaxDepth,
    })
    warnings.push(...subtreeResult.warnings.map((warning) => `subtree: ${warning}`))
    warnings.push(`subtree-stats:nodes=${subtreeResult.stats.nodesWalked}`)
    warnings.push(`subtree-stats:elements=${subtreeResult.stats.elementsConsidered}`)
    warnings.push(`subtree-stats:matched-calls=${subtreeResult.stats.matchedStyleCalls}`)
    warnings.push(`subtree-stats:rules-merged=${subtreeResult.matchedCSSRules.length}`)

    const rootRuleFingerprints = new Set<string>()
    for (const ruleMatch of (matched?.matchedCSSRules as RawRuleMatch[] | undefined) || []) {
      rootRuleFingerprints.add(fingerprintRule(ruleMatch))
    }

    const subtreeOnlyRules = subtreeResult.matchedCSSRules.filter(
      (ruleMatch) => !rootRuleFingerprints.has(fingerprintRule(ruleMatch)),
    )

    const mergedRules = [...((matched?.matchedCSSRules as RawRuleMatch[] | undefined) || []), ...subtreeOnlyRules]
    combinedMatched = { matchedCSSRules: mergedRules as MatchedStylesResponse['matchedCSSRules'] }
  }

  const cssGraph = normalizeMatchedStyleGraph({
    target,
    matched: combinedMatched,
    computed,
    inline,
    keyframeRules,
    warnings,
  })

  return { cssGraph, warnings: cssGraph.diagnostics?.warnings || warnings }
}
