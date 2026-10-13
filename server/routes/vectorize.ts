import { Router } from 'express'
import multer from 'multer'
import { detectedImageMime } from '../security/imageValidation.ts'
import { traceMaskToSvg } from '../services/vectorize.ts'

export const vectorizeRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } })
let active = false
const dailyAttempts = new Map<string, number>()

vectorizeRouter.post('/mask', upload.single('mask'), async (request, response) => {
  if (active) { response.status(429).json({ error: '矢量化正在处理另一张图，请稍后重试' }); return }
  if (!request.file || request.file.mimetype !== 'image/png' || detectedImageMime(request.file.buffer) !== 'image/png') {
    response.status(400).json({ error: '只能提交有效的 PNG 蒙版' }); return
  }
  const username = response.locals.invite?.username as string | undefined
  const key = `${new Date().toISOString().slice(0, 10)}:${username || 'unknown'}`
  const attempts = dailyAttempts.get(key) || 0
  if (attempts >= 10) { response.status(429).json({ error: '今日矢量化测试次数已达 10 次' }); return }
  dailyAttempts.set(key, attempts + 1)
  active = true
  try { response.json(await traceMaskToSvg(request.file.buffer)) }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : '矢量化失败' }) }
  finally { active = false }
})
