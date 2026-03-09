import type { MutationTraceEventV0, ReplayTimelineEventV0 } from './types'

const MAX_SUMMARY_TEXT = 140
const MAX_TAGS = 6

const normalizeMs = (value: number) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)

const trimPreview = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_TEXT)

const pickTags = (tags?: string[]) => (Array.isArray(tags) ? tags.map((tag) => tag.toLowerCase()).slice(0, MAX_TAGS) : undefined)

const inferTransition = (event: MutationTraceEventV0) => {
  if (event.actionRef?.type === 'input' && (event.type === 'characterData' || event.attributeName === 'value')) {
    return 'input-sync'
  }
  if (event.type === 'childList') return 'structure-update'
  if (event.type === 'characterData') return 'content-update'
  if (!event.attributeName) return 'attribute-update'
  if (
    event.attributeName === 'class' ||
    event.attributeName === 'style' ||
    event.attributeName.startsWith('aria-') ||
    event.attributeName.startsWith('data-state') ||
    ['open', 'hidden', 'disabled', 'checked', 'selected'].includes(event.attributeName)
  ) {
    return 'visual-state'
  }
  return 'attribute-update'
}

const buildMutationLabel = (transition: string) => {
  if (transition === 'input-sync') return 'Mutation (input sync)'
  if (transition === 'structure-update') return 'Mutation (structure)'
  if (transition === 'content-update') return 'Mutation (content)'
  if (transition === 'visual-state') return 'Mutation (visual state)'
  return 'Mutation'
}

const buildMutationPayload = (event: MutationTraceEventV0, transition: string) => {
  const payload: Record<string, unknown> = {
    type: event.type,
    transition,
  }

  if (event.selector) payload.selector = event.selector
  if (event.tagName) payload.tagName = event.tagName
  if (event.attributeName) payload.attributeName = event.attributeName
  if (typeof event.addedNodes === 'number') payload.addedNodes = event.addedNodes
  if (typeof event.removedNodes === 'number') payload.removedNodes = event.removedNodes
  if (event.actionRef) {
    payload.actionType = event.actionRef.type
    payload.actionAtMs = normalizeMs(event.actionRef.atMs)
  }
  const valuePreview = typeof event.valuePreview === 'string' ? trimPreview(event.valuePreview) : undefined
  if (valuePreview) payload.valuePreview = valuePreview
  const addedTagNames = pickTags(event.addedTagNames)
  if (addedTagNames?.length) payload.addedTagNames = addedTagNames
  const removedTagNames = pickTags(event.removedTagNames)
  if (removedTagNames?.length) payload.removedTagNames = removedTagNames

  return payload
}

const toTimelineEvent = (event: MutationTraceEventV0): ReplayTimelineEventV0 => {
  const normalizedAtMs = normalizeMs(event.atMs)
  const transition = inferTransition(event)
  const mutation = {
    ...event,
    atMs: normalizedAtMs,
    actionRef: event.actionRef
      ? {
          ...event.actionRef,
          atMs: normalizeMs(event.actionRef.atMs),
        }
      : undefined,
    valuePreview: typeof event.valuePreview === 'string' ? trimPreview(event.valuePreview) : undefined,
    addedTagNames: pickTags(event.addedTagNames),
    removedTagNames: pickTags(event.removedTagNames),
  }

  return {
    kind: 'mutation',
    atMs: normalizedAtMs,
    mutation,
    label: buildMutationLabel(transition),
    payload: buildMutationPayload(mutation, transition),
  }
}

export const buildMutationTraceTimelineEvents = (events?: MutationTraceEventV0[]): ReplayTimelineEventV0[] => {
  if (!Array.isArray(events) || events.length === 0) return []

  return [...events]
    .map(toTimelineEvent)
    .sort((a, b) => a.atMs - b.atMs)
}
