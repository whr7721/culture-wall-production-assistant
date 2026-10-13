import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router, json } from 'express'
import multer from 'multer'
import { config } from '../config.ts'
import { projectSchema, projectWarnings, type Project } from '../domain/project.ts'
import { detectedImageMime } from '../security/imageValidation.ts'
import type { InviteRecord } from '../security/invites.ts'
import { recognizeWithProvider } from '../services/ocr.ts'

export const projectsRouter = Router()
const idPattern = /^[0-9a-f-]{36}$/
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1 } })
let ocrActive = false
const ocrAttempts = new Map<string, number>()
projectsRouter.use(json({ limit: '2mb' }))
projectsRouter.param('id', (request, response, next, id) => {
  if (!idPattern.test(String(id))) { response.sendStatus(404); return }
  next()
})

function userDir(username: string): string {
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(username)) throw new Error('账号格式错误')
  return path.resolve(config.projectsDir, username)
}
function usernameOf(response: { locals: Record<string, unknown> }): string {
  return (response.locals.invite as InviteRecord).username
}
function projectFile(username: string, id: string): string {
  if (!idPattern.test(id)) throw new Error('项目编号无效')
  return path.join(userDir(username), id, 'project.json')
}
async function readProject(username: string, id: string): Promise<Project | null> {
  try { return projectSchema.parse(JSON.parse(await readFile(projectFile(username, id), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}
async function saveProject(username: string, project: Project): Promise<void> {
  const file = projectFile(username, project.id)
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(project, null, 2), { mode: 0o600 })
  await rename(temporary, file)
}

projectsRouter.get('/', async (_request, response) => {
  const dir = userDir(usernameOf(response))
  let ids: string[]
  try { ids = await readdir(dir) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { response.json([]); return }
    throw error
  }
  const rows = await Promise.all(ids.filter((id) => idPattern.test(id)).map((id) => readProject(usernameOf(response), id)))
  response.json(rows.filter(Boolean).map((item) => ({ id: item!.id, title: item!.title, updatedAt: item!.updatedAt, status: item!.status })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
})

projectsRouter.post('/', async (request, response) => {
  const title = String(request.body?.title || '未命名文化墙').trim().slice(0, 80)
  const now = new Date().toISOString()
  const project = projectSchema.parse({
    id: randomUUID(), title, widthMm: 3500, heightMm: 2300,
    measurementStatus: 'to_measure', copy: '', notes: '', obstacles: [], elements: [],
    assets: [], concepts: [], status: 'draft', revision: 1, createdAt: now, updatedAt: now,
  })
  const dir = userDir(usernameOf(response))
  const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))
  if (entries.length >= 20) { response.status(400).json({ error: '每个账号最多保存 20 个项目' }); return }
  await saveProject(usernameOf(response), project)
  response.status(201).json(project)
})

projectsRouter.get('/:id', async (request, response) => {
  const project = await readProject(usernameOf(response), String(request.params.id))
  if (!project) { response.sendStatus(404); return }
  response.json({ ...project, warnings: projectWarnings(project) })
})

projectsRouter.put('/:id', async (request, response) => {
  const id = String(request.params.id)
  const current = await readProject(usernameOf(response), id)
  if (!current) { response.sendStatus(404); return }
  const parsed = projectSchema.safeParse(request.body)
  if (!parsed.success || parsed.data.id !== id || parsed.data.revision !== current.revision) {
    response.status(409).json({ error: '项目版本已变化或数据无效，请重新打开项目再保存' }); return
  }
  const candidate = { ...parsed.data, assets: current.assets, createdAt: current.createdAt }
  const warnings = projectWarnings(candidate)
  if (candidate.status === 'approved' && (warnings.length || candidate.elements.length === 0)) {
    response.status(400).json({ error: '仍有尺寸或碰撞问题，不能确认平面稿', warnings }); return
  }
  const next = { ...candidate, revision: current.revision + 1, updatedAt: new Date().toISOString() }
  await saveProject(usernameOf(response), next)
  response.json({ ...next, warnings })
})

projectsRouter.post('/:id/assets', upload.single('asset'), async (request, response) => {
  const id = String(request.params.id)
  const project = await readProject(usernameOf(response), id)
  if (!project) { response.sendStatus(404); return }
  const file = request.file
  if (!file || detectedImageMime(file.buffer) !== file.mimetype) {
    response.status(400).json({ error: '素材必须是有效的 PNG、JPEG 或 WebP' }); return
  }
  if (project.assets.length >= 20) { response.status(400).json({ error: '每项目最多 20 份素材' }); return }
  const assetId = randomUUID()
  const extension = file.mimetype === 'image/jpeg' ? 'jpg' : file.mimetype === 'image/webp' ? 'webp' : 'png'
  const assetDir = path.join(userDir(usernameOf(response)), id, 'assets')
  await mkdir(assetDir, { recursive: true, mode: 0o700 })
  await writeFile(path.join(assetDir, `${assetId}.${extension}`), file.buffer, { mode: 0o600 })
  const asset = { id: assetId, name: path.basename(file.originalname).slice(0, 100), mime: file.mimetype, url: `/api/projects/${id}/assets/${assetId}` }
  project.assets.push(asset as Project['assets'][number])
  project.revision++
  project.updatedAt = new Date().toISOString()
  project.status = 'draft'
  await saveProject(usernameOf(response), project)
  response.status(201).json({ asset, project })
})

projectsRouter.get('/:id/assets/:assetId', async (request, response) => {
  const id = String(request.params.id)
  const assetId = String(request.params.assetId)
  const project = await readProject(usernameOf(response), id)
  const asset = project?.assets.find((item) => item.id === assetId)
  if (!asset) { response.sendStatus(404); return }
  const extension = asset.mime === 'image/jpeg' ? 'jpg' : asset.mime === 'image/webp' ? 'webp' : 'png'
  const file = path.join(userDir(usernameOf(response)), id, 'assets', `${assetId}.${extension}`)
  try { await stat(file) } catch { response.sendStatus(404); return }
  response.type(asset.mime).sendFile(file)
})

projectsRouter.post('/:id/ocr', upload.single('source_image'), async (request, response) => {
  const project = await readProject(usernameOf(response), String(request.params.id))
  if (!project) { response.sendStatus(404); return }
  if (ocrActive) { response.status(429).json({ error: '另一张图片正在识别，请稍后重试' }); return }
  const file = request.file
  if (!file || detectedImageMime(file.buffer) !== file.mimetype) { response.status(400).json({ error: 'OCR 只接受有效的 PNG、JPEG 或 WebP 图片' }); return }
  if (request.body?.action !== 'ocr' || request.body?.provider && request.body.provider !== 'rapidocr') { response.status(400).json({ error: '当前仅支持本地 RapidOCR' }); return }
  const width = Number(request.body?.width), height = Number(request.body?.height)
  if (![width, height].every((value) => Number.isInteger(value) && value > 0 && value <= 6000)) { response.status(400).json({ error: '图片宽高无效' }); return }
  const key = `${new Date().toISOString().slice(0, 10)}:${usernameOf(response)}`
  const attempts = ocrAttempts.get(key) || 0
  if (attempts >= 10) { response.status(429).json({ error: '今日 OCR 测试次数已达 10 次' }); return }
  ocrAttempts.set(key, attempts + 1)
  ocrActive = true
  try {
    const result = await recognizeWithProvider(file.buffer)
    if (result.data.width !== width || result.data.height !== height) { response.status(400).json({ error: '图片尺寸与提交值不一致' }); return }
    response.json(result)
  } catch (error) { response.status(503).json({ error: error instanceof Error ? error.message : '本地 OCR 暂不可用' }) }
  finally { ocrActive = false }
})
