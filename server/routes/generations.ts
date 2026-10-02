import { Router } from 'express'
import multer from 'multer'
import { buildGenerationPrompt, sizeByAspect } from '../domain/generation.ts'
import { generateWithProvider } from '../services/imageProvider.ts'
import { GateError, generationGate } from '../security/generationGate.ts'
import type { InviteRecord } from '../security/invites.ts'
import { isSupportedImage } from '../security/imageValidation.ts'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 3 },
  fileFilter: (_request, file, callback) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('UNSUPPORTED_IMAGE_TYPE'))
      return
    }
    callback(null, true)
  },
})

router.post('/', upload.array('references', 3), async (request, response) => {
  const prompt = String(request.body.prompt || '').trim()
  const style = String(request.body.style || 'brand')
  const aspect = String(request.body.aspect || 'landscape')

  if (prompt.length < 10 || prompt.length > 1200) {
    response.status(400).json({ error: '需求描述应为 10—1200 个字符。' })
    return
  }

  const references = (request.files as Express.Multer.File[]) || []
  if (references.some((file) => !isSupportedImage(file.buffer))) {
    response.status(400).json({ error: '参考素材必须是有效的 PNG、JPEG 或 WebP 图片。' })
    return
  }

  let release: (() => void) | undefined

  try {
    release = await generationGate.acquire(response.locals.invite as InviteRecord)
    const providerPrompt = buildGenerationPrompt(prompt, style)
    const saved = await generateWithProvider({
      prompt: providerPrompt,
      size: sizeByAspect[aspect] || sizeByAspect.landscape,
      references,
    }, (response.locals.invite as InviteRecord).username)
    response.json({ ...saved, prompt, style, aspect, createdAt: new Date().toISOString() })
  } catch (error) {
    if (error instanceof GateError) {
      if (error.retryAfterSeconds) response.setHeader('Retry-After', String(error.retryAfterSeconds))
      response.status(429).json({ error: error.message })
      return
    }
    console.error('[generation]', error instanceof Error ? error.message : 'unknown')
    response.status(502).json({ error: '生成服务暂时不可用，请稍后再试。若持续失败，请联系测试管理员。' })
  } finally {
    release?.()
  }
})

export const generationsRouter = router
