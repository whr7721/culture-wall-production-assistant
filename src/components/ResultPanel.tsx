import type { GenerationResult } from '../types'

interface Props {
  result: GenerationResult | null
  isLoading: boolean
  error: string
  onUseAsReference: (result: GenerationResult) => void
}

export function ResultPanel({ result, isLoading, error, onUseAsReference }: Props) {
  return (
    <section className="result-panel">
      <div className="result-topline">
        <div>
          <span className="eyebrow">RESULT</span>
          <h2>提案预览</h2>
        </div>
        <span className={`status ${isLoading ? 'working' : result ? 'ready' : ''}`}>
          {isLoading ? '生成中' : result ? '已完成' : '等待生成'}
        </span>
      </div>

      <div className={`result-canvas ${isLoading ? 'loading' : ''}`}>
        {isLoading ? (
          <div className="loading-copy">
            <div className="spinner" />
            <strong>AI 正在整理空间、材质和视觉层级</strong>
            <span>参考图越多，生成时间可能越长</span>
          </div>
        ) : result ? (
          <img src={result.imageUrl} alt="生成的文化墙效果图" />
        ) : (
          <div className="empty-copy">
            <div className="wall-sketch" aria-hidden="true">
              <i /><i /><i />
            </div>
            <strong>你的文化墙提案将在这里出现</strong>
            <span>先描述需求，再上传墙面照片或品牌素材</span>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {result && !isLoading && (
        <div className="result-actions">
          <a className="secondary-button" href={result.imageUrl} download>
            下载图片
          </a>
          <button className="secondary-button" type="button" onClick={() => onUseAsReference(result)}>
            作为参考继续修改
          </button>
        </div>
      )}

      <p className="result-note">
        当前输出用于方案沟通与获客展示；准确文字、尺寸拆分和生产文件仍需后续设计确认。
      </p>
    </section>
  )
}
