const { parentPort, workerData } = require('node:worker_threads')
const sharp = require('sharp')
const { convertPixels } = require('@visioncortex/vtracer')

function tracePixels(data, width, height, color, maxPaths) {
  const raw = convertPixels(data, width, height, { clustering: 'bw', mode: 'spline', filterSpeckle: 8, cornerThreshold: 60, lengthThreshold: 4, maxIterations: 10, pathPrecision: 3 })
  const paths = []
  for (const match of raw.matchAll(/<path\b([^>]*)\/>/g)) {
    const attrs = match[1]
    const d = /\bd="([^"]+)"/.exec(attrs)?.[1]
    const fill = /\bfill="([^"]+)"/.exec(attrs)?.[1]
    if (!d || d.length > 50000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(d) || /\btransform=/.test(attrs)) throw new Error('路径过于复杂，请缩小范围')
    if (fill?.toLowerCase() === '#000000') paths.push(`<path d="${d}" fill="${color}"/>`)
  }
  if (!paths.length) throw new Error('没有可用轮廓')
  if (paths.length > maxPaths) throw new Error('轮廓过于细碎，请减少颜色或缩小范围')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${paths.join('')}</svg>`
  if (svg.length > 500000) throw new Error('路径过于复杂，请缩小范围')
  return { svg, pathCount: paths.length, width, height }
}

async function run() {
  const input = Buffer.from(workerData.input)
  const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) throw new Error('请提交不超过4096像素的PNG图片')
  if (workerData.kind === 'mask') {
    const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      const black = (data[i] + data[i + 1] + data[i + 2]) / 3 < 128
      data[i] = data[i + 1] = data[i + 2] = black ? 0 : 255; data[i + 3] = 255
      if (black) dark++
    }
    if (dark < 16 || dark / (info.width * info.height) > .95) throw new Error('目标颜色太少或几乎覆盖整张图，请调整裁剪范围和颜色')
    return tracePixels(data, info.width, info.height, '#000000', 40)
  }

  const colors = workerData.colors
  if (!Number.isInteger(colors) || colors < 2 || colors > 8) throw new Error('颜色数量应为2至8')
  // libimagequant in Sharp provides the palette; VTracer traces each mask.
  const palettePng = await sharp(input).resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png({ palette: true, colours: colors, dither: 0, effort: 3 }).toBuffer()
  const { data, info } = await sharp(palettePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const labels = new Int16Array(width * height).fill(-1)
  const palette = [], lookup = new Map()
  let transparentBorder = 0, borderPixels = 0
  for (let p = 0; p < labels.length; p++) {
    const i = p * 4, x = p % width, y = Math.floor(p / width)
    const border = x === 0 || y === 0 || x === width - 1 || y === height - 1
    if (border) borderPixels++
    if (data[i + 3] < 128) { if (border) transparentBorder++; continue }
    const color = '#' + [data[i], data[i + 1], data[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')
    let label = lookup.get(color)
    if (label === undefined) { label = palette.length; lookup.set(color, label); palette.push({ color, pixels: 0, border: 0 }) }
    labels[p] = label; palette[label].pixels++; if (border) palette[label].border++
  }
  const backgroundIndex = transparentBorder > borderPixels / 2 ? -1 : palette.reduce((best, entry, index) => entry.border > (palette[best]?.border || 0) ? index : best, -1)
  const layers = [], warnings = []
  let paths = 0, bytes = 0
  for (let index = 0; index < palette.length; index++) {
    const entry = palette[index]
    if (entry.pixels < 16) { warnings.push(`颜色${entry.color}面积太小，未保留`); continue }
    const mask = Buffer.alloc(width * height * 4, 255)
    for (let p = 0; p < labels.length; p++) if (labels[p] === index) mask[p * 4] = mask[p * 4 + 1] = mask[p * 4 + 2] = 0
    try {
      const traced = tracePixels(mask, width, height, entry.color, 120)
      if (paths + traced.pathCount > 120 || bytes + traced.svg.length > 1_000_000) throw new Error('总路径数量或文件大小超限')
      paths += traced.pathCount; bytes += traced.svg.length
      // A border colour can also contain lettering and icons. Only auto-deselect
      // a background that traces to one contour; retain multipart colour layers.
      layers.push({ ...traced, id: `color-${index}`, color: entry.color, pixels: entry.pixels, background: index === backgroundIndex && entry.border > borderPixels * .45 && traced.pathCount === 1 })
    } catch (error) { warnings.push(`颜色${entry.color}未保留：${error.message}`) }
  }
  if (!layers.length) throw new Error('没有可用颜色层，请缩小范围或减少颜色')
  return { width, height, sourceWidth: metadata.width, sourceHeight: metadata.height, layers, warnings, pathCount: paths }
}

run().then((result) => parentPort.postMessage({ result })).catch((error) => parentPort.postMessage({ error: error.message || '图片分层失败' }))
