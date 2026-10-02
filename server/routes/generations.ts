import { Router } from 'express'
import multer from 'multer'
import { buildGenerationPrompt, sizeByAspect } from '../domain/generation.ts'
import { generateWithProvider } from '../services/imageProvider.ts'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 3 },
  fileFilter: (_request, file, callback) => {
    callback(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype))
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

  try {
    const providerPrompt = buildGenerationPrompt(prompt, style)
    const saved = await generateWithProvider({
      prompt: providerPrompt,
      size: sizeByAspect[aspect] || sizeByAspect.landscape,
      references: (request.files as Express.Multer.File[]) || [],
    })
    response.json({ ...saved, prompt, style, aspect, createdAt: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成服务发生未知错误'
    console.error('[generation]', message)
    response.status(502).json({ error: message })
  }
})

export const generationsRouter = router
