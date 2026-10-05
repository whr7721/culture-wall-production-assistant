import { config } from '../config.ts'

export type ImageModelChoice = 'default' | 'kami-banana' | 'kami-banana-4k'

export function imageModelOptions() {
  return [
    { id: 'default' as const, label: config.imageProvider === 'alibaba' ? 'Qwen Image 3.0' : 'Image 2.5', available: config.imageProvider === 'alibaba' ? Boolean(config.alibabaApiKey && config.alibabaBaseUrl) : Boolean(config.imageApiKey), detail: '适合日常方案探索，支持参考图继续修改' },
    { id: 'kami-banana' as const, label: 'Nano Banana 2K', available: Boolean(config.kamiApiKey), detail: '适合快速探索，支持文字和参考图生成' },
    { id: 'kami-banana-4k' as const, label: 'Nano Banana Pro 4K', available: Boolean(config.kamiApiKey), detail: '更高清的画面档位，生成可能更慢、费用更高' },
  ]
}

export function resolveImageModelChoice(value: unknown): ImageModelChoice | null {
  if (value === undefined || value === '') return 'default'
  return imageModelOptions().find((option) => option.id === value && option.available)?.id || null
}
