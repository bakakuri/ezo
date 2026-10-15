// ფოტოს შეკუმშვა ატვირთვამდე — მობილური ინტერნეტი დაზოგოს

export const MAX_VIDEO_MB = 50

export async function compressImage(file, maxDim = 1600, quality = 0.84) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', quality))
  if (!blob || blob.size > file.size) return file
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.webp', { type: 'image/webp' })
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* ქვემოთ */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function mediaDims(file) {
  if (file.type.startsWith('video')) {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    await new Promise((r) => { v.onloadedmetadata = r; v.onerror = r })
    URL.revokeObjectURL(url)
    return { w: v.videoWidth || 1080, h: v.videoHeight || 1920 }
  }
  const b = await loadBitmap(file)
  return { w: b.width, h: b.height }
}

export function checkFile(file) {
  if (file.type.startsWith('video') && file.size > MAX_VIDEO_MB * 1024 * 1024) {
    return `ვიდეო ${MAX_VIDEO_MB} მბ-ზე მეტია`
  }
  if (!file.type.startsWith('video') && !file.type.startsWith('image')) return 'მხოლოდ ფოტო ან ვიდეო'
  return null
}
