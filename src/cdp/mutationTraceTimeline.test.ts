import { describe, expect, it } from 'vitest'
import { buildMutationTraceTimelineEvents } from './mutationTraceTimeline'

describe('buildMutationTraceTimelineEvents', () => {
  it('normalizes and sorts mutation events with inferred transitions', () => {
    const events = buildMutationTraceTimelineEvents([
      {
        type: 'childList',
        atMs: 17.6,
        selector: '.list',
        tagName: 'ul',
        addedNodes: 1,
        removedNodes: 0,
        addedTagNames: ['LI', 'SPAN'],
      },
      {
        type: 'attributes',
        atMs: 9.2,
        selector: '.btn',
        tagName: 'button',
        attributeName: 'aria-expanded',
        valuePreview: ' true ',
      },
    ])

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'mutation',
      atMs: 9,
      label: 'Mutation (visual state)',
      mutation: {
        type: 'attributes',
        atMs: 9,
        attributeName: 'aria-expanded',
        valuePreview: 'true',
      },
      payload: expect.objectContaining({
        transition: 'visual-state',
        attributeName: 'aria-expanded',
        valuePreview: 'true',
      }),
    })
    expect(events[1]).toMatchObject({
      kind: 'mutation',
      atMs: 18,
      label: 'Mutation (structure)',
      mutation: {
        type: 'childList',
        atMs: 18,
        addedNodes: 1,
        addedTagNames: ['li', 'span'],
      },
      payload: expect.objectContaining({
        transition: 'structure-update',
        addedTagNames: ['li', 'span'],
      }),
    })
  })

  it('marks input-correlated text mutations as input-sync', () => {
    const events = buildMutationTraceTimelineEvents([
      {
        type: 'characterData',
        atMs: 42.4,
        selector: '.editor',
        tagName: 'div',
        valuePreview: 'Hello world',
        actionRef: { type: 'input', atMs: 41.9 },
      },
    ])

    expect(events[0]).toMatchObject({
      kind: 'mutation',
      atMs: 42,
      label: 'Mutation (input sync)',
      mutation: {
        actionRef: {
          type: 'input',
          atMs: 42,
        },
      },
      payload: expect.objectContaining({
        transition: 'input-sync',
        actionType: 'input',
        actionAtMs: 42,
      }),
    })
  })

  it('returns empty list for empty input', () => {
    expect(buildMutationTraceTimelineEvents()).toEqual([])
    expect(buildMutationTraceTimelineEvents([])).toEqual([])
  })
})
