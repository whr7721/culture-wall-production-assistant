// Both server responses and browser imports pass through this allowlist.
const ns = 'http://www.w3.org/2000/svg'
const paintKeys = new Set(['fill', 'stroke', 'stroke-width', 'fill-rule', 'stroke-linecap', 'stroke-linejoin', 'vector-effect', 'display'])
const attributes = new Set(['viewBox', 'width', 'height', 'id', 'd', 'version', 'transform', 'style', 'preserveAspectRatio', 'shape-rendering', ...paintKeys])
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const shapeKeys = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points'])

function shapePath(node: Element): string {
  const n = (key: string, fallback = 0) => {
    const value = Number(node.getAttribute(key) ?? fallback)
    if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error('SVG图元坐标无效')
    return value
  }
  if (node.localName === 'line') return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
  if (['polyline', 'polygon'].includes(node.localName)) {
    const points = (node.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
    if (points.length < 4 || points.length % 2 || !points.every(v => Number.isFinite(v) && Math.abs(v) <= 1e7)) throw new Error('SVG多边形坐标无效')
    return `M${points[0]} ${points[1]}${points.slice(2).reduce((s, v, i) => s + (i % 2 ? ` ${v}` : `L${v}`), '')}${node.localName === 'polygon' ? 'Z' : ''}`
  }
  if (['circle', 'ellipse'].includes(node.localName)) {
    const x = n('cx'), y = n('cy'), rx = node.localName === 'circle' ? n('r') : n('rx'), ry = node.localName === 'circle' ? rx : n('ry')
    if (rx <= 0 || ry <= 0) throw new Error('SVG椭圆半径无效')
    return `M${x-rx} ${y}A${rx} ${ry} 0 1 0 ${x+rx} ${y}A${rx} ${ry} 0 1 0 ${x-rx} ${y}Z`
  }
  const x = n('x'), y = n('y'), w = n('width'), h = n('height')
  if (w <= 0 || h <= 0) throw new Error('SVG矩形尺寸无效')
  const rx = Math.min(w / 2, Math.max(0, n('rx', n('ry')))), ry = Math.min(h / 2, Math.max(0, n('ry', rx)))
  if (!rx || !ry) return `M${x} ${y}H${x+w}V${y+h}H${x}Z`
  return `M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`
}

export function cleanVectorSvg(source: string, parse: (source: string) => Document, maxLength = 1_000_000): { svg: string; pathCount: number; width: number; height: number } {
  // Legacy SVG 1.1 exports can declare the standard external DTD. Remove only
  // this exact declaration before parsing; internal subsets/entities stay rejected.
  source = source.replace(/<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\1\s+(["'])https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\2\s*>/gi, '')
  if (source.length > maxLength || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source)) throw new Error('SVG过大或包含不支持的声明')
  const doc = parse(source), root = doc.documentElement
  if (!root || doc.getElementsByTagName('parsererror').length || root.localName !== 'svg' || root.namespaceURI !== ns) throw new Error('SVG格式错误')
  const view = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number) || [0, 0, Number(root.getAttribute('width')), Number(root.getAttribute('height'))]
  if (view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new Error('SVG需要有效viewBox')
  let pathCount = 0, count = 0
  const walk = (node: Element, depth: number): string => {
    if (depth > 30 || ++count > 10000) throw new Error('SVG结构过于复杂')
    if (['metadata', 'title', 'desc'].includes(node.localName)) return ''
    const shape = ['circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'].includes(node.localName)
    if (node.namespaceURI !== ns || (!shape && !['svg', 'g', 'path'].includes(node.localName)) || (node.localName === 'svg' && node !== root)) throw new Error(`不支持${node.localName}，请先转换为路径`)
    const attrs: string[] = []
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes.item(i)!
      if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue
      if (attr.namespaceURI || (!attributes.has(attr.name) && !(shape && shapeKeys.has(attr.name)))) throw new Error(`不支持 SVG 属性 ${attr.name}`)
      if (/url\s*\(|javascript:|data:|https?:/i.test(attr.value)) throw new Error('SVG包含外链或不安全引用')
      if (attr.name === 'style') {
        for (const rule of attr.value.split(';').filter(v => v.trim())) {
          if (!paintKeys.has(rule.split(':')[0].trim()) || rule.split(':').length !== 2) throw new Error('SVG样式包含不支持的属性')
        }
      }
      if (shape && (shapeKeys.has(attr.name) || ['width', 'height'].includes(attr.name))) continue
      attrs.push(`${attr.name}="${escape(attr.value)}"`)
    }
    if (node === root) { attrs.push(`xmlns="${ns}"`); if (!root.getAttribute('viewBox')) attrs.push(`viewBox="${view.join(' ')}"`) }
    if (shape) attrs.push(`d="${escape(shapePath(node))}"`)
    const tag = shape ? 'path' : node.localName
    if (tag === 'path') pathCount++
    let children = ''
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes.item(i)!
      if (child.nodeType === 1) {
        if (tag === 'path') throw new Error('SVG路径包含子对象')
        children += walk(child as Element, depth + 1)
      } else if (child.nodeType === 3 && child.nodeValue?.trim()) throw new Error('SVG包含不支持的文本内容')
    }
    return `<${tag} ${attrs.join(' ')}>${children}</${tag}>`
  }
  const svg = walk(root, 0)
  if (!pathCount) throw new Error('SVG没有矢量轮廓')
  return { svg, pathCount, width: view[2], height: view[3] }
}
