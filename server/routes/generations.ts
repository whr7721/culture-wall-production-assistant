import { Router } from 'express'
import multer from 'multer'
import { buildGenerationPrompt } from '../domain/generation.ts'
import { resolveImageSize } from '../../shared/imageSize.ts'
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
  const customSize = String(request.body.size || '')
  const shortTitle = String(request.body.shortTitle || '').trim()

  if (prompt.length < 10 || prompt.length > 1200) {
    response.status(400).json({ error: '需求描述应为 10—1200 个字符。' })
    return
  }
  if (shortTitle.length > 16 || /[\r\n]/.test(shortTitle)) {
    response.status(400).json({ error: '画面短标题最多 16 个字符，且不能换行。' })
    return
  }
  const size = resolveImageSize(aspect, customSize)
  if (!size) {
    response.status(400).json({ error: '自定义尺寸需为 512—2048 像素、16 的倍数，比例不超过 3:1，且不少于 655360 像素。' })
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
    const providerPrompt = buildGenerationPrompt(prompt, style, shortTitle)
    const saved = await generateWithProvider({
      prompt: providerPrompt,
      size,
      references,
    }, (response.locals.invite as InviteRecord).username)
    response.json({ ...saved, prompt, style, aspect, requestedSize: size, createdAt: new Date().toISOString() })
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
