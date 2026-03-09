import type {
  CaptureBundleV0,
  MatchedRuleV0,
  ResourceGraphEdgeV0,
  ResourceGraphNodeV0,
  ResourceGraphV0,
  ShadowTopologyRootV0,
} from './types'

export interface BuildResourceGraphInput {
  pageUrl: string
  cssGraph?: CaptureBundleV0['cssGraph']
  shadowTopology?: CaptureBundleV0['shadowTopology']
  domSnapshotRaw?: unknown
}

export interface ResourceGraphBuildResult {
  resourceGraph: ResourceGraphV0
  warnings: string[]
}

type ResourceNodeKind = ResourceGraphNodeV0['kind']
type BundleMode = NonNullable<ResourceGraphV0['bundler']>['assets'][number]['fetchMode']

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : [])

const trimToken = (value: string | undefined) => (value || '').trim()

const unquote = (value: string) => value.replace(/^['"]|['"]$/g, '').trim()

const normalizeUrl = (value: string, baseUrl: string): string | undefined => {
  const trimmed = unquote(trimToken(value))
  if (!trimmed) return undefined
  if (trimmed.startsWith('#')) return trimmed
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed

  try {
    return new URL(trimmed, baseUrl).href
  } catch {
    return undefined
  }
}

const extractUrlsFromCssValue = (value: string): string[] => {
  const urls: string[] = []
  const regex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi
  let match = regex.exec(value)

  while (match) {
    const token = trimToken(match[2])
    if (token) urls.push(token)
    match = regex.exec(value)
  }

  return urls
}

const extractSvgFragmentRefs = (value: string): string[] => {
  const refs: string[] = []
  const regex = /url\(\s*['"]?#([^)\s'"#]+)['"]?\s*\)/gi
  let match = regex.exec(value)

  while (match) {
    const name = trimToken(match[1])
    if (name) refs.push(`#${name}`)
    match = regex.exec(value)
  }

  if (value.startsWith('#') && value.length > 1) refs.push(value)
  return refs
}

const hasExtension = (url: string, pattern: RegExp) => {
  const pathname = (() => {
    try {
      return new URL(url).pathname
    } catch {
      return url
    }
  })()
  return pattern.test(pathname)
}

const classifyDataUrl = (url: string): ResourceNodeKind => {
  const mime = url.slice(5, url.indexOf(';') > -1 ? url.indexOf(';') : undefined).toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('font/')) return 'font'
  if (mime.includes('javascript')) return 'script'
  if (mime.includes('css')) return 'stylesheet'
  return 'other'
}

const classifyResourceUrl = (url: string, declarationName?: string): ResourceNodeKind => {
  if (url.startsWith('data:')) return classifyDataUrl(url)

  const name = (declarationName || '').toLowerCase()
  if (hasExtension(url, /\.(woff2?|ttf|otf|eot)$/i) || name.includes('font')) return 'font'
  if (hasExtension(url, /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i)) return 'image'
  if (hasExtension(url, /\.css$/i)) return 'stylesheet'
  if (hasExtension(url, /\.(mjs|cjs|js)$/i)) return 'script'
  return 'other'
}

const describeRule = (rule: MatchedRuleV0, index: number) => {
  const selector = trimToken(rule.selectorList.join(', '))
  if (selector) return `css-rule:${index}:${selector}`
  return `css-rule:${index}`
}

const describeShadowRoot = (root: ShadowTopologyRootV0, index: number) => {
  const hostTag = trimToken(root.host?.tagName || root.host?.nodeName).toLowerCase() || 'unknown-host'
  const hostId = trimToken(root.host?.id)
  const suffix = hostId ? `${hostTag}#${hostId}` : hostTag
  return `shadow-root:${index}:${suffix}`
}

const extractLikelyAssetFromToken = (token: string): string | undefined => {
  const normalized = trimToken(token)
  if (!normalized) return undefined
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('//')) return normalized
  if (normalized.startsWith('data:') || normalized.startsWith('blob:')) return normalized
  if (/^(\/|\.\/|\.\.\/).+\.(css|mjs|cjs|js|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|bmp|ico)([?#].*)?$/i.test(normalized)) {
    return normalized
  }
  return undefined
}

const collectDomSnapshotStrings = (domSnapshotRaw: unknown): string[] => {
  if (!domSnapshotRaw || typeof domSnapshotRaw !== 'object') return []
  const strings = (domSnapshotRaw as { strings?: unknown[] }).strings
  return asArray(strings).filter((entry): entry is string => typeof entry === 'string')
}

export const buildResourceGraph = (input: BuildResourceGraphInput): ResourceGraphBuildResult => {
  const nodes: ResourceGraphNodeV0[] = []
  const edges: ResourceGraphEdgeV0[] = []
  const warnings = new Set<string>()
  const nodeByKey = new Map<string, string>()
  const edgeKeys = new Set<string>()

  let nodeCounter = 0

  const createNode = (node: Omit<ResourceGraphNodeV0, 'id'>) => {
    const key = [node.kind, node.url || '', node.ref || '', node.label || '', node.source || '', node.inline ? '1' : '0'].join('|')
    const existingId = nodeByKey.get(key)
    if (existingId) return existingId

    const id = `res_${nodeCounter++}`
    nodeByKey.set(key, id)
    nodes.push({ id, ...node })
    return id
  }

  const createEdge = (from: string, to: string, kind: ResourceGraphEdgeV0['kind'], reason?: string) => {
    const key = `${from}|${to}|${kind}|${reason || ''}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind, reason })
  }

  const documentNodeId = createNode({
    kind: 'document',
    label: 'document',
    url: input.pageUrl,
    source: 'capture',
  })

  for (const [ruleIndex, rule] of asArray(input.cssGraph?.matchedRules).entries()) {
    const ruleNodeId = createNode({
      kind: 'origin',
      label: describeRule(rule, ruleIndex),
      source: 'cssGraph',
    })
    createEdge(documentNodeId, ruleNodeId, 'contains', 'css-rule')

    const sourceUrl = trimToken(rule.stylesheet?.sourceURL)
    if (sourceUrl) {
      const stylesheetNodeId = createNode({
        kind: 'stylesheet',
        label: sourceUrl,
        url: normalizeUrl(sourceUrl, input.pageUrl) || sourceUrl,
        source: 'cssGraph',
      })
      createEdge(ruleNodeId, stylesheetNodeId, 'references', 'matched-rule-stylesheet')
    }

    for (const declaration of asArray(rule.declarations)) {
      const refs = extractSvgFragmentRefs(declaration.value || '')
      for (const ref of refs) {
        const refNodeId = createNode({
          kind: 'svg-reference',
          label: ref,
          ref,
          source: 'cssGraph',
        })
        createEdge(ruleNodeId, refNodeId, 'references', `declaration:${declaration.name}`)
      }

      for (const token of extractUrlsFromCssValue(declaration.value || '')) {
        const normalized = normalizeUrl(token, input.pageUrl)
        if (!normalized || normalized.startsWith('#')) continue

        const kind = classifyResourceUrl(normalized, declaration.name)
        const nodeId = createNode({
          kind,
          label: normalized,
          url: normalized,
          source: 'cssGraph',
        })
        createEdge(ruleNodeId, nodeId, 'references', `declaration:${declaration.name}`)
      }
    }
  }

  for (const [rootIndex, root] of asArray(input.shadowTopology?.roots).entries()) {
    const sheets = asArray(root.adoptedStyleSheets)
    if (!sheets.length) continue

    const rootNodeId = createNode({
      kind: 'origin',
      label: describeShadowRoot(root, rootIndex),
      source: 'shadowTopology',
    })
    createEdge(documentNodeId, rootNodeId, 'contains', 'shadow-root')

    for (const [sheetIndex, sheet] of sheets.entries()) {
      const href = trimToken(sheet.href)
      if (href) {
        const normalized = normalizeUrl(href, input.pageUrl)
        if (!normalized || normalized.startsWith('#')) {
          warnings.add('adopted-stylesheet-invalid-href')
          continue
        }

        const sheetNodeId = createNode({
          kind: 'stylesheet',
          label: normalized,
          url: normalized,
          source: 'shadowTopology',
        })
        createEdge(rootNodeId, sheetNodeId, 'references', `adoptedStyleSheet:${sheetIndex}`)
        continue
      }

      const constructedNodeId = createNode({
        kind: 'stylesheet',
        label: `adopted-constructed:${sheetIndex}`,
        source: 'shadowTopology',
        inline: true,
      })
      createEdge(rootNodeId, constructedNodeId, 'references', `adoptedStyleSheet:${sheetIndex}`)
      warnings.add('adopted-stylesheet-constructed-unbundled')
    }
  }

  const domStrings = collectDomSnapshotStrings(input.domSnapshotRaw)
  if (!domStrings.length) {
    warnings.add('dom-snapshot-strings-missing')
  } else {
    const domNodeId = createNode({
      kind: 'origin',
      label: 'dom-snapshot:string-table',
      source: 'domSnapshot',
    })
    createEdge(documentNodeId, domNodeId, 'contains', 'dom-snapshot')

    let foundInDom = false

    for (const raw of domStrings) {
      const token = trimToken(raw)
      if (!token) continue

      for (const ref of extractSvgFragmentRefs(token)) {
        const refNodeId = createNode({
          kind: 'svg-reference',
          label: ref,
          ref,
          source: 'domSnapshot',
        })
        createEdge(domNodeId, refNodeId, 'references', 'dom-string')
        foundInDom = true
      }

      for (const cssUrl of extractUrlsFromCssValue(token)) {
        const normalized = normalizeUrl(cssUrl, input.pageUrl)
        if (!normalized || normalized.startsWith('#')) continue
        const nodeId = createNode({
          kind: classifyResourceUrl(normalized),
          label: normalized,
          url: normalized,
          source: 'domSnapshot',
        })
        createEdge(domNodeId, nodeId, 'references', 'dom-css-url')
        foundInDom = true
      }

      const literal = extractLikelyAssetFromToken(token)
      if (!literal) continue
      const normalized = normalizeUrl(literal, input.pageUrl)
      if (!normalized || normalized.startsWith('#')) continue

      const nodeId = createNode({
        kind: classifyResourceUrl(normalized),
        label: normalized,
        url: normalized,
        source: 'domSnapshot',
      })
      createEdge(domNodeId, nodeId, 'references', 'dom-literal')
      foundInDom = true
    }

    if (foundInDom) warnings.add('dom-snapshot-resource-scan-heuristic')
  }

  const resourceNodes = nodes.filter((node) => node.kind !== 'document' && node.kind !== 'origin')
  const bundleAssets = resourceNodes.map((node) => {
    const url = node.url
    let fetchMode: BundleMode = 'unresolved'

    if (url?.startsWith('data:')) fetchMode = 'inline-data'
    else if (url) fetchMode = 'network'

    return {
      nodeId: node.id,
      kind: node.kind,
      url,
      ref: node.ref,
      fetchMode,
      required: node.kind === 'stylesheet' || node.kind === 'font',
    }
  })

  if (!resourceNodes.length) warnings.add('resource-graph-empty')

  const stylesheetCount = resourceNodes.filter((node) => node.kind === 'stylesheet').length
  const fontCount = resourceNodes.filter((node) => node.kind === 'font').length
  const imageCount = resourceNodes.filter((node) => node.kind === 'image').length
  const scriptCount = resourceNodes.filter((node) => node.kind === 'script').length
  const svgReferenceCount = resourceNodes.filter((node) => node.kind === 'svg-reference').length
  const otherCount = resourceNodes.filter((node) => node.kind === 'other').length
  const unresolvedBundleAssetCount = bundleAssets.filter((asset) => asset.fetchMode === 'unresolved').length

  const diagnosticsWarnings = Array.from(warnings)

  return {
    resourceGraph: {
      nodes,
      edges,
      bundler: {
        mode: 'light',
        assets: bundleAssets,
      },
      diagnostics: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        resourceNodeCount: resourceNodes.length,
        stylesheetCount,
        fontCount,
        imageCount,
        scriptCount,
        svgReferenceCount,
        otherCount,
        bundleAssetCount: bundleAssets.length,
        unresolvedBundleAssetCount,
        warnings: diagnosticsWarnings.length ? diagnosticsWarnings : undefined,
      },
    },
    warnings: diagnosticsWarnings,
  }
}
