import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.ts'
import { isSupportedImage } from '../security/imageValidation.ts'

export interface ProviderInput {
  prompt: string
  size: string
  references: Express.Multer.File[]
}

interface ProviderImage {
  b64_json?: string
  url?: string
}

export interface ProviderOutput {
  image: ProviderImage
  provider: 'relay' | 'alibaba'
  model: string
  allowedDownloadHosts: string[]
}

function extensionFromBytes(bytes: Buffer): 'png' | 'jpg' | 'webp' {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg'
  if (bytes.subarray(0, 4).toString() === 'RIFF') return 'webp'
  return 'png'
}

async function readLimitedImage(response: Response): Promise<Buffer> {
  const limit = 24 * 1024 * 1024
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > limit) throw new Error('生成图片超过允许大小')
  const chunks: Buffer[] = []
  let length = 0
  if (!response.body) throw new Error('生成图片内容为空')
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const buffer = Buffer.from(value)
      length += buffer.length
      if (length > limit) throw new Error('生成图片超过允许大小')
      chunks.push(buffer)
    }
  } finally {
    reader.releaseLock()
  }
  const image = Buffer.concat(chunks)
  if (!isSupportedImage(image)) throw new Error('供应商返回了不支持的图片格式')
  return image
}

async function persistProviderImage(output: ProviderOutput, username: string): Promise<{ id: string; imageUrl: string }> {
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(username)) throw new Error('受邀账号格式错误')
  const id = randomUUID()
  const outputDir = path.resolve(config.generatedDir, username)
  await mkdir(outputDir, { recursive: true, mode: 0o700 })

  let bytes: Buffer
  if (output.image.b64_json) {
    if (output.image.b64_json.length > 34 * 1024 * 1024) throw new Error('生成图片超过允许大小')
    bytes = Buffer.from(output.image.b64_json, 'base64')
    if (!isSupportedImage(bytes)) throw new Error('供应商返回了不支持的图片格式')
  } else if (output.image.url) {
    const imageUrl = new URL(output.image.url)
    if (imageUrl.protocol !== 'https:' || !output.allowedDownloadHosts.includes(imageUrl.hostname.toLowerCase())) {
      throw new Error('供应商图片下载域名未列入允许清单')
    }
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000), redirect: 'error' })
    if (!response.ok) throw new Error('供应商返回了图片地址，但下载图片失败')
    bytes = await readLimitedImage(response)
  } else {
    throw new Error('供应商响应中没有找到图片数据')
  }

  const filename = `${id}.${extensionFromBytes(bytes)}`
  await writeFile(path.join(outputDir, filename), bytes, { mode: 0o600 })
  return { id, imageUrl: `/generated/${filename}` }
}

export async function generateWithProvider(input: ProviderInput, username: string): Promise<{ id: string; imageUrl: string; provider: string; model: string }> {
  const { generateWithRelay } = await import('./providers/relay.ts')
  const { generateWithAlibaba } = await import('./providers/alibaba.ts')
  const output = config.imageProvider === 'alibaba' ? await generateWithAlibaba(input) : await generateWithRelay(input)
  const saved = await persistProviderImage(output, username)
  return { ...saved, provider: output.provider, model: output.model }
}
