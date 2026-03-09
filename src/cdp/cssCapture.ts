import type { CDPClient } from './client'
import {
  normalizeMatchedStyleGraph,
  type ComputedStyleResponse,
  type InlineStylesResponse,
  type MatchedStylesResponse,
} from './cssCaptureNormalization'

export interface CSSCaptureResult {
  cssGraph?: ReturnType<typeof normalizeMatchedStyleGraph>
  warnings: string[]
}
export { normalizeMatchedStyleGraph } from './cssCaptureNormalization'

export const captureCSSProvenanceGraph = async (
  client: CDPClient,
  target: {
    nodeId: number
    backendNodeId?: number
    selector?: string
  },
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

  const cssGraph = normalizeMatchedStyleGraph({
    target,
    matched,
    computed,
    inline,
    warnings,
  })

  return { cssGraph, warnings: cssGraph.diagnostics?.warnings || warnings }
}
