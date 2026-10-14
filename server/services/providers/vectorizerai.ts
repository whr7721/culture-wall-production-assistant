import { DOMParser } from '@xmldom/xmldom'
import { z } from 'zod'
import sharp from 'sharp'
import { EnvHttpProxyAgent } from 'undici'
import { config } from '../../config.ts'
import { cleanVectorSvg } from '../../../shared/vectorSvg.ts'
import type { TraceResult } from '../vectorize.ts'

export const vectorizerOptionsSchema = z.object({
  'output.draw_style': z.enum(['fill_shapes', 'stroke_shapes', 'stroke_edges']).default('stroke_edges'),
  'processing.palette': z.string().trim().max(1024).default('').refine(value => !value || /^(?:#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\s*;\s*)+$/.test(value), '锁色请使用 #RRGGBB; 或 #RRGGBBAA;，多色以分号分隔'),
  'processing.max_colors': z.coerce.number().int().min(0).max(256).default(0),
  'output.group_by': z.enum(['none', 'color', 'parent', 'layer']).default('none'),
}).strict()
export type VectorizerOptions = z.infer<typeof vectorizerOptionsSchema>
export type VectorizerResult = TraceResult & { provider: 'vectorizerai'; channel: 'official' | '302'; mode: 'test' | 'production'; warnings: string[]; chargedCredits: string | null }
export class VectorizerError extends Error {
  constructor(message: string, public status = 502, public stage: 'preflight' | 'network' | 'upstream' | 'processing' = 'processing') { super(message) }
}
export type RawVectorResponse = { httpStatus: number; rawComplete: boolean; byteLength: number; chargedCredits: string | null; requestId?: string }
export const RAW_VECTOR_LIMIT = 64 * 1024 * 1024
export const CLEAN_VECTOR_LIMIT = 16 * 1024 * 1024
const safeHeader = (value: string | null) => value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : undefined
export function processVectorizerSvg(source: string, options: VectorizerOptions): VectorizerResult {
  try {
    if (/^\s*[\[{]/.test(source)) throw new Error('上游返回JSON，未取得SVG文件；需核实通道响应协议')
    const cleaned = cleanVectorSvg(source, text => new DOMParser({ onError: () => { throw new Error('SVG格式错误') } }).parseFromString(text, 'image/svg+xml') as unknown as Document, CLEAN_VECTOR_LIMIT)
    return { ...cleaned, provider: 'vectorizerai', channel: config.vectorizerChannel as 'official' | '302', mode: config.vectorizerMode as 'test' | 'production', chargedCredits: null, warnings: [...(cleaned.pathCount > 120 || Buffer.byteLength(cleaned.svg) > 1_000_000 ? ['完整SVG可下载；当前画布限制不能容纳全部轮廓，请在设计软件编辑或减少导入对象。无需重新调用描摹。'] : []), ...(options['output.group_by'] === 'color' && options['output.draw_style'] !== 'fill_shapes' ? ['描边模式按颜色分组可能不生成分组；加入画布时按独立路径展开。'] : [])] }
  } catch (error) { throw new VectorizerError(`本地SVG清洗未完成：${error instanceof Error ? error.message : '格式无效'}；可从已保存响应免费重处理`) }
}
let proxyAgent: EnvHttpProxyAgent | undefined
export function vectorizerStatus() {
  const validChannel = config.vectorizerChannel === 'official' || config.vectorizerChannel === '302'
  const validMode = config.vectorizerMode === 'test' || config.vectorizerMode === 'production'
  const configured = config.vectorizerChannel === '302' ? Boolean(config.vectorizer302ApiKey) : Boolean(config.vectorizerApiId && config.vectorizerApiSecret)
  const modeAllowed = validMode && (config.vectorizerChannel !== '302' || config.vectorizerMode === 'production')
  return { available: config.vectorizerEnabled && configured && validChannel && modeAllowed, enabled: config.vectorizerEnabled, configured, mode: validMode ? config.vectorizerMode : 'invalid', freeTest: config.vectorizerChannel === 'official' && config.vectorizerMode === 'test', reason: !config.vectorizerEnabled ? '高质量描摹暂未启用' : !validChannel ? '服务端描摹通道配置无效' : !configured ? config.vectorizerChannel === '302' ? '尚未配置高质量描摹服务端 API Key' : '尚未配置服务端 API Id / API Secret；免费 test 模式也需要凭据' : !validMode ? '服务端描摹模式配置无效' : !modeAllowed ? '该通道按次计费；确认开通费用后由维护者将服务端模式设为 production' : '' }
}
export async function vectorizeWithVectorizerAI(input: Buffer, options: VectorizerOptions, capture?: (raw: Buffer, metadata: RawVectorResponse) => Promise<void>): Promise<VectorizerResult> {
  const status = vectorizerStatus()
  if (!status.available) throw new VectorizerError(status.reason, 503, 'preflight')
  let endpoint: URL
  try { endpoint = new URL(config.vectorizerChannel === '302' ? 'https://api.302.ai/vectorizer/api/v1/vectorize' : config.vectorizerEndpoint) } catch { throw new VectorizerError('描摹 API 地址配置无效', 503, 'preflight') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new VectorizerError('描摹 API 地址必须为不含凭据及查询参数的 HTTPS 地址', 503, 'preflight')
  const parsed = vectorizerOptionsSchema.parse(options)
  const meta = await sharp(input, { limitInputPixels: 33_554_432 }).metadata()
  if (meta.format !== 'png') throw new VectorizerError('只能提交有效的 PNG 图片', 400)
  const form = new FormData()
  form.set('image', new Blob([new Uint8Array(input)], { type: 'image/png' }), 'selection.png')
  form.set('mode', config.vectorizerMode)
  form.set('output.file_format', 'svg')
  form.set('output.svg.adobe_compatibility_mode', 'true')
  form.set('output.parameterized_shapes.flatten', 'false')
  for (const [key, value] of Object.entries(parsed)) if (value !== '') form.set(key, String(value))
  let response: Response
  try {
    const authorization = config.vectorizerChannel === '302' ? `Bearer ${config.vectorizer302ApiKey}` : `Basic ${Buffer.from(`${config.vectorizerApiId}:${config.vectorizerApiSecret}`).toString('base64')}`
    const options: RequestInit & { dispatcher?: EnvHttpProxyAgent } = { method: 'POST', redirect: 'error', headers: { Authorization: authorization }, body: form, signal: AbortSignal.timeout(config.vectorizerTimeoutMs) }
    if (config.vectorizerUseEnvProxy) options.dispatcher = proxyAgent ||= new EnvHttpProxyAgent()
    response = await fetch(endpoint, options)
  } catch { throw new VectorizerError('上游连接失败或超时，费用状态未知；请先查看任务记录，不会自动重试', 502, 'network') }
  if (!response.ok) {
    await response.body?.cancel()
    const message = response.status === 402 ? '高质量描摹余额不足（HTTP 402），请检查订阅或额度；未自动重试' : response.status === 429 ? '高质量描摹上游限流（HTTP 429），请稍后手动重试' : response.status === 401 || response.status === 403 ? `高质量描摹认证失败（HTTP ${response.status}），请检查服务端凭据` : `高质量描摹失败（HTTP ${response.status}）；未自动重试`
    throw new VectorizerError(message, [402, 429].includes(response.status) ? response.status : 502, 'upstream')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new VectorizerError('高质量描摹返回空文件')
  const metadata: RawVectorResponse = { httpStatus: response.status, rawComplete: false, byteLength: 0, chargedCredits: response.headers.get('x-credits-charged'), requestId: safeHeader(response.headers.get('x-request-id') || response.headers.get('x-302-request-id')) }
  const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const retained = value.subarray(0, Math.max(0, RAW_VECTOR_LIMIT - size))
      chunks.push(retained); size += retained.byteLength
      if (retained.byteLength < value.byteLength) { await reader.cancel(); throw new Error('上游响应超过64MB，已保留部分响应，勿重复收费提交') }
    }
    metadata.rawComplete = true
  } catch (error) {
    metadata.byteLength = size
    await capture?.(Buffer.concat(chunks), metadata)
    throw new VectorizerError(`上游响应接收未完成：${error instanceof Error ? error.message : '连接中断'}；已保留接收内容`, 502, 'network')
  }
  metadata.byteLength = size
  const raw = Buffer.concat(chunks)
  await capture?.(raw, metadata)
  const cleaned = processVectorizerSvg(raw.toString('utf8'), parsed)
  return { ...cleaned, chargedCredits: metadata.chargedCredits, warnings: [status.freeTest ? '免费测试SVG含水印。' : '上游credit字段不等于302实际PTC扣费，实际账单需在平台核对。', ...cleaned.warnings] }
}
