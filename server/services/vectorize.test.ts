import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { traceMaskToSvg } from './vectorize.ts'

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
