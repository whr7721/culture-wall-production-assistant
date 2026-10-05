import { z } from 'zod'

const positive = z.number().finite().positive()
const coordinate = z.number().finite().min(0)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const uuid = z.uuid()

export const obstacleSchema = z.object({
  id: uuid, label: z.string().trim().min(1).max(60),
  x: coordinate, y: coordinate, width: positive, height: positive,
})
const elementBase = z.object({
  id: uuid, x: coordinate, y: coordinate, width: positive, height: positive,
})
const elementSchema = z.discriminatedUnion('kind', [
  elementBase.extend({ kind: z.literal('rect'), fill: color, label: z.string().max(80).default('装饰') }),
  elementBase.extend({ kind: z.literal('text'), text: z.string().max(1200), fontSizeMm: positive.max(300), color }),
  elementBase.extend({ kind: z.literal('image'), assetId: uuid, label: z.string().max(80).default('图片') }),
])
export const assetSchema = z.object({
  id: uuid, name: z.string().max(100), mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  url: z.string().startsWith('/api/projects/'),
})
export const conceptSchema = z.object({
  id: uuid, imageUrl: z.string().regex(/^\/generated\/[0-9a-f-]{36}\.(png|jpg|webp)$/),
  provider: z.string().max(40).default('unknown'), model: z.string().max(80).default('unknown'),
  role: z.enum(['space', 'flat']), createdAt: z.string().datetime(),
})
export const projectSchema = z.object({
  id: uuid, title: z.string().trim().min(1).max(80),
  widthMm: positive.max(50000), heightMm: positive.max(20000),
  measurementStatus: z.enum(['confirmed', 'to_measure']),
  copy: z.string().max(5000), notes: z.string().max(2000),
  obstacles: z.array(obstacleSchema).max(30), elements: z.array(elementSchema).max(120),
  assets: z.array(assetSchema).max(20), concepts: z.array(conceptSchema).max(30),
  status: z.enum(['draft', 'approved']), revision: z.number().int().min(1),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
})
export type Project = z.infer<typeof projectSchema>

function inside(width: number, height: number, item: { x: number; y: number; width: number; height: number }): boolean {
  return item.x + item.width <= width && item.y + item.height <= height
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function projectWarnings(project: Project): string[] {
  const warnings: string[] = []
  if (project.measurementStatus !== 'confirmed') warnings.push('墙体尺寸尚未复尺确认')
  for (const obstacle of project.obstacles) if (!inside(project.widthMm, project.heightMm, obstacle)) warnings.push(`障碍物“${obstacle.label}”超出墙体`)
  for (const element of project.elements) {
    if (!inside(project.widthMm, project.heightMm, element)) warnings.push(`元素 ${element.id.slice(0, 8)} 超出墙体`)
    for (const obstacle of project.obstacles) if (overlaps(element, obstacle)) warnings.push(`元素 ${element.id.slice(0, 8)} 与“${obstacle.label}”冲突`)
    if (element.kind === 'image' && !project.assets.some((asset) => asset.id === element.assetId)) warnings.push(`元素 ${element.id.slice(0, 8)} 的素材缺失`)
  }
  return warnings
}
