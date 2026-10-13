import sharp from 'sharp'
import { convertPixels } from '@visioncortex/vtracer'

// This deliberately accepts a binary mask, not an arbitrary photograph. The
// user chooses one element/colour before tracing; no semantic layer claim.
export async function traceMaskToSvg(input: Buffer): Promise<{ svg: string; pathCount: number; width: number; height: number }> {
  const metadata = await sharp(input, { limitInputPixels: 16_000_000 }).metadata()
  if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) {
    throw new Error('请提交不超过 4096 像素的 PNG 蒙版')
  }
  const { data, info } = await sharp(input).flatten({ background: '#ffffff' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let dark = 0
  for (let i = 0; i < data.length; i += 4) {
    const black = (data[i] + data[i + 1] + data[i + 2]) / 3 < 128
    data[i] = data[i + 1] = data[i + 2] = black ? 0 : 255
    data[i + 3] = 255
    if (black) dark++
  }
  if (dark < 16 || dark / (info.width * info.height) > 0.95) throw new Error('目标颜色太少或几乎覆盖整张图，请调整裁剪范围和颜色')
  const raw = convertPixels(data, info.width, info.height, { clustering: 'bw', mode: 'spline', filterSpeckle: 8, cornerThreshold: 60, lengthThreshold: 4, maxIterations: 10, pathPrecision: 3 })
  const paths: string[] = []
  for (const match of raw.matchAll(/<path\b([^>]*)\/>/g)) {
    const attrs = match[1]
    const d = /\bd="([^"]+)"/.exec(attrs)?.[1]
    const fill = /\bfill="([^"]+)"/.exec(attrs)?.[1]
    if (!d || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(d) || !/^#[0-9a-fA-F]{6}$/.test(fill || '') || /\btransform=/.test(attrs)) throw new Error('描摹结果包含不支持的路径，请缩小裁剪范围')
    if (fill?.toLowerCase() === '#000000') paths.push(`<path d="${d}" fill="#000000"/>`)
  }
  if (!paths.length || paths.length > 40) throw new Error('未得到可编辑轮廓，或路径超过 40 条；请缩小裁剪范围')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}" viewBox="0 0 ${info.width} ${info.height}">${paths.join('')}</svg>`
  if (svg.length > 100_000) throw new Error('路径过于复杂；请缩小范围或改用 PNG 素材')
  return { svg, pathCount: paths.length, width: info.width, height: info.height }
}
