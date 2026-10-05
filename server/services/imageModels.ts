import { config } from '../config.ts'

export type ImageModelChoice = 'default' | 'kami-banana' | 'kami-banana-4k'

export function imageModelOptions() {
  return [
    { id: 'default' as const, label: config.imageProvider === 'alibaba' ? `百炼 · ${config.alibabaModel}` : `现有中转站 · ${config.imageModel}`, available: config.imageProvider === 'alibaba' ? Boolean(config.alibabaApiKey && config.alibabaBaseUrl) : Boolean(config.imageApiKey), detail: '沿用当前已配置通道' },
    { id: 'kami-banana' as const, label: '卡米 · Nano Banana 2K', available: Boolean(config.kamiApiKey), detail: '参考图与文生图；实际模型映射以卡米账户为准' },
    { id: 'kami-banana-4k' as const, label: '卡米 · Nano Banana Pro 4K', available: Boolean(config.kamiApiKey), detail: '4K 档可能更贵、更慢；需先核实账户支持' },
  ]
}

export function resolveImageModelChoice(value: unknown): ImageModelChoice | null {
  if (value === undefined || value === '') return 'default'
  return imageModelOptions().find((option) => option.id === value && option.available)?.id || null
}
