import type { CDPClient } from './client'
import type { CaptureSeed, NodeMappingResult } from './types'

interface ResolveNodeResponse {
  object?: {
    objectId?: string
    subtype?: string
  }
}

interface RuntimeCallResult<T = unknown> {
  result?: {
    value?: T
  }
}

export interface TargetSubtreeV0 {
  source: 'runtime-object' | 'selector-fallback'
  html: string
  nodeCount: number
  elementCount: number
  textNodeCount: number
  textLength: number
  maxDepth: number
  warnings?: string[]
}

const MATERIALIZE_SUBTREE_FUNCTION = String(function materializeSubtree(this: Node) {
  const MAX_NODES = 300
  const MAX_DEPTH = 6
  const ALLOWED_ATTR_PREFIXES = ['aria-', 'data-']
  const ALLOWED_ATTRS = new Set([
    'id',
    'class',
    'role',
    'type',
    'name',
    'value',
    'placeholder',
    'href',
    'src',
    'alt',
    'title',
    'tabindex',
    'for',
    'viewbox',
    'viewBox',
    'd',
    'cx',
    'cy',
    'r',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'transform',
    'xmlns',
    'version',
    'preserveaspectratio',
    'preserveAspectRatio',
    'xlink:href',
  ])

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const escapeAttribute = (value: string) =>
    escapeHtml(value)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const shouldKeepAttribute = (name: string) => ALLOWED_ATTRS.has(name) || ALLOWED_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))

  let nodeCount = 0
  let elementCount = 0
  let textNodeCount = 0
  let textLength = 0
  let maxDepthSeen = 0
  const warnings: string[] = []

  const serializeNode = (node: Node, depth: number): string => {
    if (nodeCount >= MAX_NODES) {
      warnings.push('target-subtree-max-nodes-truncated')
      return ''
    }
    if (depth > MAX_DEPTH) {
      warnings.push('target-subtree-max-depth-truncated')
      return ''
    }

    nodeCount += 1
    if (depth > maxDepthSeen) maxDepthSeen = depth

    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (!text) return ''
      textNodeCount += 1
      textLength += text.length
      return escapeHtml(text)
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return ''

    const el = node as Element
    const tagName = el.tagName.toLowerCase()
    elementCount += 1

    const attrs = Array.from(el.attributes)
      .filter((attr) => shouldKeepAttribute(attr.name))
      .map((attr) => `${attr.name}="${escapeAttribute(attr.value)}"`)
      .join(' ')

    const open = attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`
    let inner = ''

    for (const child of Array.from(el.childNodes)) {
      inner += serializeNode(child, depth + 1)
    }

    const shadowRoot = (el as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot
    if (shadowRoot) {
      warnings.push('target-subtree-shadow-root-flattened')
      for (const child of Array.from(shadowRoot.childNodes)) {
        inner += serializeNode(child, depth + 1)
      }
    }

    return `${open}${inner}</${tagName}>`
  }

  const html = serializeNode(this, 0)
  return {
    html,
    nodeCount,
    elementCount,
    textNodeCount,
    textLength,
    maxDepth: maxDepthSeen,
    warnings: warnings.length ? Array.from(new Set(warnings)) : undefined,
  }
})

const resolveObjectId = async (client: CDPClient, nodeMapping: NodeMappingResult | undefined, seed: CaptureSeed) => {
  if (nodeMapping?.node?.objectId) return { objectId: nodeMapping.node.objectId, source: 'runtime-object' as const }

  if (nodeMapping?.node?.nodeId) {
    const resolved = await client.send<ResolveNodeResponse>('DOM.resolveNode', { nodeId: nodeMapping.node.nodeId })
    if (resolved.object?.objectId) return { objectId: resolved.object.objectId, source: 'runtime-object' as const }
  }

  const selector =
    seed.targetFingerprint?.promotedSelectedSelector ||
    seed.targetFingerprint?.promotedStableSelector ||
    seed.targetFingerprint?.selectedSelector ||
    seed.targetFingerprint?.stableSelector ||
    seed.selectedSelector ||
    seed.stableSelector

  if (!selector) return undefined

  const selected = await client.send<RuntimeCallResult<{ objectId?: string }>>('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    returnByValue: false,
    awaitPromise: false,
  })

  const objectId = (selected.result as { objectId?: string } | undefined)?.objectId
  if (!objectId) return undefined
  return { objectId, source: 'selector-fallback' as const }
}

export const captureTargetSubtree = async (
  client: CDPClient,
  nodeMapping: NodeMappingResult | undefined,
  seed: CaptureSeed,
): Promise<TargetSubtreeV0 | undefined> => {
  const resolved = await resolveObjectId(client, nodeMapping, seed)
  if (!resolved?.objectId) return undefined

  const response = await client.send<RuntimeCallResult<Omit<TargetSubtreeV0, 'source'>>>('Runtime.callFunctionOn', {
    objectId: resolved.objectId,
    functionDeclaration: `function() { return (${MATERIALIZE_SUBTREE_FUNCTION}).call(this); }`,
    returnByValue: true,
    awaitPromise: false,
  })

  const value = response.result?.value
  if (!value || typeof value !== 'object') return undefined

  return {
    source: resolved.source,
    html: String((value as { html?: unknown }).html || ''),
    nodeCount: Number((value as { nodeCount?: unknown }).nodeCount || 0),
    elementCount: Number((value as { elementCount?: unknown }).elementCount || 0),
    textNodeCount: Number((value as { textNodeCount?: unknown }).textNodeCount || 0),
    textLength: Number((value as { textLength?: unknown }).textLength || 0),
    maxDepth: Number((value as { maxDepth?: unknown }).maxDepth || 0),
    warnings: Array.isArray((value as { warnings?: unknown }).warnings)
      ? ((value as { warnings?: string[] }).warnings as string[])
      : undefined,
  }
}
