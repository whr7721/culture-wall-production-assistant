import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { config } from './config.ts'
import { generationsRouter } from './routes/generations.ts'
import { projectsRouter } from './routes/projects.ts'
import { requireInvite } from './security/invites.ts'

const app = express()
const generatedDir = path.resolve(config.generatedDir)
const distDir = path.resolve('dist')

app.disable('x-powered-by')
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Frame-Options', 'DENY')
  next()
})
app.use(requireInvite)
app.get('/generated/:filename', (request, response) => {
  const filename = request.params.filename
  const username = response.locals.invite?.username as string | undefined
  if (!username || !/^[a-z][a-z0-9_-]{1,30}$/.test(username) || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(filename)) {
    response.sendStatus(404)
    return
  }
  response.sendFile(path.join(generatedDir, username, filename), (error) => {
    if (error && !response.headersSent) response.sendStatus(404)
  })
})
app.use('/api/generations', generationsRouter)
app.use('/api/projects', projectsRouter)
app.get('/api/health', (_request, response) => {
  response.json({ ok: true, providerConfigured: config.imageProvider === 'alibaba' ? Boolean(config.alibabaApiKey && config.alibabaBaseUrl) : Boolean(config.imageApiKey) })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof Error && error.message === 'UNSUPPORTED_IMAGE_TYPE') {
    response.status(400).json({ error: '只接受 PNG、JPEG 或 WebP 图片。' })
    return
  }
  if (error instanceof Error && error.name === 'MulterError') {
    response.status(400).json({ error: '上传失败：最多 3 张图片，且单张不能超过 12 MB。' })
    return
  }
  console.error('[server]', error)
  response.status(500).json({ error: '服务端处理请求时出现错误。' })
})

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*splat', (_request, response) => response.sendFile(path.join(distDir, 'index.html')))
}

app.listen(config.port, '127.0.0.1', () => {
  console.log(`Culture Wall Studio server: http://127.0.0.1:${config.port}`)
  console.log(`Image provider: ${config.imageProvider} (${config.imageProvider === 'alibaba' ? config.alibabaModel : config.imageModel})`)
})
