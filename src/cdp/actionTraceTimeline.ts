import type { ActionTraceEventV0, ReplayTimelineEventV0 } from './types'

const ACTION_LABELS: Record<ActionTraceEventV0['type'], string> = {
  click: 'Click',
  hover: 'Hover',
  input: 'Input',
  focus: 'Focus',
  keyboard: 'Keyboard',
}

const normalizeMs = (value: number) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)

const buildActionPayload = (event: ActionTraceEventV0) => {
  const payload: Record<string, unknown> = {
    type: event.type,
  }

  if (event.selector) payload.selector = event.selector
  if (event.tagName) payload.tagName = event.tagName
  if (event.key) payload.key = event.key
  if (event.code) payload.code = event.code
  if (typeof event.value === 'string') payload.value = event.value
  if (event.text) payload.text = event.text

  return payload
}

const toTimelineEvent = (event: ActionTraceEventV0): ReplayTimelineEventV0 => ({
  kind: 'action-trace',
  atMs: normalizeMs(event.atMs),
  action: {
    ...event,
    atMs: normalizeMs(event.atMs),
  },
  label: ACTION_LABELS[event.type],
  payload: buildActionPayload(event),
})

export const buildActionTraceTimelineEvents = (events?: ActionTraceEventV0[]): ReplayTimelineEventV0[] => {
  if (!Array.isArray(events) || events.length === 0) return []

  return [...events]
    .map(toTimelineEvent)
    .sort((a, b) => a.atMs - b.atMs)
}
