import { Worker } from 'node:worker_threads'

export type TraceResult = { svg: string; pathCount: number; width: number; height: number }
export type ColorLayer = TraceResult & { id: string; color: string; pixels: number; background: boolean }
export type ColorLayersResult = { width: number; height: number; sourceWidth: number; sourceHeight: number; layers: ColorLayer[]; warnings: string[]; pathCount: number }

function run<T>(input: Buffer, kind: 'mask' | 'layers', colors?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vectorizeWorker.cjs', import.meta.url), { workerData: { input, kind, colors }, resourceLimits: { maxOldGenerationSizeMb: 256 } })
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('转换超过30秒，请缩小范围后重试')) }, 30_000)
    worker.once('message', (message: { result?: T; error?: string }) => {
      clearTimeout(timeout); void worker.terminate()
      if (message.error || !message.result) reject(new Error(message.error || '转换结果为空'))
      else resolve(message.result)
    })
    worker.once('error', (error) => { clearTimeout(timeout); reject(error) })
    worker.once('exit', (code) => { clearTimeout(timeout); if (code !== 0) reject(new Error('转换任务已停止，请缩小图片范围')) })
  })
}

export const traceMaskToSvg = (input: Buffer) => run<TraceResult>(input, 'mask')
export const traceColorLayers = (input: Buffer, colors = 6) => run<ColorLayersResult>(input, 'layers', colors)
