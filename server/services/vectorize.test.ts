import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { traceMaskToSvg, traceColorLayers } from './vectorize.ts'

describe('traceMaskToSvg', () => {
  it('returns editable paths and no embedded bitmap for a simple shape', async () => {
    const pixels = Buffer.alloc(100 * 100 * 4, 255)
    for (let y = 25; y < 75; y++) for (let x = 25; x < 75; x++) {
      const offset = (y * 100 + x) * 4
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0
    }
    const png = await sharp(pixels, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer()
    const result = await traceMaskToSvg(png)
    expect(result.pathCount).toBeGreaterThan(0)
    expect(result.svg).toContain('<path ')
    expect(result.svg).not.toContain('<image')
    expect(result.svg).toContain('viewBox="0 0 100 100"')
  })

  it('rejects a blank mask', async () => {
    const png = await sharp({ create: { width: 80, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer()
    await expect(traceMaskToSvg(png)).rejects.toThrow('目标颜色太少')
  })
})

describe('automatic colour layers', () => {
  it('separates red and blue, identifies white background and preserves positions', async () => {
    const input = await sharp(Buffer.from('<svg width="128" height="128"><rect width="128" height="128" fill="white"/><path d="M16 16H59V113H16Z" fill="#dc2828"/><circle cx="92" cy="50" r="25" fill="#1e64e6"/></svg>')).png().toBuffer()
    const result = await traceColorLayers(input, 3)
    expect(result.layers).toHaveLength(3)
    const background = result.layers.find((layer) => layer.background)!
    expect(background.color).toBe('#ffffff')
    const foreground = result.layers.filter((layer) => !layer.background)
    expect(foreground).toHaveLength(2)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">${foreground.map((layer) => layer.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')).join('')}</svg>`
    const original = await sharp(input).removeAlpha().raw().toBuffer()
    const rendered = await sharp(Buffer.from(svg)).flatten({ background: 'white' }).removeAlpha().raw().toBuffer()
    let intersection = 0, union = 0
    for (let i = 0; i < original.length; i += 3) {
      const a = Math.min(original[i], original[i + 1], original[i + 2]) < 200
      const b = Math.min(rendered[i], rendered[i + 1], rendered[i + 2]) < 200
      if (a && b) intersection++; if (a || b) union++
    }
    expect(intersection / union).toBeGreaterThan(.96)
    expect(svg).not.toContain('<image')
  })
  it('does not remove an opaque shape as background when the border is transparent', async () => {
    const input = await sharp(Buffer.from('<svg width="100" height="100"><circle cx="50" cy="50" r="25" fill="#ff0000"/></svg>')).png().toBuffer()
    const result = await traceColorLayers(input, 3)
    expect(result.layers.some((layer) => layer.background)).toBe(false)
    expect(result.layers.length).toBeGreaterThan(0)
  })
})
