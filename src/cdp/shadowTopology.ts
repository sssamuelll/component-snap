import type { CDPClient } from './client'
import type { ShadowTopologyRootV0, ShadowTopologySheetV0, ShadowTopologyV0 } from './types'

type DOMNode = {
  nodeId?: number
  backendNodeId?: number
  nodeName?: string
  attributes?: string[]
  children?: DOMNode[]
  shadowRoots?: DOMNode[]
  shadowRootType?: 'open' | 'closed' | string
}

type DOMDocumentResponse = {
  root?: DOMNode
}

type RuntimeEvalResponse = {
  result?: {
    value?: RuntimeAdoptedStylesResult
  }
}

type RuntimeAdoptedStylesResult = {
  roots?: Array<{
    depth?: number
    host?: {
      tagName?: string
      id?: string
      classList?: string[]
    }
    adoptedStyleSheets?: ShadowTopologySheetV0[]
  }>
}

export interface ShadowTopologyCaptureResult {
  shadowTopology?: ShadowTopologyV0
  warnings: string[]
}

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

const normalizeMode = (value?: string): ShadowTopologyRootV0['mode'] => {
  if (value === 'open') return 'open'
  if (value === 'closed') return 'closed'
  return 'unknown'
}

const getAttribute = (attributes: string[] | undefined, name: string): string | undefined => {
  const entries = asArray(attributes)
  for (let i = 0; i < entries.length; i += 2) {
    if ((entries[i] || '').toLowerCase() !== name.toLowerCase()) continue
    return entries[i + 1] || undefined
  }
  return undefined
}

const toClassList = (value: string | undefined): string[] | undefined => {
  const classList = (value || '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
  return classList.length ? classList : undefined
}

const normalizeTagName = (value: string | undefined) => {
  const tagName = (value || '').trim().toLowerCase()
  return tagName || undefined
}

const rootKey = (root: Pick<ShadowTopologyRootV0, 'depth' | 'host'>) => {
  const host = root.host
  return [
    String(root.depth),
    normalizeTagName(host?.tagName || host?.nodeName) || '',
    (host?.id || '').trim(),
    (host?.classList || []).join('.'),
  ].join('|')
}

const sortRoots = (roots: ShadowTopologyRootV0[]) => {
  roots.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    const aKey = rootKey(a)
    const bKey = rootKey(b)
    return aKey.localeCompare(bKey)
  })
}

const collectTopologyRoots = (root: DOMNode | undefined) => {
  const roots: ShadowTopologyRootV0[] = []

  const walk = (node: DOMNode | undefined, currentDepth: number) => {
    if (!node) return
    const shadowRoots = asArray(node.shadowRoots)
    for (const shadowRoot of shadowRoots) {
      const id = getAttribute(node.attributes, 'id')
      const classList = toClassList(getAttribute(node.attributes, 'class'))
      roots.push({
        mode: normalizeMode(shadowRoot.shadowRootType),
        depth: currentDepth + 1,
        host: {
          nodeId: node.nodeId,
          backendNodeId: node.backendNodeId,
          nodeName: node.nodeName,
          tagName: normalizeTagName(node.nodeName),
          id,
          classList,
        },
      })
      walk(shadowRoot, currentDepth + 1)
    }

    for (const child of asArray(node.children)) walk(child, currentDepth)
  }

  walk(root, 0)
  sortRoots(roots)
  return roots
}

const captureAdoptedStylesExpression = `(() => {
  const asArray = (value) => Array.isArray(value) ? value : []
  const normalizeHost = (host) => {
    if (!host) return undefined
    const classList = Array.from(host.classList || []).map((token) => String(token || '').trim()).filter(Boolean)
    return {
      tagName: (host.tagName || '').toLowerCase() || undefined,
      id: host.id || undefined,
      classList: classList.length ? classList : undefined,
    }
  }

  const readSheet = (sheet, index) => {
    let ruleCount
    try {
      ruleCount = typeof sheet.cssRules?.length === 'number' ? sheet.cssRules.length : undefined
    } catch (_error) {
      ruleCount = undefined
    }
    let mediaText
    try {
      mediaText = sheet.media?.mediaText || undefined
    } catch (_error) {
      mediaText = undefined
    }
    return {
      index,
      href: sheet.href || undefined,
      disabled: sheet.disabled || undefined,
      mediaText,
      title: sheet.title || undefined,
      ruleCount,
      constructed: !sheet.href,
    }
  }

  const roots = []
  const seenHosts = new WeakSet()

  const walkRoot = (shadowRoot, depth, host) => {
    if (!shadowRoot || !host || seenHosts.has(host)) return
    seenHosts.add(host)

    const adopted = asArray(shadowRoot.adoptedStyleSheets).map((sheet, index) => readSheet(sheet, index))
    roots.push({
      depth,
      host: normalizeHost(host),
      adoptedStyleSheets: adopted,
    })

    const walker = document.createTreeWalker(shadowRoot, NodeFilter.SHOW_ELEMENT)
    let node = walker.nextNode()
    while (node) {
      if (node.shadowRoot) walkRoot(node.shadowRoot, depth + 1, node)
      node = walker.nextNode()
    }
  }

  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.shadowRoot) walkRoot(el.shadowRoot, 1, el)
  }

  return { roots }
})()`

const captureAdoptedStyleSheetMetadata = async (client: CDPClient) => {
  const response = await client.send<RuntimeEvalResponse>('Runtime.evaluate', {
    expression: captureAdoptedStylesExpression,
    returnByValue: true,
    awaitPromise: false,
  })
  return asArray(response.result?.value?.roots).map((root) => ({
    depth: typeof root.depth === 'number' ? root.depth : 1,
    host: {
      tagName: normalizeTagName(root.host?.tagName),
      id: (root.host?.id || '').trim() || undefined,
      classList: asArray(root.host?.classList).map((token) => token.trim()).filter(Boolean),
    },
    adoptedStyleSheets: asArray(root.adoptedStyleSheets).map((sheet, index) => ({
      index: typeof sheet.index === 'number' ? sheet.index : index,
      href: (sheet.href || '').trim() || undefined,
      disabled: !!sheet.disabled || undefined,
      mediaText: (sheet.mediaText || '').trim() || undefined,
      title: (sheet.title || '').trim() || undefined,
      ruleCount: typeof sheet.ruleCount === 'number' ? sheet.ruleCount : undefined,
      constructed: !!sheet.constructed || undefined,
    })),
  }))
}

const mergeAdoptedStylesIntoRoots = (
  roots: ShadowTopologyRootV0[],
  adoptedRoots: Array<{ depth: number; host: { tagName?: string; id?: string; classList: string[] }; adoptedStyleSheets: ShadowTopologySheetV0[] }>,
) => {
  const warnings: string[] = []
  const byKey = new Map<string, ShadowTopologyRootV0[]>()

  for (const root of roots) {
    if (root.mode !== 'open') continue
    const key = rootKey(root)
    const existing = byKey.get(key)
    if (existing) existing.push(root)
    else byKey.set(key, [root])
  }

  for (const adopted of adoptedRoots) {
    const key = rootKey({
      depth: adopted.depth,
      host: {
        tagName: adopted.host.tagName,
        id: adopted.host.id,
        classList: adopted.host.classList,
      },
    })

    const matches = byKey.get(key)
    if (matches?.length) {
      const match = matches.shift()
      if (match) match.adoptedStyleSheets = adopted.adoptedStyleSheets
      continue
    }

    roots.push({
      mode: 'open',
      depth: adopted.depth,
      host: {
        tagName: adopted.host.tagName,
        id: adopted.host.id,
        classList: adopted.host.classList.length ? adopted.host.classList : undefined,
      },
      adoptedStyleSheets: adopted.adoptedStyleSheets,
    })
    warnings.push('adopted-stylesheets-host-unmapped')
  }

  sortRoots(roots)
  return warnings
}

export const captureShadowTopology = async (client: CDPClient): Promise<ShadowTopologyCaptureResult> => {
  const warnings = new Set<string>()
  let roots: ShadowTopologyRootV0[] = []

  try {
    const dom = await client.send<DOMDocumentResponse>('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })
    roots = collectTopologyRoots(dom.root)
  } catch (error) {
    warnings.add(`shadow-topology-unavailable: ${String(error)}`)
    return { warnings: Array.from(warnings) }
  }

  try {
    const adopted = await captureAdoptedStyleSheetMetadata(client)
    const mergeWarnings = mergeAdoptedStylesIntoRoots(roots, adopted)
    for (const warning of mergeWarnings) warnings.add(warning)
  } catch (error) {
    warnings.add('adopted-stylesheets-metadata-failed')
    warnings.add(`adopted-stylesheets-metadata-failed: ${String(error)}`)
  }

  const totalShadowRoots = roots.length
  const openShadowRootCount = roots.filter((root) => root.mode === 'open').length
  const closedShadowRootCount = roots.filter((root) => root.mode === 'closed').length
  const unknownShadowRootCount = roots.filter((root) => root.mode === 'unknown').length
  const maxShadowDepth = roots.reduce((max, root) => Math.max(max, root.depth), 0)
  const adoptedStyleSheetRootCount = roots.filter((root) => asArray(root.adoptedStyleSheets).length > 0).length
  const adoptedStyleSheetCount = roots.reduce((count, root) => count + asArray(root.adoptedStyleSheets).length, 0)

  if (!totalShadowRoots) warnings.add('shadow-topology-empty')
  if (closedShadowRootCount > 0) warnings.add('closed-shadow-root-unavailable')
  if (closedShadowRootCount > 0) warnings.add('adopted-stylesheets-open-roots-only')

  const diagnosticsWarnings = Array.from(warnings)
  const shadowTopology: ShadowTopologyV0 = {
    roots,
    diagnostics: {
      totalShadowRoots,
      openShadowRootCount,
      closedShadowRootCount,
      unknownShadowRootCount,
      maxShadowDepth,
      adoptedStyleSheetRootCount,
      adoptedStyleSheetCount,
      warnings: diagnosticsWarnings.length ? diagnosticsWarnings : undefined,
    },
  }

  return { shadowTopology, warnings: diagnosticsWarnings }
}
