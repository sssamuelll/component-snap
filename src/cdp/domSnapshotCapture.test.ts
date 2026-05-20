import { describe, expect, it } from 'vitest'
import { captureDomSnapshot } from './domSnapshotCapture'
import type { CDPClient } from './client'

const makeClient = (response: unknown): CDPClient =>
  ({
    send: async (method: string) => {
      if (method !== 'DOMSnapshot.captureSnapshot') {
        throw new Error(`unexpected method: ${method}`)
      }
      return response
    },
  }) as unknown as CDPClient

describe('captureDomSnapshot', () => {
  it('counts real DOM nodes via documents[0].nodes.parentIndex, not the strings table', async () => {
    const client = makeClient({
      documents: [
        {
          nodes: {
            parentIndex: [-1, 0, 0, 1, 2],
          },
        },
      ],
      strings: new Array(420).fill('s'),
    })

    const result = await captureDomSnapshot(client)

    expect(result.stats.nodes).toBe(5)
    expect(result.stats.nodes).not.toBe(420)
    expect(result.stats.documents).toBe(1)
  })

  it('returns 0 nodes (without throwing) when documents is absent', async () => {
    const client = makeClient({ strings: ['a', 'b', 'c'] })
    const result = await captureDomSnapshot(client)
    expect(result.stats.nodes).toBe(0)
    expect(result.stats.documents).toBe(0)
  })

  it('returns 0 nodes (without throwing) when documents is empty', async () => {
    const client = makeClient({ documents: [], strings: ['x'] })
    const result = await captureDomSnapshot(client)
    expect(result.stats.nodes).toBe(0)
    expect(result.stats.documents).toBe(0)
  })

  it('returns 0 nodes when the first document lacks a parentIndex column', async () => {
    const client = makeClient({ documents: [{ nodes: {} }], strings: ['x'] })
    const result = await captureDomSnapshot(client)
    expect(result.stats.nodes).toBe(0)
    expect(result.stats.documents).toBe(1)
  })
})
