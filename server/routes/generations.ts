import { Router } from 'express'
import multer from 'multer'
import { buildGenerationPrompt } from '../domain/generation.ts'
import { resolveImageSize } from '../../shared/imageSize.ts'
import { generateWithProvider } from '../services/imageProvider.ts'
import { GateError, generationGate } from '../security/generationGate.ts'
import type { InviteRecord } from '../security/invites.ts'
import { isSupportedImage } from '../security/imageValidation.ts'
import { imageModelOptions, resolveImageModelChoice } from '../services/imageModels.ts'

const router = Router()
router.get('/models', (_request, response) => response.json({ models: imageModelOptions() }))
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
  const task = String(request.body.task || 'space')
  const exactCopy = String(request.body.exactCopy || '')
  const hasWallSize = request.body.wallWidthMm !== undefined || request.body.wallHeightMm !== undefined
  const wallWidthMm = Number(request.body.wallWidthMm)
  const wallHeightMm = Number(request.body.wallHeightMm)
  if (hasWallSize && (![wallWidthMm, wallHeightMm].every((value) => Number.isFinite(value) && value > 0 && value <= 100000))) {
    response.status(400).json({ error: '请确认墙面宽、高，单位毫米，范围1—100000。' })
    return
  }
  if (!['space', 'flat'].includes(task) || exactCopy.length > 6000) {
    response.status(400).json({ error: '任务类型无效或准确文案超过6000字符。' })
    return
  }
  const modelChoice = resolveImageModelChoice(request.body.modelChoice)
  if (!modelChoice) {
    response.status(400).json({ error: '所选生图模型尚未配置或不可用。' })
    return
  }

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
  if (modelChoice.startsWith('kami-') && aspect === 'custom') {
    response.status(400).json({ error: '卡米 Banana 暂不支持自定义像素尺寸；请选择横版、方形或竖版。' })
    return
  }

  const references = (request.files as Express.Multer.File[]) || []
  if (task === 'flat' && references.length === 0) {
    response.status(400).json({ error: '二维转换必须提供原效果图作为第一张参考图。' })
    return
  }
  if (references.some((file) => !isSupportedImage(file.buffer))) {
    response.status(400).json({ error: '参考素材必须是有效的 PNG、JPEG 或 WebP 图片。' })
    return
  }

  let release: (() => void) | undefined

  try {
    release = await generationGate.acquire(response.locals.invite as InviteRecord)
    const providerPrompt = buildGenerationPrompt(prompt, style, shortTitle, task, exactCopy) + (hasWallSize ? `\n用户确认的墙面尺寸：宽${wallWidthMm}mm，高${wallHeightMm}mm；目标宽高比${wallWidthMm / wallHeightMm}。以此处尺寸为准，像素尺寸仅为生成分辨率，不代表施工精度。` : '')
    const saved = await generateWithProvider({
      prompt: providerPrompt,
      size,
      references,
      modelChoice,
    }, (response.locals.invite as InviteRecord).username)
    response.json({ ...saved, prompt, style, aspect, task, exactCopy, ...(hasWallSize ? { wallWidthMm, wallHeightMm } : {}), requestedSize: size, createdAt: new Date().toISOString() })
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
