import { Router, type Response } from 'express'
import multer from 'multer'
import { detectedImageMime } from '../security/imageValidation.ts'
import { traceMaskToSvg, traceColorLayers } from '../services/vectorize.ts'
import { vectorizerStatus, vectorizerOptionsSchema, VectorizerError } from '../services/providers/vectorizerai.ts'
import { submitVectorTask, listVectorTasks, getVectorTask, reprocessVectorTask, vectorRawFile, vectorBudget, hasActiveVectorTask } from '../services/vectorTasks.ts'
import { z } from 'zod'
import { config } from '../config.ts'
import path from 'node:path'

export const vectorizeRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
let active = false
const dailyAttempts = new Map<string, number>()
const contextSchema = z.object({ projectId: z.uuid(), assetId: z.uuid(), elementId: z.uuid(), crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).refine(crop => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001, '框选范围无效') })
const bodySchema = vectorizerOptionsSchema.extend({ context: z.string().max(2000).optional(), force: z.enum(['0', '1']).optional() }).strict()
const usernameOf = (response: { locals: Record<string, unknown> }) => (response.locals.invite as { username: string }).username
const sendError = (response: Response, error: unknown) => {
  response.status(error instanceof VectorizerError ? error.status : 503).json({ error: error instanceof VectorizerError ? error.message : '任务记录暂时不可用，已阻止重复收费提交' })
}

vectorizeRouter.get('/providers', (_request, response) => {
  response.json({ local: { available: true }, vectorizerai: vectorizerStatus() })
})
vectorizeRouter.get('/budget', async (_request, response) => {
  try { response.json(await vectorBudget(usernameOf(response))) } catch (error) { sendError(response, error) }
})
vectorizeRouter.get('/tasks', async (request, response) => {
  try { response.json(await listVectorTasks(usernameOf(response), typeof request.query.projectId === 'string' ? request.query.projectId : undefined, typeof request.query.assetId === 'string' ? request.query.assetId : undefined)) } catch (error) { sendError(response, error) }
})
vectorizeRouter.get('/tasks/:id', async (request, response) => {
  try { const task = await getVectorTask(usernameOf(response), String(request.params.id)); if (!task) { response.sendStatus(404); return }; response.json(task) } catch (error) { sendError(response, error) }
})
vectorizeRouter.post('/tasks/:id/reprocess', async (request, response) => {
  try { response.json(await reprocessVectorTask(usernameOf(response), String(request.params.id))) } catch (error) { sendError(response, error) }
})
vectorizeRouter.get('/tasks/:id/raw', async (request, response) => {
  try {
    const owner = usernameOf(response), id = String(request.params.id), task = await getVectorTask(owner, id, false)
    if (!task?.rawUrl) { response.sendStatus(404); return }
    response.setHeader('Content-Type', 'application/octet-stream')
    response.setHeader('Content-Disposition', `attachment; filename="trace-${id}-unverified-response.txt"`)
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox allow-downloads")
    response.sendFile(vectorRawFile(owner, id), error => { if (error && !response.headersSent) response.sendStatus(404) })
  } catch (error) { sendError(response, error) }
})
vectorizeRouter.get('/tasks/:id/preview', async (request, response) => {
  try {
    const owner = usernameOf(response), id = String(request.params.id), task = await getVectorTask(owner, id, false)
    if (!task || task.status !== 'ready' || !task.previewUrl) { response.sendStatus(404); return }
    response.setHeader('Content-Type', 'image/svg+xml')
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
    response.sendFile(path.resolve(config.vectorizerResultsDir, owner, `${id}.svg`), error => { if (error && !response.headersSent) response.sendStatus(404) })
  } catch (error) { sendError(response, error) }
})
vectorizeRouter.get('/results/:id', (request, response) => {
  const username = response.locals.invite?.username as string | undefined
  const id = String(request.params.id)
  if (!username || !/^[a-z][a-z0-9_-]{1,30}$/.test(username) || !/^[0-9a-f-]{36}$/.test(id)) { response.sendStatus(404); return }
  response.setHeader('Content-Type', 'image/svg+xml')
  response.setHeader('Content-Disposition', `attachment; filename="trace-${id}.svg"`)
  response.setHeader('Cache-Control', 'private, no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox allow-downloads")
  response.sendFile(path.resolve(config.vectorizerResultsDir, username, `${id}.svg`), error => { if (error && !response.headersSent) response.sendStatus(404) })
})

vectorizeRouter.post('/high-quality', upload.single('mask'), async (request, response) => {
  if (active) { response.status(429).json({ error: '本地描摹正在处理，请稍后再试，尚未调用上游' }); return }
  if (!request.file || request.file.mimetype !== 'image/png' || detectedImageMime(request.file.buffer) !== 'image/png') { response.status(400).json({ error: '只能提交有效PNG图片' }); return }
  const parsed = bodySchema.safeParse(request.body || {})
  if (!parsed.success) { response.status(400).json({ error: parsed.error.issues.map(issue => issue.message).join('；') }); return }
  const { context: encoded, force, ...options } = parsed.data
  if (force === '1' && request.get('X-Confirm-Paid-Retry') !== '1') { response.status(400).json({ error: '重新付费提交须明确确认' }); return }
  try {
    const context = encoded ? contextSchema.parse(JSON.parse(encoded)) : undefined
    const task = await submitVectorTask(usernameOf(response), request.file.buffer, options, context, force === '1', request.get('Prefer') !== 'respond-async')
    if (task.status === 'ready') response.json({ ...task, taskId: task.id })
    else if (['running', 'processing', 'needs_repair'].includes(task.status)) response.status(202).json({ ...task, taskId: task.id })
    else response.status(task.errorStatus || 502).json({ ...task, taskId: task.id })
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) { response.status(400).json({ error: '项目或框选信息无效' }); return }
    sendError(response, error)
  }
})
vectorizeRouter.post(['/mask', '/layers'], upload.single('mask'), async (request, response) => {
  if (active || hasActiveVectorTask()) { response.status(429).json({ error: '矢量化正在处理另一张图，请稍后重试' }); return }
  if (!request.file || request.file.mimetype !== 'image/png' || detectedImageMime(request.file.buffer) !== 'image/png') {
    response.status(400).json({ error: '只能提交有效的 PNG 图片' }); return
  }
  const colors = Number(request.body?.colors || 6)
  if (request.path === '/layers' && (!Number.isInteger(colors) || colors < 2 || colors > 8)) { response.status(400).json({ error: '颜色数量应为2至8' }); return }
  const username = response.locals.invite?.username as string | undefined
  const key = `${new Date().toISOString().slice(0, 10)}:${username || 'unknown'}`
  for (const oldKey of dailyAttempts.keys()) if (!oldKey.startsWith(key.slice(0, 10))) dailyAttempts.delete(oldKey)
  const attempts = dailyAttempts.get(key) || 0
  if (attempts >= 10) { response.status(429).json({ error: '今日矢量化测试次数已达 10 次' }); return }
  dailyAttempts.set(key, attempts + 1)
  active = true
  try {
    response.json(request.path === '/layers' ? await traceColorLayers(request.file.buffer, colors) : await traceMaskToSvg(request.file.buffer))
  }
  catch (error) { response.status(error instanceof VectorizerError ? error.status : 400).json({ error: error instanceof Error ? error.message : '矢量化失败' }) }
  finally { active = false }
})
