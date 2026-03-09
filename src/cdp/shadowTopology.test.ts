import { describe, expect, it } from 'vitest'
import type { CDPClient } from './client'
import { captureShadowTopology } from './shadowTopology'

type SendHandler = (method: string, params: Record<string, unknown> | undefined) => unknown

const buildClient = (handler: SendHandler) =>
  ({
    send: async (method: string, params?: Record<string, unknown>) => handler(method, params),
  }) as unknown as CDPClient

describe('captureShadowTopology', () => {
  it('captures shadow root topology and merges adoptedStyleSheets metadata for open roots', async () => {
    const client = buildClient((method) => {
      if (method === 'DOM.getDocument') {
        return {
          root: {
            nodeId: 1,
            nodeName: '#document',
            children: [
              {
                nodeId: 2,
                nodeName: 'HTML',
                children: [
                  {
                    nodeId: 3,
                    nodeName: 'BODY',
                    children: [
                      {
                        nodeId: 10,
                        backendNodeId: 110,
                        nodeName: 'APP-ROOT',
                        attributes: ['id', 'app-root', 'class', 'shell'],
                        shadowRoots: [
                          {
                            nodeId: 11,
                            shadowRootType: 'open',
                            nodeName: '#document-fragment',
                            children: [
                              {
                                nodeId: 12,
                                backendNodeId: 120,
                                nodeName: 'APP-PANEL',
                                attributes: ['id', 'panel-1'],
                                shadowRoots: [{ nodeId: 13, shadowRootType: 'closed', nodeName: '#document-fragment' }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              roots: [
                {
                  depth: 1,
                  host: { tagName: 'app-root', id: 'app-root', classList: ['shell'] },
                  adoptedStyleSheets: [{ index: 0, href: '', constructed: true, ruleCount: 12 }],
                },
              ],
            },
          },
        }
      }

      throw new Error(`unexpected method: ${method}`)
    })

    const result = await captureShadowTopology(client)
    expect(result.shadowTopology?.diagnostics?.totalShadowRoots).toBe(2)
    expect(result.shadowTopology?.diagnostics?.openShadowRootCount).toBe(1)
    expect(result.shadowTopology?.diagnostics?.closedShadowRootCount).toBe(1)
    expect(result.shadowTopology?.diagnostics?.adoptedStyleSheetRootCount).toBe(1)
    expect(result.shadowTopology?.diagnostics?.adoptedStyleSheetCount).toBe(1)
    expect(result.shadowTopology?.roots[0]?.adoptedStyleSheets?.[0]?.ruleCount).toBe(12)
    expect(result.warnings).toContain('closed-shadow-root-unavailable')
    expect(result.warnings).toContain('adopted-stylesheets-open-roots-only')
  })

  it('returns topology with warnings when adoptedStyleSheets runtime capture fails', async () => {
    const client = buildClient((method) => {
      if (method === 'DOM.getDocument') {
        return {
          root: {
            nodeId: 1,
            nodeName: '#document',
            children: [
              {
                nodeId: 2,
                nodeName: 'HTML',
                children: [
                  {
                    nodeId: 3,
                    nodeName: 'BODY',
                    children: [
                      {
                        nodeId: 10,
                        backendNodeId: 110,
                        nodeName: 'APP-ROOT',
                        attributes: ['id', 'app-root'],
                        shadowRoots: [{ nodeId: 11, shadowRootType: 'open', nodeName: '#document-fragment' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }
      if (method === 'Runtime.evaluate') throw new Error('runtime-eval-failed')
      throw new Error(`unexpected method: ${method}`)
    })

    const result = await captureShadowTopology(client)
    expect(result.shadowTopology?.diagnostics?.totalShadowRoots).toBe(1)
    expect(result.shadowTopology?.diagnostics?.adoptedStyleSheetCount).toBe(0)
    expect(result.warnings).toContain('adopted-stylesheets-metadata-failed')
  })

  it('fails soft when DOM topology capture is unavailable', async () => {
    const client = buildClient((method) => {
      if (method === 'DOM.getDocument') throw new Error('dom-unavailable')
      throw new Error(`unexpected method: ${method}`)
    })

    const result = await captureShadowTopology(client)
    expect(result.shadowTopology).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('shadow-topology-unavailable')
  })
})
