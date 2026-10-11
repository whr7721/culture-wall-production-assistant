type Element = { id: string; kind: string; width: number; height: number; text?: string; fontSizeMm?: number; color?: string; fill?: string; d?: string; sourceX?: number; sourceY?: number; sourceWidth?: number; sourceHeight?: number; stroke?: string; strokeWidth?: number }
const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')

// Local coordinates preserve physical size, not the element's position on the wall.
// Raster images are deliberately rejected: an SVG wrapper is not vectorization.
export function elementSvg(item: Element): string {
  if (!['text', 'rect', 'path'].includes(item.kind)) throw new Error('图片尚未矢量化，不能作为独立矢量导出')
  if (![item.width, item.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('元素尺寸无效')
  let body = ''
  if (item.kind === 'path') body = `<g transform="scale(${item.width / item.sourceWidth!} ${item.height / item.sourceHeight!})"><path transform="translate(${-item.sourceX!} ${-item.sourceY!})" d="${escapeXml(item.d!)}" fill="${escapeXml(item.fill || 'none')}" stroke="${escapeXml(item.stroke || 'none')}" stroke-width="${item.strokeWidth || 0}"/></g>`
  else if (item.kind === 'rect') body = `<rect width="${item.width}" height="${item.height}" fill="${escapeXml(item.fill || '#000000')}"/>`
  else {
    const font = item.fontSizeMm!
    if (!Number.isFinite(font) || font <= 0) throw new Error('文字字号无效')
    const lines = (item.text || '').split('\n').map((line, index) => `<tspan x="0" dy="${index ? font * 1.2 : 0}">${escapeXml(line)}</tspan>`).join('')
    body = `<text x="0" y="${font}" font-size="${font}" font-family="Arial, sans-serif" fill="${escapeXml(item.color || '#000000')}" xml:space="preserve">${lines}</text>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width}mm" height="${item.height}mm" viewBox="0 0 ${item.width} ${item.height}"><metadata>独立设计资产，非生产文件；文字依赖字体，不是转曲路径</metadata>${body}</svg>`
}
