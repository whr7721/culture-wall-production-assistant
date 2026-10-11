import { loadSVGFromString, Path } from 'fabric'
import type { WallElement } from './projects'

// Fail closed for this first experiment: path-only, solid paint, no transforms,
// fonts, images, CSS, filters or links. Never pass an unvalidated SVG to Fabric.
export async function importSvgPaths(text: string, widthMm: number): Promise<WallElement[]> {
  if (text.length > 100000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('SVG过大或包含不支持的声明')
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('SVG格式错误')
  const allowed = new Set(['svg', 'g', 'path', 'title', 'desc'])
  const attrs = new Set(['xmlns', 'viewBox', 'width', 'height', 'id', 'd', 'fill', 'stroke', 'stroke-width', 'version'])
  for (const node of doc.querySelectorAll('*')) {
    if (!allowed.has(node.localName)) throw new Error(`当前仅支持简单路径SVG，不支持${node.localName}`)
    for (const attr of node.attributes) if (!attrs.has(attr.name)) throw new Error(`不支持SVG属性${attr.name}，请先在矢量软件展开变换和外观`)
    const d = node.getAttribute('d')
    if (d && (d.length > 50000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(d))) throw new Error('路径数据无效或过于复杂')
    const strokeWidth = node.getAttribute('stroke-width')
    if (strokeWidth && (!Number.isFinite(Number(strokeWidth)) || Number(strokeWidth) < 0 || Number(strokeWidth) > 1000)) throw new Error('描边宽度无效')
    for (const attr of ['fill', 'stroke']) {
      const paint = node.getAttribute(attr)
      if (paint && !/^(#[0-9a-fA-F]{6}|none)$/.test(paint)) throw new Error('当前仅支持六位十六进制纯色或none')
    }
  }
  const view = (doc.documentElement.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new Error('SVG需要有效viewBox')
  if (doc.querySelectorAll('path').length > 40) throw new Error('一次最多导入40个路径')
  const parsed = await loadSVGFromString(new XMLSerializer().serializeToString(doc))
  const scale = widthMm / view[2]
  return parsed.objects.filter((item) => item !== null).map((object, index) => {
    if (!(object instanceof Path) || object.width <= 0 || object.height <= 0) throw new Error('存在不支持的对象或零面积路径')
    const d = object.path.map((command) => command.join(' ')).join(' ')
    const x = object.pathOffset.x - object.width / 2, y = object.pathOffset.y - object.height / 2
    if (x < view[0] || y < view[1]) throw new Error('路径超出viewBox，需先整理原文件')
    return { id: crypto.randomUUID(), kind: 'path', d, sourceX: x, sourceY: y, sourceWidth: object.width, sourceHeight: object.height, x: (x - view[0]) * scale, y: (y - view[1]) * scale, width: object.width * scale, height: object.height * scale, fill: object.fill === 'rgb(0,0,0)' ? '#000000' : typeof object.fill === 'string' ? object.fill : 'none', stroke: typeof object.stroke === 'string' ? object.stroke : 'none', strokeWidth: object.stroke ? object.strokeWidth : 0, label: `SVG路径${index + 1}` }
  })
}
