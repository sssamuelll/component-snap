const esc = (value: string) => {
  const maybeCss = globalThis.CSS as { escape?: (input: string) => string } | undefined
  if (maybeCss?.escape) return maybeCss.escape(value)
  return value.replace(/(["'\\.#:[\]()\s])/g, '\\$1')
}

export const buildStableSelector = (el: HTMLElement): string => {
  const testId = el.getAttribute('data-testid') || el.getAttribute('data-test')
  if (testId) return `[data-testid="${esc(testId)}"]`

  if (el.id) return `#${esc(el.id)}`

  const role = el.getAttribute('role')
  if (role) return `${el.tagName.toLowerCase()}[role="${esc(role)}"]`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${esc(ariaLabel)}"]`

  const classTokens = Array.from(el.classList).slice(0, 2)
  if (classTokens.length) {
    return `${el.tagName.toLowerCase()}.${classTokens.map((c) => esc(c)).join('.')}`
  }

  return el.tagName.toLowerCase()
}

export type ComponentKind =
  | 'search-input'
  | 'text-input'
  | 'button'
  | 'link'
  | 'image'
  | 'card'
  | 'unknown'

export const classifyComponent = (el: HTMLElement): ComponentKind => {
  const tag = el.tagName.toLowerCase()
  const role = (el.getAttribute('role') || '').toLowerCase()
  const type = ((el as HTMLInputElement).type || '').toLowerCase()
  const aria = (el.getAttribute('aria-label') || '').toLowerCase()
  const placeholder = ((el as HTMLInputElement).placeholder || '').toLowerCase()

  if (tag === 'input' && (type === 'search' || aria.includes('search') || placeholder.includes('search'))) {
    return 'search-input'
  }
  if (tag === 'input' || tag === 'textarea') return 'text-input'
  if (tag === 'button' || role === 'button') return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'img') return 'image'
  if (tag === 'article' || (tag === 'div' && el.className.toLowerCase().includes('card'))) return 'card'

  return 'unknown'
}
