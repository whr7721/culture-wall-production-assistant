import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.ts'

export interface ProviderInput {
  prompt: string
  size: string
  references: Express.Multer.File[]
}

interface ProviderImage {
  b64_json?: string
  url?: string
}

interface ProviderResponse {
  data?: ProviderImage[]
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${config.imageApiKey}` }
}

async function callGeneration(input: ProviderInput): Promise<Response> {
  return fetch(`${config.imageApiBaseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.imageModel, prompt: input.prompt, n: 1, size: input.size }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  })
}

async function callEdit(input: ProviderInput): Promise<Response> {
  const body = new FormData()
  body.set('model', config.imageModel)
  body.set('prompt', input.prompt)
  body.set('n', '1')
  body.set('size', input.size)
  input.references.forEach((file) => {
    const bytes = Uint8Array.from(file.buffer)
    body.append('image', new Blob([bytes], { type: file.mimetype }), file.originalname)
  })

  return fetch(`${config.imageApiBaseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: authHeaders(),
    body,
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  })
}

function extensionFromContentType(contentType: string | null): string {
  if (contentType?.includes('jpeg')) return 'jpg'
  if (contentType?.includes('webp')) return 'webp'
  return 'png'
}

async function persistProviderImage(image: ProviderImage): Promise<{ id: string; imageUrl: string }> {
  const id = randomUUID()
  const outputDir = path.resolve('generated')
  await mkdir(outputDir, { recursive: true })

  if (image.b64_json) {
    const filename = `${id}.png`
    await writeFile(path.join(outputDir, filename), Buffer.from(image.b64_json, 'base64'))
    return { id, imageUrl: `/generated/${filename}` }
  }

  if (image.url) {
    const response = await fetch(image.url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new Error('中转站返回了图片地址，但下载图片失败')
    const extension = extensionFromContentType(response.headers.get('content-type'))
    const filename = `${id}.${extension}`
    await writeFile(path.join(outputDir, filename), Buffer.from(await response.arrayBuffer()))
    return { id, imageUrl: `/generated/${filename}` }
  }

  throw new Error('中转站响应中没有找到图片数据')
}

export async function generateWithProvider(input: ProviderInput): Promise<{ id: string; imageUrl: string }> {
  if (!config.imageApiKey) throw new Error('尚未配置 IMAGE_API_KEY，请先填写本机 .env')

  const response = input.references.length > 0 ? await callEdit(input) : await callGeneration(input)
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`中转站请求失败（HTTP ${response.status}）：${detail}`)
  }

  const payload = (await response.json()) as ProviderResponse
  const image = payload.data?.[0]
  if (!image) throw new Error('中转站响应格式异常：缺少 data[0]')
  return persistProviderImage(image)
}
