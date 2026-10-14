import { describe, expect, it } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { cleanVectorSvg } from './vectorSvg.ts'
const parse = (source: string) => new DOMParser({ onError: () => { throw new Error('XML格式错误') } }).parseFromString(source, 'image/svg+xml') as unknown as Document
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`
describe('shared SVG cleaning', () => {
  it('preserves groups, strokes and transforms and expands safe geometric primitives', () => {
    const result = cleanVectorSvg(svg('<g id="icons" transform="translate(2 3)" fill="none" stroke="#1a2f7c"><rect x="10" y="10" width="20" height="30" rx="2"/><ellipse cx="60" cy="60" rx="15" ry="10"/><polyline points="1,1 2,2 3,1"/><line x1="1" y1="10" x2="30" y2="10"/></g>'), parse)
    expect(result.pathCount).toBe(4)
    expect(result.svg).toContain('id="icons"')
    expect(result.svg).toContain('transform="translate(2 3)"')
    expect(result.svg).toContain('stroke="#1a2f7c"')
    expect(result.svg).not.toContain('<rect')
  })
  it.each(['<script/>', '<image href="https://example.com"/>', '<foreignObject/>', '<path d="M0 0L10 10" onclick="alert(1)"/>', '<path d="M0 0L10 10" fill="url(#gradient)"/>', '<style>path {fill:red}</style>'])('rejects unsupported content %s', body => {
    expect(() => cleanVectorSvg(svg(body), parse)).toThrow()
  })
  it('rejects declarations and malformed XML', () => {
    expect(() => cleanVectorSvg('<!DOCTYPE svg [<!ENTITY x "test">]>' + svg('<path d="M0 0L1 1"/>'), parse)).toThrow()
    expect(() => cleanVectorSvg(svg('<path>'), parse)).toThrow()
  })
  it('removes only the known SVG 1.1 DTD without loading external resources', () => {
    const result = cleanVectorSvg('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">' + svg('<path d="M0 0L1 1"/>'), parse)
    expect(result.pathCount).toBe(1)
    expect(result.svg).not.toContain('DOCTYPE')
    expect(() => cleanVectorSvg('<!DOCTYPE svg SYSTEM "https://example.com/unsafe.dtd">' + svg('<path d="M0 0L1 1"/>'), parse)).toThrow()
  })
})
