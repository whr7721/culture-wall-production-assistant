import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { config } from './config.ts'
import { generationsRouter } from './routes/generations.ts'

const app = express()
const generatedDir = path.resolve('generated')
const distDir = path.resolve('dist')

app.disable('x-powered-by')
app.use('/generated', express.static(generatedDir, { index: false, maxAge: '1h' }))
app.use('/api/generations', generationsRouter)
app.get('/api/health', (_request, response) => {
  response.json({ ok: true, providerConfigured: Boolean(config.imageApiKey), model: config.imageModel })
})

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
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
  console.log(`Image provider: ${config.imageModel} (${config.imageApiKey ? 'configured' : 'missing key'})`)
})
