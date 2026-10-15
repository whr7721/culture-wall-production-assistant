import { Path } from 'fabric'
import svgpath from 'svgpath'
import type { WallElement } from './projects'
import { cleanVectorSvg } from '../../shared/vectorSvg'

const ns = 'http://www.w3.org/2000/svg'
const pathPattern = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/
const paintKeys = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'display'])
const attributes = new Set(['viewBox', 'width', 'height', 'id', 'd', 'version', 'transform', 'style', 'preserveAspectRatio', 'shape-rendering', ...paintKeys])

export function svgPhysicalSize(source: string) {
  const root = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement
  const unitMm: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 }
  const physical = (value: string | null) => {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/.exec(value || '')
    return match ? Number(match[1]) * unitMm[match[2] || ''] : 0
  }
  const view = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const width = physical(root.getAttribute('width')), height = physical(root.getAttribute('height'))
  const ratio = view.length === 4 && view[2] > 0 && view[3] > 0 ? view[2] / view[3] : width && height ? width / height : 1
  return { width: width || (height ? height * ratio : 1000), height: height || (width ? width / ratio : 1000 / ratio) }
}

function paint(value: string): string {
  if (value === 'none') return value
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('').toLowerCase()
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000' }
  if (named[value.toLowerCase()]) return named[value.toLowerCase()]
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value)
  if (rgb && rgb.slice(1).every((n) => Number(n) <= 255)) return '#' + rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
  throw new Error('当前支持纯色路径；请先在原软件展开渐变、透明度和外观')
}

function checkedTransform(value: string): string {
  let end = 0
  for (const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    if (!/^[\s,]*$/.test(value.slice(end, match.index))) throw new Error('SVG坐标变换格式无效')
    const numbers = match[2].trim().split(/[\s,]+/).map(Number)
    const counts: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }
    if (!counts[match[1]].includes(numbers.length) || !numbers.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e7)) throw new Error('SVG坐标变换参数无效')
    end = match.index! + match[0].length
  }
  if (!/^[\s,]*$/.test(value.slice(end))) throw new Error('SVG坐标变换格式无效')
  return value
}

// Sanitize the object tree before baking group/path transforms with svgpath.
// The source document is never inserted into the page DOM.
export async function importSvgPaths(text: string, widthMm: number): Promise<WallElement[]> {
  if (!Number.isFinite(widthMm) || widthMm <= 0) throw new Error('导入宽度无效')
  const sourceDoc = new DOMParser().parseFromString(text, 'image/svg+xml')
  if (!sourceDoc.documentElement.hasAttribute('viewBox')) {
    const size = svgPhysicalSize(text)
    if (!sourceDoc.documentElement.hasAttribute('width') || !sourceDoc.documentElement.hasAttribute('height')) throw new Error('SVG缺少画板尺寸')
    sourceDoc.documentElement.setAttribute('viewBox', `0 0 ${size.width * 96 / 25.4} ${size.height * 96 / 25.4}`)
    text = new XMLSerializer().serializeToString(sourceDoc)
  }
  text = cleanVectorSvg(text, source => new DOMParser().parseFromString(source, 'image/svg+xml')).svg
  if (text.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('SVG过大或包含不支持的声明')
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== ns) throw new Error('SVG格式错误')
  const viewAttribute = root.getAttribute('viewBox')
  const view = viewAttribute ? viewAttribute.trim().split(/[\s,]+/).map(Number) : [0, 0, Number(root.getAttribute('width')), Number(root.getAttribute('height'))]
  if (view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new Error('SVG需要有效viewBox或无单位的像素宽高')
  const scale = widthMm / view[2]
  const elements: WallElement[] = []
  function walk(node: Element, inherited: Record<string, string>, transforms: string[], depth: number) {
    if (depth > 30) throw new Error('SVG分组嵌套过深')
    if (['metadata', 'title', 'desc'].includes(node.localName)) return
    if (node.namespaceURI !== ns || !['svg', 'g', 'path'].includes(node.localName) || (node.localName === 'svg' && node !== root)) throw new Error(`暂不支持 ${node.localName}，请先转换为路径`)
    const style = { ...inherited }
    for (const attr of node.attributes) {
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
      if (attr.namespaceURI || !attributes.has(attr.name)) throw new Error(`不支持 SVG 属性 ${attr.name}`)
      if (paintKeys.has(attr.name)) style[attr.name] = attr.value.trim()
    }
    for (const declaration of (node.getAttribute('style') || '').split(';').filter((s) => s.trim())) {
      const separator = declaration.indexOf(':')
      const key = declaration.slice(0, separator).trim(), value = declaration.slice(separator + 1).trim()
      if (separator < 1 || !paintKeys.has(key)) throw new Error('SVG样式包含不支持的属性')
      style[key] = value
    }
    const nextTransforms = [...transforms, checkedTransform(node.getAttribute('transform') || '')].filter(Boolean)
    if (style.display === 'none') return
    if (style.display && !['block', 'inline'].includes(style.display)) throw new Error('不支持此显示样式')
    if (node.localName !== 'path') { for (const child of node.children) walk(child, style, nextTransforms, depth + 1); return }
    if (node.children.length) throw new Error('路径内部包含不支持的对象')
    const source = node.getAttribute('d') || ''
    if (!source || source.length > 50000 || !pathPattern.test(source)) throw new Error('路径数据无效或过于复杂')
    const transform = nextTransforms.join(' ')
    const builder = svgpath(source)
    if ((builder as unknown as { err: string }).err) throw new Error('路径数据无效')
    // Keep relative commands: expanding a detailed contour to absolute coordinates
    // needlessly inflates its size, while Fabric and SVG both support relative paths.
    const d = builder.transform(transform).round(6).toString()
    if (d.length > 50000 || !pathPattern.test(d) || /NaN|Infinity/.test(d)) throw new Error('变换后的路径无效或过于复杂')
    const fill = paint(style.fill || '#000000'), stroke = paint(style.stroke || 'none')
    let strokeWidth = stroke === 'none' ? 0 : Number(style['stroke-width'] || 1)
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 1000) throw new Error('描边宽度无效')
    if (style['vector-effect'] && !['none', 'non-scaling-stroke'].includes(style['vector-effect'])) throw new Error('不支持此描边效果')
    if (strokeWidth && transform && style['vector-effect'] !== 'non-scaling-stroke') {
      const holder = document.createElementNS(ns, 'g')
      holder.setAttribute('transform', transform)
      const matrix = holder.transform.baseVal.consolidate()?.matrix
      if (!matrix) throw new Error('无法读取描边变换')
      const sx = Math.hypot(matrix.a, matrix.b), sy = Math.hypot(matrix.c, matrix.d)
      if (Math.abs(sx - sy) > 1e-6 || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 1e-6) throw new Error('非等比缩放的描边需先在原软件扩展为路径')
      strokeWidth *= sx
    }
    if (strokeWidth > 1000) throw new Error('变换后的描边过宽')
    const fillRule = style['fill-rule'] || 'nonzero'
    const strokeLineCap = style['stroke-linecap'] || 'butt', strokeLineJoin = style['stroke-linejoin'] || 'miter'
    if (!['nonzero', 'evenodd'].includes(fillRule) || !['butt', 'round', 'square'].includes(strokeLineCap) || !['miter', 'round', 'bevel'].includes(strokeLineJoin)) throw new Error('填充或描边规则无效')
    if (fill === 'none' && !strokeWidth) return
    const object = new Path(d)
    const x = object.pathOffset.x - object.width / 2 - strokeWidth / 2, y = object.pathOffset.y - object.height / 2 - strokeWidth / 2
    const width = object.width + strokeWidth, height = object.height + strokeWidth
    if (![x, y, width, height].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e7) || width <= 0 || height <= 0) throw new Error('存在无效或零面积路径')
    // Boundary strokes can extend half their width beyond an otherwise valid
    // viewBox (Vectorizer's white frame does this). Keep the path data intact.
    if (x < view[0] - strokeWidth / 2 - .01 || y < view[1] - strokeWidth / 2 - .01) throw new Error('路径超出画板左上边界，请先调整SVG画板')
    elements.push({ id: crypto.randomUUID(), kind: 'path', d, sourceX: x, sourceY: y, sourceWidth: width, sourceHeight: height, x: Math.max(0, x - view[0]) * scale, y: Math.max(0, y - view[1]) * scale, width: width * scale, height: height * scale, fill, stroke, strokeWidth, fillRule: fillRule as 'nonzero' | 'evenodd', strokeLineCap: strokeLineCap as 'butt' | 'round' | 'square', strokeLineJoin: strokeLineJoin as 'miter' | 'round' | 'bevel', label: `SVG路径${elements.length + 1}` })
    if (elements.length > 120) throw new Error('一次最多导入120个路径，请减少颜色或缩小范围')
  }
  walk(root, {}, [], 0)
  if (!elements.length) throw new Error('SVG没有可见路径')
  return elements
}
