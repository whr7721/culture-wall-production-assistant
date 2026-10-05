import { config } from '../../config.ts'
import type { ProviderInput, ProviderOutput } from '../imageProvider.ts'

// 百炼兼容模式的编辑使用 /images/generations 的 image 扩展字段，不是 multipart /images/edits。
export async function generateWithAlibaba(input: ProviderInput): Promise<ProviderOutput> {
  if (!config.alibabaApiKey) throw new Error('未配置百炼生图密钥')
  if (!/^https:\/\/[^/]+\/compatible-mode\/v1$/.test(config.alibabaBaseUrl)) throw new Error('未配置与百炼密钥同地域的兼容模式 Base URL')
  if (input.references.some((file) => file.size > 10 * 1024 * 1024)) throw new Error('百炼参考图单张不能超过 10 MB')
  const image = input.references.map((file) => `data:${file.mimetype};base64,${file.buffer.toString('base64')}`)
  const body = {
    model: config.alibabaModel, prompt: input.prompt, n: 1, size: input.size,
    ...(image.length ? { image } : {}),
  }
  const response = await fetch(`${config.alibabaBaseUrl}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.alibabaApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(config.requestTimeoutMs),
  })
  if (!response.ok) throw new Error(`百炼请求失败（HTTP ${response.status}）`)
  const payload = (await response.json()) as { data?: Array<{ url?: string; b64_json?: string }> }
  if (!payload.data?.[0]) throw new Error('百炼响应缺少图片数据')
  return {
    image: payload.data[0], provider: 'alibaba', model: config.alibabaModel,
    allowedDownloadHosts: config.alibabaDownloadHosts,
  }
}
