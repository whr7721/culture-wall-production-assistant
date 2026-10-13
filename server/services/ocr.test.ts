import { describe, expect, it } from 'vitest'
import { sampleTextColor } from './ocr.ts'

function pixels(background: [number, number, number], foreground: [number, number, number]) {
  const data = Buffer.alloc(80 * 40 * 4)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 80; x++) {
    const offset = (y * 80 + x) * 4
    const color = x >= 20 && x < 55 && y >= 12 && y < 27 ? foreground : background
    data.set([...color, 255], offset)
  }
  return data
}

describe('OCR text colour sampling', () => {
  it('finds light letters over a dark panel and dark letters over a light panel', () => {
    const box = { x: 12, y: 6, w: 54, h: 28 }
    expect(sampleTextColor(pixels([24, 56, 88], [255, 255, 255]), 80, 40, box)).toBe('#ffffff')
    expect(sampleTextColor(pixels([255, 255, 255], [16, 32, 48]), 80, 40, box)).toBe('#102030')
  })
})
