import { describe, expect, it } from 'vitest'
import { mapTargetToCDPNode } from './nodeMapping'
import type { CDPClient } from './client'
import type { CaptureSeed } from './types'

type RuntimeSummary = {
  resolved: boolean
  confidence: number
  evidence: string[]
  candidateCount: number
  score: number
}

type SendHandler = (method: string, params: Record<string, unknown> | undefined) => unknown

const buildClient = (handler: SendHandler) => {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
  const client = {
    send: async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params })
      return handler(method, params)
    },
  } as unknown as CDPClient
  return { client, calls }
}

const runtimeUnresolvedSummary = (): RuntimeSummary => ({
  resolved: false,
  confidence: 0.23,
  evidence: ['best candidate score below threshold'],
  candidateCount: 2,
  score: 21,
})

const createSeed = (): CaptureSeed => ({
  requestId: 'req-1',
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  selectedSelector: '#fallback-target',
  targetFingerprint: {
    stableSelector: '#buy-now',
    selectedSelector: '#buy-now',
    tagName: 'button',
    id: 'buy-now',
    classList: ['cta', 'primary'],
    textPreview: 'Buy now',
    boundingBox: { x: 10, y: 20, width: 100, height: 32 },
    siblingIndex: 0,
    childCount: 0,
    attributeHints: [{ name: 'data-testid', value: 'buy' }],
    ancestry: [{ tagName: 'div', id: 'hero', classList: ['hero'], siblingIndex: 1 }],
    shadowContext: { insideShadowRoot: false, shadowDepth: 0, hostChain: [] },
  },
})

describe('mapTargetToCDPNode', () => {
  it('uses dom-traversal before selector fallback when runtime structural mapping is unresolved', async () => {
    const { client, calls } = buildClient((method, params) => {
      if (method === 'Runtime.evaluate' && params?.returnByValue === true) {
        return { result: { value: runtimeUnresolvedSummary() } }
      }

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
                        nodeId: 4,
                        backendNodeId: 99,
                        nodeName: 'BUTTON',
                        attributes: ['id', 'buy-now', 'class', 'cta primary', 'data-testid', 'buy'],
                        childNodeCount: 0,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      throw new Error(`unexpected CDP call: ${method}`)
    })

    const result = await mapTargetToCDPNode(client, createSeed())
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe('dom-traversal')
    expect(result.node?.nodeId).toBe(4)
    expect(result.evidence.join(' ')).toContain('dom traversal')
    expect((result.diagnostics?.strategyAttempts || []).length).toBeGreaterThanOrEqual(2)

    const selectorEvaluateCall = calls.find(
      (call) => call.method === 'Runtime.evaluate' && String(call.params?.expression || '').includes('document.querySelector('),
    )
    expect(selectorEvaluateCall).toBeUndefined()
  })

  it('falls back to selector when dom traversal remains unresolved', async () => {
    const { client, calls } = buildClient((method, params) => {
      if (method === 'Runtime.evaluate' && params?.returnByValue === true) {
        return { result: { value: runtimeUnresolvedSummary() } }
      }

      if (method === 'DOM.getDocument') {
        return {
          root: {
            nodeId: 1,
            nodeName: '#document',
            children: [{ nodeId: 2, nodeName: 'HTML', children: [{ nodeId: 3, nodeName: 'BODY', children: [] }] }],
          },
        }
      }

      if (
        method === 'Runtime.evaluate' &&
        params?.returnByValue === false &&
        String(params?.expression || '').includes('document.querySelector')
      ) {
        return { result: { objectId: 'obj-1', subtype: 'node', type: 'object' } }
      }

      if (method === 'DOM.requestNode') return { nodeId: 44 }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 88 } }

      throw new Error(`unexpected CDP call: ${method}`)
    })

    const result = await mapTargetToCDPNode(client, createSeed())
    expect(result.resolved).toBe(true)
    expect(result.strategy).toBe('selector-fallback')
    expect(result.node?.nodeId).toBe(44)
    expect((result.warnings || []).some((warning) => warning.includes('dom traversal'))).toBe(true)
    expect((result.diagnostics?.strategyAttempts || []).some((attempt) => attempt.strategy === 'selector-fallback')).toBe(true)

    const selectorEvaluateCall = calls.find(
      (call) => call.method === 'Runtime.evaluate' && String(call.params?.expression || '').includes('document.querySelector('),
    )
    expect(selectorEvaluateCall).toBeDefined()
  })

  it('adds snapshot hints and confidence bonus metadata to diagnostics', async () => {
    const { client } = buildClient((method, params) => {
      if (method === 'Runtime.evaluate' && params?.returnByValue === true) {
        return { result: { value: runtimeUnresolvedSummary() } }
      }

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
                        nodeId: 4,
                        backendNodeId: 99,
                        nodeName: 'BUTTON',
                        attributes: ['id', 'buy-now', 'class', 'cta primary', 'data-testid', 'buy'],
                        childNodeCount: 0,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      throw new Error(`unexpected CDP call: ${method}`)
    })

    const result = await mapTargetToCDPNode(client, createSeed(), { strings: ['buy-now', 'button', 'cta'] })
    expect(result.resolved).toBe(true)
    expect(result.evidence.join(' ')).toContain('domsnapshot string table contains target id')
    expect((result.diagnostics?.snapshotHints || []).length).toBeGreaterThan(0)
  })
})
