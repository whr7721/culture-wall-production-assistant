import type { VectorTaskView } from '../../shared/vectorTasks'

export async function readVectorTask(id: string, signal?: AbortSignal): Promise<VectorTaskView> {
  const response = await fetch(`/api/vectorize/tasks/${id}`, { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || '任务读取失败')
  return data
}
export async function waitVectorTask(initial: VectorTaskView, signal?: AbortSignal): Promise<VectorTaskView> {
  let task = initial
  const deadline = Date.now() + 180_000
  while (['running', 'processing'].includes(task.status)) {
    if (Date.now() > deadline) throw new Error('后台仍在处理，请稍后从任务历史恢复；不要重新付费提交')
    if (signal?.aborted) throw new DOMException('已离开当前视图', 'AbortError')
    await new Promise(resolve => setTimeout(resolve, 800))
    task = await readVectorTask(task.id, signal)
  }
  // Async POST can return an already-ready cached task without its SVG body.
  // Recover locally before offering editable-path insertion; never resubmit upstream.
  if (task.status === 'ready' && task.editable && !task.svg) task = await readVectorTask(task.id, signal)
  return { ...task, context: initial.context || task.context, cached: initial.cached }
}
