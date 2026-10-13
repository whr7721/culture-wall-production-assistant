import { writePsd } from 'ag-psd'
import type { Layer } from 'ag-psd'
import type { Project, WallElement } from './projects'
import { elementSvg, textSvgBody } from '../../shared/elementSvg'

export function downloadElementSvg(item: WallElement) {
  const name = (item.kind === 'text' ? item.text : item.label).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '元素'
  download(new Blob([elementSvg(item)], { type: 'image/svg+xml' }), `${name}-独立设计资产.svg`)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
const assetFor = (project: Project, id: string) => {
  const asset = project.assets.find((item) => item.id === id)
  if (!asset) throw new Error('设计图中引用的素材不存在')
  return asset
}
async function assetDataUrl(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('无法读取设计素材')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法转换设计素材'))
    reader.readAsDataURL(blob)
  })
}
async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}
function assertApproved(project: Project) {
  if (project.status !== 'approved') throw new Error('请先保存并确认正视平面稿')
  if (project.elements.length === 0) throw new Error('平面稿还没有可导出的元素')
}
function filename(project: Project, extension: string) {
  return `${project.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}-设计中间稿.${extension}`
}

export async function downloadSvg(project: Project): Promise<void> {
  assertApproved(project)
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${project.widthMm}mm" height="${project.heightMm}mm" viewBox="0 0 ${project.widthMm} ${project.heightMm}">`,
    '<title>文化墙可编辑正视图（设计中间稿，生产前需复核）</title>',
    `<metadata>原始项目 ${xml(project.id)}；实测尺寸 ${project.widthMm} × ${project.heightMm} mm；并非生产文件</metadata>`,
    `<rect width="${project.widthMm}" height="${project.heightMm}" fill="#ffffff"/>`]
  for (const item of project.elements) {
    // Each project element stays a separate SVG group/object. A group is not
    // automatically an Illustrator layer or a manufacturing-ready shape.
    parts.push(`<g id="e-${item.id}">`)
    if (item.kind === 'path') parts.push(`<g transform="translate(${item.x} ${item.y})">${elementSvg(item).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`)
    if (item.kind === 'rect') parts.push(`<rect x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" fill="${item.fill}"/>`)
    if (item.kind === 'text') parts.push(`<g transform="translate(${item.x} ${item.y})">${textSvgBody(item)}</g>`)
    if (item.kind === 'image') {
      const src = await assetDataUrl(assetFor(project, item.assetId).url)
      parts.push(`<image x="${item.x}" y="${item.y}" width="${item.width}" height="${item.height}" preserveAspectRatio="xMidYMid meet" href="${src}" xlink:href="${src}"/>`)
    }
    parts.push('</g>')
  }
  parts.push('</svg>')
  download(new Blob([parts.join('\n')], { type: 'image/svg+xml' }), filename(project, 'svg'))
}

function drawItem(context: CanvasRenderingContext2D, item: WallElement, scale: number, image?: HTMLImageElement) {
  const x = item.x * scale, y = item.y * scale
  if (item.kind === 'rect') {
    context.fillStyle = item.fill
    context.fillRect(x, y, item.width * scale, item.height * scale)
  } else if (item.kind === 'text') {
    context.fillStyle = item.color
    context.font = `${item.fontWeight || 700} ${Math.max(1, item.fontSizeMm * scale)}px Microsoft YaHei, Arial, sans-serif`
    context.textBaseline = 'top'
    context.save(); context.translate(x, y); context.rotate((item.rotationDeg || 0) * Math.PI / 180)
    item.text.split('\n').forEach((line, index) => context.fillText(line, 0, index * item.fontSizeMm * scale * 1.12, item.width * scale))
    context.restore()
  } else if (image) context.drawImage(image, x, y, item.width * scale, item.height * scale)
}
function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas')
  result.width = width
  result.height = height
  return result
}
export async function downloadPsd(project: Project): Promise<void> {
  assertApproved(project)
  if (project.elements.length > 30) throw new Error('PSD 演示导出最多支持 30 个独立元素')
  const scale = 1600 / Math.max(project.widthMm, project.heightMm)
  const width = Math.max(1, Math.round(project.widthMm * scale))
  const height = Math.max(1, Math.round(project.heightMm * scale))
  const composite = canvas(width, height)
  const compositeContext = composite.getContext('2d')!
  compositeContext.fillStyle = '#ffffff'
  compositeContext.fillRect(0, 0, width, height)
  const layers: Layer[] = []
  for (const item of project.elements) {
    const layerCanvas = canvas(width, height)
    const context = layerCanvas.getContext('2d')!
    const image = item.kind === 'image' ? await loadImage(await assetDataUrl(assetFor(project, item.assetId).url)) : item.kind === 'path' ? await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(elementSvg(item))}`) : undefined
    drawItem(context, item, scale, image)
    drawItem(compositeContext, item, scale, image)
    layers.unshift({ name: item.kind === 'text' ? `文字（源文件可修改）：${item.text.slice(0, 20)}` : item.kind === 'image' ? `图片：${item.label}` : `装饰：${item.label}`, canvas: layerCanvas })
  }
  const background = canvas(width, height)
  const bg = background.getContext('2d')!
  bg.fillStyle = '#ffffff'
  bg.fillRect(0, 0, width, height)
  layers.push({ name: '墙体背景', canvas: background })
  const bytes = writePsd({ width, height, canvas: composite, children: layers })
  download(new Blob([bytes], { type: 'image/vnd.adobe.photoshop' }), filename(project, 'psd'))
}

export async function downloadPreview(project: Project): Promise<void> {
  assertApproved(project)
  const scale = 1600 / Math.max(project.widthMm, project.heightMm)
  const result = canvas(Math.round(project.widthMm * scale), Math.round(project.heightMm * scale))
  const context = result.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, result.width, result.height)
  for (const item of project.elements) {
    const image = item.kind === 'image' ? await loadImage(await assetDataUrl(assetFor(project, item.assetId).url)) : item.kind === 'path' ? await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(elementSvg(item))}`) : undefined
    drawItem(context, item, scale, image)
  }
  await new Promise<void>((resolve, reject) => result.toBlob((blob) => { if (!blob) { reject(new Error('预览导出失败')); return }; download(blob, filename(project, 'png')); resolve() }, 'image/png'))
}
