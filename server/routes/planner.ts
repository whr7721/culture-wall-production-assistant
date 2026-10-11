import { Router } from 'express'
import multer from 'multer'
import { config } from '../config.ts'
import { plannerInputSchema } from '../../shared/planner.ts'
import { planWithKimi } from '../services/kimiPlanner.ts'
import { GenerationGate, GateError } from '../security/generationGate.ts'
import { isSupportedImage } from '../security/imageValidation.ts'

export const plannerRouter = Router()
const gate = new GenerationGate({ usageFile: config.plannerUsageFile, dailyGenerationLimit: config.plannerDailyLimit, totalGenerationLimit: config.plannerTotalLimit, maxConcurrentGenerations: 1, minGenerationIntervalMs: 30000 })
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 3, fileSize: 12 * 1024 * 1024 }, fileFilter: (_request, file, callback) => {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return callback(new Error('UNSUPPORTED_IMAGE_TYPE'))
  callback(null, true)
} })
plannerRouter.get('/status', (_request, response) => response.json({ available: config.kimiEnabled && Boolean(config.kimiApiKey), model: config.kimiModel }))
plannerRouter.post('/', (request, response, next) => {
  if (!config.kimiEnabled || !config.kimiApiKey) { response.status(503).json({ error: 'Kimi 尚未启用，请管理员配置密钥并确认测试费用后开启。' }); return }
  next()
}, upload.array('references', 3), async (request, response) => {
  const parsed = plannerInputSchema.safeParse({ brief: request.body.brief, exactCopy: request.body.exactCopy || '', widthMm: Number(request.body.widthMm), heightMm: Number(request.body.heightMm) })
  const references = (request.files as Express.Multer.File[]) || []
  if (!parsed.success || request.body.authorized !== '1' || references.some((file) => !isSupportedImage(file.buffer))) { response.status(400).json({ error: '请填写有效需求、毫米尺寸，确认素材发送授权，并上传有效 PNG/JPEG/WebP 图片。' }); return }
  let release: (() => void) | undefined
  try {
    release = await gate.acquire({ username: response.locals.invite.username })
    response.json(await planWithKimi(parsed.data, references))
  } catch (error) {
    if (error instanceof GateError) {
      if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds))
      response.status(429).json({ error: error.message }); return
    }
    // 不记录上游正文，避免客户资料或密钥进入日志。
    response.status(502).json({ error: 'Kimi 整理未完成，请检查服务配置或稍后手动重试。本次尝试计入整理额度，不会自动重试。' })
  } finally { release?.() }
})
