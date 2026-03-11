import { describe, expect, it } from 'vitest'

import { captureTargetSubtree } from './targetSubtree'
import type { CaptureSeed } from './types'
import type { NodeMappingResult } from './nodeMappingTypes'

const seed: CaptureSeed = {
  requestId: 'req_1',
  tabId: 1,
  pageUrl: 'https://example.com',
  pageTitle: 'Example',
  selectedSelector: '.cta',
  targetFingerprint: {
    tagName: 'button',
    classList: ['cta'],
    attributeHints: [],
    ancestry: [],
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  },
}

describe('captureTargetSubtree', () => {
  it('captures a materialized subtree from a resolved runtime object', async () => {
    const mapping: NodeMappingResult = {
      resolved: true,
      confidence: 0.9,
      strategy: 'runtime-structural',
      evidence: ['mapped'],
      node: { objectId: 'obj-1', nodeId: 42 },
    }

    const client = {
      send: async (method: string) => {
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                html: '<button class="cta"><span>Buy now</span></button>',
                nodeCount: 2,
                elementCount: 2,
                textNodeCount: 1,
                textLength: 7,
                maxDepth: 1,
                warnings: ['target-subtree-shadow-root-flattened'],
              },
            },
          }
        }
        throw new Error(`unexpected method: ${method}`)
      },
    }

    const result = await captureTargetSubtree(client as never, mapping, seed)

    expect(result).toEqual({
      source: 'runtime-object',
      html: '<button class="cta"><span>Buy now</span></button>',
      nodeCount: 2,
      elementCount: 2,
      textNodeCount: 1,
      textLength: 7,
      maxDepth: 1,
      warnings: ['target-subtree-shadow-root-flattened'],
    })
  })

  it('falls back to selector lookup when no objectId is present', async () => {
    const mapping: NodeMappingResult = {
      resolved: true,
      confidence: 0.5,
      strategy: 'selector-fallback',
      evidence: ['selector'],
    }

    const methods: string[] = []
    const client = {
      send: async (method: string) => {
        methods.push(method)
        if (method === 'Runtime.evaluate') {
          return { result: { objectId: 'obj-from-selector' } }
        }
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                html: '<div class="cta">Hello</div>',
                nodeCount: 1,
                elementCount: 1,
                textNodeCount: 1,
                textLength: 5,
                maxDepth: 0,
              },
            },
          }
        }
        throw new Error(`unexpected method: ${method}`)
      },
    }

    const result = await captureTargetSubtree(client as never, mapping, seed)

    expect(methods).toContain('Runtime.evaluate')
    expect(result?.source).toBe('selector-fallback')
    expect(result?.html).toContain('Hello')
  })
})
