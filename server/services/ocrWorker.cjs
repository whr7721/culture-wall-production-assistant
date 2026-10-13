const { parentPort, workerData } = require('node:worker_threads')

async function run() {
  const { RapidOCR } = await import('rapidocr-node')
  const ocr = await RapidOCR.create({ executionProviders: ['cpu'], logLevel: 'error' })
  try {
    const result = await ocr.recognize(Buffer.from(workerData.input))
    if (result.type !== 'ocr') return []
    return result.lines.map((line) => ({
      text: line.text,
      score: line.confidence,
      polygon: line.box.map((point) => [point.x, point.y]),
    }))
  } finally { await ocr.close() }
}

run().then((lines) => parentPort.postMessage({ lines })).catch((error) => parentPort.postMessage({ error: error.message || 'OCR识别失败' }))
