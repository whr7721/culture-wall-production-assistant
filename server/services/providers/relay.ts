import { config } from '../../config.ts'
import type { ProviderInput, ProviderOutput } from '../imageProvider.ts'

export async function generateWithRelay(input: ProviderInput): Promise<ProviderOutput> {
  if (!config.imageApiKey) throw new Error('未配置中转站生图密钥')
  const headers = { Authorization: `Bearer ${config.imageApiKey}` }
  let response: Response
  if (input.references.length) {
    const body = new FormData()
    body.set('model', config.imageModel)
    body.set('prompt', input.prompt)
    body.set('n', '1')
    body.set('size', input.size)
    input.references.forEach((file) => body.append('image', new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }), file.originalname))
    response = await fetch(`${config.imageApiBaseUrl}/v1/images/edits`, {
      method: 'POST', headers, body, signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } else {
    response = await fetch(`${config.imageApiBaseUrl}/v1/images/generations`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.imageModel, prompt: input.prompt, n: 1, size: input.size }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  }
  if (!response.ok) throw new Error(`中转站请求失败（HTTP ${response.status}）`)
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
  if (!payload.data?.[0]) throw new Error('中转站响应缺少图片数据')
  return {
    image: payload.data[0], provider: 'relay', model: config.imageModel,
    allowedDownloadHosts: [new URL(config.imageApiBaseUrl).hostname.toLowerCase(), ...config.imageDownloadHosts],
  }
}
