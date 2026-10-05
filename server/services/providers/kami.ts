import { config } from '../../config.ts'
import type { ProviderInput, ProviderOutput } from '../imageProvider.ts'

// New API documents a Gemini-native image endpoint. Kami's actual channel mapping
// still needs a non-production smoke test after a fresh server-side key is configured.
export async function generateWithKami(input: ProviderInput, model: string, imageSize: '2K' | '4K'): Promise<ProviderOutput> {
  if (!config.kamiApiKey) throw new Error('未配置卡米生图密钥')
  if (!/^https:\/\/[^/?#]+$/.test(config.kamiBaseUrl)) throw new Error('卡米地址必须是 HTTPS 站点根地址')
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('卡米模型 ID 配置不合法')
  const [width, height] = input.size.split('x').map(Number)
  const ratio = width / height
  const aspectRatio = Math.abs(ratio - 1) < 0.05 ? '1:1' : Math.abs(ratio - 1.5) < 0.08 ? '3:2' : Math.abs(ratio - 2 / 3) < 0.05 ? '2:3' : null
  if (!aspectRatio) throw new Error('卡米 Banana 暂只支持横版、方形、竖版预设比例')
  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }]
  for (const file of input.references) {
    parts.push({ inlineData: { mimeType: file.mimetype, data: file.buffer.toString('base64') } })
  }
  const response = await fetch(`${config.kamiBaseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.kamiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio, imageSize } } }),
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  })
  if (!response.ok) throw new Error(`卡米请求失败（HTTP ${response.status}）`)
  const payload = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> }
  const data = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []).find((part) => part.inlineData?.data)?.inlineData?.data
  if (!data) throw new Error('卡米响应中没有图片；请核实模型权限和接口协议')
  return { image: { b64_json: data }, provider: 'kami', model, allowedDownloadHosts: [] }
}
