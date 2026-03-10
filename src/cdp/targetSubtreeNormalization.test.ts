import { describe, expect, it } from 'vitest'

import { LICHESS_LIKE_SCENE_HTML } from './__fixtures__/lichessLikeScene'
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
    expect(result?.source).toBe('reconstructed-subtree')
    expect(result?.collapsedWrapperCount).toBeGreaterThan(0)
    expect(result?.compactedSvgCount).toBe(0)
    expect(result?.removedTagCounts.slot).toBe(1)
    expect(result?.removedAttributeCounts['data-csnap']).toBe(2)
    expect(result?.warnings).toContain('target-candidate-noise-tags-removed')
    expect(result?.warnings).toContain('target-candidate-profile:anchor-dense')
  })

  it('compacts heavy inline svg internals while keeping the visible svg shell', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<button class="cta"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M' +
        '1 '.repeat(180) +
        'Z"></path><path d="M2 2L22 22"></path></svg><span>Buy now</span></button>',
      nodeCount: 6,
      elementCount: 5,
      textNodeCount: 1,
      textLength: 7,
      maxDepth: 3,
    })

    expect(result?.html).toContain('<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect')
    expect(result?.html).not.toContain('M1 1 1 1')
    expect(result?.html).toContain('Buy now')
    expect(result?.source).toBe('reconstructed-subtree')
    expect(result?.compactedSvgCount).toBe(1)
    expect(result?.warnings).toContain('target-candidate-compacted-svgs:1')
  })

  it('preserves svg content when it contains meaningful text', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html: '<svg viewBox="0 0 24 24"><text x="4" y="12">99+</text></svg>',
      nodeCount: 3,
      elementCount: 2,
      textNodeCount: 1,
      textLength: 3,
      maxDepth: 2,
    })

    expect(result?.html).toBe('<svg viewBox="0 0 24 24"><text x="4" y="12">99+</text></svg>')
    expect(result?.compactedSvgCount).toBe(0)
    expect(result?.quality?.profile).toBe('anchor-dense')
  })

  it('collapses low-value wrapper chains while keeping link, image, and text anchors', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<div class="card-shell" data-testid="outer"><span class="card-link-wrap" aria-labelledby="hero-title">' +
        '<a href="/products/1"><span class="thumb"><img src="/hero.png" alt="Hero product" loading="lazy"></span>' +
        '<span id="hero-title" class="label">Read more</span></a></span></div>',
      nodeCount: 7,
      elementCount: 6,
      textNodeCount: 1,
      textLength: 9,
      maxDepth: 5,
    })

    expect(result?.html).toBe('<a href="/products/1"><img src="/hero.png" alt="Hero product" loading="lazy">Read more</a>')
    expect(result?.collapsedWrapperCount).toBeGreaterThanOrEqual(4)
    expect(result?.removedAttributeCounts.class).toBeGreaterThanOrEqual(3)
    expect(result?.removedAttributeCounts['data-testid']).toBe(1)
    expect(result?.removedAttributeCounts['aria-labelledby']).toBe(1)
    expect(result?.quality).toMatchObject({
      anchorNodeCount: 2,
      wrapperNodeCount: 0,
      profile: 'anchor-dense',
    })
  })

  it('drops verbose non-visual attributes but preserves form and button anchors', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<div class="field" tabindex="-1"><label class="field-label" for="email"><span>Email</span></label>' +
        '<div class="control" data-testid="control"><input id="email" type="email" name="email" placeholder="you@example.com" ' +
        'autocomplete="email" aria-describedby="email-help"></div><button type="submit" aria-label="Continue" data-track="1">Continue</button></div>',
      nodeCount: 8,
      elementCount: 7,
      textNodeCount: 2,
      textLength: 13,
      maxDepth: 4,
    })

    expect(result?.html).toBe(
      '<label for="email">Email</label><input id="email" type="email" name="email" placeholder="you@example.com" autocomplete="email"><button type="submit" aria-label="Continue">Continue</button>',
    )
    expect(result?.removedAttributeCounts.tabindex).toBe(1)
    expect(result?.removedAttributeCounts['aria-describedby']).toBe(1)
    expect(result?.removedAttributeCounts['data-track']).toBe(1)
    expect(result?.quality?.profile).toBe('anchor-dense')
  })

  it('reconstructs semantic wrapper stacks into anchor-dense candidate output', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<section class="promo-shell"><article class="promo-card"><div class="media"><a href=\"/sale\"><img src=\"/sale.png\" alt=\"Sale\"></a></div>' +
        '<div class="content"><label for="email">Email</label><div class="action"><button type="submit">Join</button></div></div></article></section>',
      nodeCount: 10,
      elementCount: 9,
      textNodeCount: 2,
      textLength: 9,
      maxDepth: 5,
    })

    expect(result?.html).toBe('<a href="/sale"><img src="/sale.png" alt="Sale"></a><label for="email">Email</label><button type="submit">Join</button>')
    expect(result?.quality).toMatchObject({
      anchorNodeCount: 4,
      wrapperNodeCount: 0,
      profile: 'anchor-dense',
    })
    expect(result?.warnings).toContain('target-candidate-profile:anchor-dense')
  })

  it('detects a lichess-like board subtree as scene-like and preserves positioned primitives', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html: LICHESS_LIKE_SCENE_HTML,
      nodeCount: 18,
      elementCount: 18,
      textNodeCount: 3,
      textLength: 3,
      maxDepth: 6,
    })

    expect(result?.quality?.profile).toBe('scene-like')
    expect(result?.warnings).toContain('target-candidate-scene-like-subtree')
    expect(result?.warnings).toContain('target-candidate-reconstruction:scene-preserving')
    expect(result?.html).toContain('<cg-container style="position:relative;display:block;width:320px;height:320px">')
    expect(result?.html).toContain('<cg-board class="cg-board" style="position:relative;display:block;width:320px;height:320px">')
    expect(result?.html).toContain('<div class="cg-custom-svgs"><svg class="arrow-overlay" viewBox="0 0 320 320"><line x1="20" y1="20" x2="280" y2="280" stroke="rgba(0,255,0,0.8)" stroke-width="12"></line></svg></div>')
    expect(result?.html).toContain('<square class="last-move" style="position:absolute;transform:translate(40px, 240px);width:40px;height:40px;background:rgba(255,255,0,0.35)"></square>')
    expect(result?.html).toContain('<piece class="white king" style="position:absolute;transform:translate(160px, 280px);width:40px;height:40px"></piece>')
    expect(result?.html).toContain('<div><piece class="ghost white queen" style="position:absolute;transform:translate(200px, 80px);width:40px;height:40px;opacity:0.45"></piece></div>')
    expect(result?.html).toContain('<coords class="files"><coord>a</coord><coord>b</coord><coord>c</coord></coords>')
    expect(result?.reconstruction).toEqual({
      mode: 'scene-preserving',
      preservedEmptyScenePrimitiveCount: 6,
      preservedCustomElementCount: 2,
      preservedLayeredElementCount: 6,
    })
  })

  it('keeps board-like scene wrappers when they organize multiple layered primitives', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<div>' +
        '<div><piece class="white rook" style="position:absolute;transform:translate(0px, 0px);width:40px;height:40px"></piece></div>' +
        '<div><piece class="black rook" style="position:absolute;transform:translate(280px, 280px);width:40px;height:40px"></piece></div>' +
        '<div><square class="check" style="position:absolute;transform:translate(160px, 160px);width:40px;height:40px;background:rgba(255,0,0,0.25)"></square></div>' +
        '</div>',
      nodeCount: 7,
      elementCount: 7,
      textNodeCount: 0,
      textLength: 0,
      maxDepth: 3,
    })

    expect(result?.quality?.profile).toBe('scene-like')
    expect(result?.html.startsWith('<div><div><piece')).toBe(true)
    expect(result?.collapsedWrapperCount).toBe(0)
    expect(result?.reconstruction?.preservedLayeredElementCount).toBeGreaterThanOrEqual(4)
  })

  it('avoids collapsing visually meaningful empty scene layers even when they are div wrappers', () => {
    const result = normalizeTargetSubtree({
      source: 'runtime-object',
      html:
        '<div class="board-shell"><div class="scene-layer" style="position:absolute;transform:translate(0px, 0px);width:320px;height:320px"></div>' +
        '<div class="scene-layer" style="position:absolute;transform:translate(40px, 40px);width:40px;height:40px;background:rgba(255,0,0,0.2)"></div></div>',
      nodeCount: 3,
      elementCount: 3,
      textNodeCount: 0,
      textLength: 0,
      maxDepth: 2,
    })

    expect(result?.quality?.profile).toBe('scene-like')
    expect(result?.html).toContain('<div class="scene-layer" style="position:absolute;transform:translate(0px, 0px);width:320px;height:320px"></div>')
    expect(result?.html).toContain('<div class="scene-layer" style="position:absolute;transform:translate(40px, 40px);width:40px;height:40px;background:rgba(255,0,0,0.2)"></div>')
    expect(result?.collapsedWrapperCount).toBe(0)
  })
})
