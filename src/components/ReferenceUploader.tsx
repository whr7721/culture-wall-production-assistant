import { useEffect, useRef, useState } from 'react'

interface Props {
  files: File[]
  onChange: (files: File[]) => void
}

export function ReferenceUploader({ files, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<string[]>([])
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) && file.size <= 12 * 1024 * 1024)
    setNotice(images.length !== incoming.length ? '仅接受单张不超过 12 MB 的 PNG、JPEG 或 WebP 图片。' : '')
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
        onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }}
      />
      {notice && <small className="validation-copy">{notice}</small>}
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file, index) => (
            <div className="file-pill" key={`${file.name}-${file.lastModified}-${index}`}>
              <div className="file-thumb-wrap">{previews[index] && <img className="file-thumb" src={previews[index]} alt={`${file.name} 缩略图`} />}</div>
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
