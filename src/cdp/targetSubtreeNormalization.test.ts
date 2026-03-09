import { describe, expect, it } from 'vitest'

import { normalizeTargetSubtree } from './targetSubtreeNormalization'

describe('normalizeTargetSubtree', () => {
  it('removes noisy wrapper/custom nodes and data-csnap attributes', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html: '<rpl-tooltip data-csnap="1"><div><button class="cta" data-csnap="2">Buy now</button></div><slot></slot><script>bad()</script></rpl-tooltip>',
      nodeCount: 5,
      elementCount: 5,
      textNodeCount: 1,
      textLength: 7,
      maxDepth: 3,
    })

    expect(result?.html).toBe('<button class="cta">Buy now</button>')
    expect(result?.collapsedWrapperCount).toBeGreaterThan(0)
    expect(result?.removedTagCounts.slot).toBe(1)
    expect(result?.removedAttributeCounts['data-csnap']).toBe(1)
    expect(result?.warnings).toContain('target-candidate-noise-tags-removed')
  })
})
