import { describe, expect, it } from 'vitest'
import { resolveNodeByDomTraversal } from './nodeResolverDom'
import type { CDPClient } from './client'
import type { TargetFingerprint } from './nodeMappingTypes'

const fingerprint: TargetFingerprint = {
  stableSelector: '#action',
  selectedSelector: '#action',
  tagName: 'button',
  id: 'action',
  classList: ['cta', 'primary'],
  textPreview: 'Buy now',
  boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  siblingIndex: 0,
  childCount: 0,
  attributeHints: [{ name: 'data-testid', value: 'action' }],
  ancestry: [{ tagName: 'div', id: 'hero', classList: ['hero'], siblingIndex: 0 }],
  shadowContext: { insideShadowRoot: true, shadowDepth: 2, hostChain: ['product-card', 'buy-panel'] },
}

const buildClient = (root: unknown) =>
  ({
    send: async (method: string) => {
      if (method === 'DOM.getDocument') return { root }
      throw new Error(`unexpected method: ${method}`)
    },
  }) as unknown as CDPClient

describe('resolveNodeByDomTraversal', () => {
  it('applies drift penalties when shadow context and child-count diverge', async () => {
    const client = buildClient({
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
                  nodeId: 4,
                  nodeName: 'DIV',
                  attributes: ['id', 'hero', 'class', 'hero'],
                  children: [
                    {
                      nodeId: 5,
                      backendNodeId: 55,
                      nodeName: 'BUTTON',
                      attributes: ['id', 'action', 'class', 'cta primary', 'data-testid', 'action'],
                      childNodeCount: 8,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })

    const result = await resolveNodeByDomTraversal(client, fingerprint)
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe('dom-traversal')
    expect(result.confidence).toBeLessThan(0.55)
    expect(result.evidence.join(' ')).toContain('shadow root context mismatch')
    expect(result.evidence.join(' ')).toContain('child count drift')
  })

  it('reports close-candidate ambiguity with evidence for top scores', async () => {
    const client = buildClient({
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
                  nodeName: 'PRODUCT-CARD',
                  shadowRoots: [
                    {
                      nodeId: 11,
                      nodeName: '#document-fragment',
                      children: [
                        {
                          nodeId: 12,
                          nodeName: 'BUY-PANEL',
                          shadowRoots: [
                            {
                              nodeId: 13,
                              nodeName: '#document-fragment',
                              children: [
                                {
                                  nodeId: 14,
                                  backendNodeId: 140,
                                  nodeName: 'BUTTON',
                                  attributes: ['id', 'action', 'class', 'cta primary', 'data-testid', 'action'],
                                  childNodeCount: 0,
                                },
                                {
                                  nodeId: 15,
                                  backendNodeId: 150,
                                  nodeName: 'BUTTON',
                                  attributes: ['id', 'action', 'class', 'cta primary', 'data-testid', 'action'],
                                  childNodeCount: 0,
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
          ],
        },
      ],
    })

    const result = await resolveNodeByDomTraversal(client, fingerprint)
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe('dom-traversal')
    expect((result.warnings || []).join(' ')).toContain('close competing candidates')
    expect(result.evidence.join(' ')).toContain('top dom-traversal candidates')
  })
})
