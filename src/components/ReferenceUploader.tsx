import { useRef } from 'react'

interface Props {
  files: File[]
  onChange: (files: File[]) => void
}

export function ReferenceUploader({ files, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter((file) => file.type.startsWith('image/'))
    onChange([...files, ...images].slice(0, 3))
  }

  return (
    <div className="field-group">
      <div className="field-heading">
        <div>
          <span className="step-number">02</span>
          <label>上传参考素材</label>
        </div>
        <span>{files.length}/3</span>
      </div>
      <button
        className="drop-zone"
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <span className="upload-icon">＋</span>
        <strong>墙面照片、Logo 或风格参考</strong>
        <small>点击选择或拖入图片，单张不超过 12 MB</small>
      </button>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(event) => addFiles(Array.from(event.target.files ?? []))}
      />
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, index) => (
            <div className="file-pill" key={`${file.name}-${file.lastModified}`}>
              <span>{index === 0 ? '墙面/主参考' : `参考 ${index + 1}`}</span>
              <strong title={file.name}>{file.name}</strong>
              <button
                type="button"
                aria-label={`移除 ${file.name}`}
                onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
