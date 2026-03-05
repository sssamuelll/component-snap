import { describe, it, expect } from 'vitest'
import { buildStableSelector, classifyComponent } from './snap'

describe('buildStableSelector', () => {
  it('prefers data-testid', () => {
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'search-box')
    expect(buildStableSelector(el)).toBe('[data-testid="search-box"]')
  })

  it('falls back to id', () => {
    const el = document.createElement('input')
    el.id = 'q'
    expect(buildStableSelector(el)).toBe('#q')
  })
})

describe('classifyComponent', () => {
  it('detects search input from placeholder', () => {
    const el = document.createElement('input')
    el.placeholder = 'Search Google or type a URL'
    expect(classifyComponent(el)).toBe('search-input')
  })

  it('detects button', () => {
    const el = document.createElement('button')
    expect(classifyComponent(el)).toBe('button')
  })
})
