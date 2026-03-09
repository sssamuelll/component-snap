import { describe, expect, it } from 'vitest'
import { buildResourceGraph } from './resourceGraph'

describe('buildResourceGraph', () => {
  it('builds resource nodes and edges from cssGraph + shadowTopology + dom snapshot hints', () => {
    const result = buildResourceGraph({
      pageUrl: 'https://example.com/app/page',
      cssGraph: {
        target: { nodeId: 10 },
        matchedRules: [
          {
            origin: 'regular',
            selectorList: ['.hero'],
            stylesheet: { sourceURL: '/styles/app.css' },
            declarations: [
              { name: 'background-image', value: 'url("/assets/bg.png")' },
              { name: 'src', value: 'url(https://cdn.example.com/fonts/ui.woff2)' },
              { name: 'filter', value: 'url(#glow)' },
            ],
          },
          {
            origin: 'inline',
            selectorList: ['.badge'],
            declarations: [{ name: 'background', value: 'url(data:image/png;base64,AAA)' }],
          },
        ],
      },
      shadowTopology: {
        roots: [
          {
            mode: 'open',
            depth: 1,
            host: { tagName: 'app-root', id: 'root' },
            adoptedStyleSheets: [
              { index: 0, href: '/styles/shadow.css' },
              { index: 1, constructed: true },
            ],
          },
        ],
      },
      domSnapshotRaw: {
        strings: [
          'https://cdn.example.com/runtime.js',
          'url(#mask-hero)',
          '../images/card.webp',
        ],
      },
    })

    const graph = result.resourceGraph
    const resourceKinds = graph.nodes.map((node) => node.kind)

    expect(resourceKinds).toContain('stylesheet')
    expect(resourceKinds).toContain('image')
    expect(resourceKinds).toContain('font')
    expect(resourceKinds).toContain('script')
    expect(resourceKinds).toContain('svg-reference')
    expect(graph.edges.length).toBeGreaterThan(0)
    expect(graph.diagnostics?.resourceNodeCount).toBeGreaterThan(4)
    expect(graph.bundler?.assets.some((asset) => asset.fetchMode === 'network')).toBe(true)
    expect(graph.bundler?.assets.some((asset) => asset.fetchMode === 'inline-data')).toBe(true)
    expect(result.warnings).toContain('adopted-stylesheet-constructed-unbundled')
    expect(result.warnings).toContain('dom-snapshot-resource-scan-heuristic')
  })

  it('returns empty-state warning when no sources produce resources', () => {
    const result = buildResourceGraph({
      pageUrl: 'https://example.com',
      cssGraph: { target: {}, matchedRules: [] },
      shadowTopology: { roots: [] },
      domSnapshotRaw: { documents: [] },
    })

    expect(result.resourceGraph.nodes.some((node) => node.kind === 'document')).toBe(true)
    expect(result.resourceGraph.diagnostics?.resourceNodeCount).toBe(0)
    expect(result.warnings).toContain('dom-snapshot-strings-missing')
    expect(result.warnings).toContain('resource-graph-empty')
  })
})
