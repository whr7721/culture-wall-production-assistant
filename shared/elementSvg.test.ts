import { describe, it, expect } from 'vitest'
import { elementSvg } from './elementSvg'

describe('independent SVG asset', () => {
  it('exports a genuine path with local scale and no raster wrapper', () => {
    const svg = elementSvg({ id: 'p', kind: 'path', width: 400, height: 400, sourceX: 10, sourceY: 10, sourceWidth: 80, sourceHeight: 80, d: 'M10 10 L90 10 L90 90 Z', fill: '#183d58', stroke: 'none', strokeWidth: 0 })
    expect(svg).toContain('<path')
    expect(svg).toContain('scale(5 5)')
    expect(svg).toContain('translate(-10 -10)')
    expect(svg).not.toContain('<image')
  })
  it('keeps physical local bounds and contains no raster image', () => {
    const svg = elementSvg({ id: 'a', kind: 'rect', width: 500, height: 250, fill: '#123456' })
    expect(svg).toContain('width="500mm"')
    expect(svg).toContain('viewBox="0 0 500 250"')
    expect(svg).not.toContain('<image')
  })
  it('keeps independent editable text and escapes markup', () => {
    const svg = elementSvg({ id: 'b', kind: 'text', width: 900, height: 200, text: '欧连 & ACH\n<script>', fontSizeMm: 60, color: '#183d58' })
    expect(svg).toContain('欧连 &amp; ACH')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('dy="72"')
    expect(svg).not.toContain('<script>')
  })
  it('does not falsely wrap images as vectors', () => {
    expect(() => elementSvg({ id: 'c', kind: 'image', width: 100, height: 100 })).toThrow('尚未矢量化')
  })
})
