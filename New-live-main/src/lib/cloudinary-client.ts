// ---------------------------------------------------------------------------
// Client-side image upload: compress, then upload directly to Cloudinary
// ---------------------------------------------------------------------------
// Two things fix the old 413 "Payload Too Large" error:
// 1. The file bytes go straight from the browser to Cloudinary — they never
//    pass through our own Vercel serverless function, so Vercel's request
//    body size limit doesn't apply at all.
// 2. As a courtesy (faster uploads, less Cloudinary storage), we also
//    downscale/recompress the image client-side before sending it, so it's
//    reliably well under 4MB even on an uncompressed 12MB phone photo.
// ---------------------------------------------------------------------------

import { authFetch } from '@/lib/auth-client'

export type UploadKind = 'avatar' | 'kyc_selfie' | 'kyc_nic_front' | 'kyc_nic_back' | 'status'

const MAX_DIMENSION = 1600 // px, longest side
const JPEG_QUALITY = 0.82
const TARGET_MAX_BYTES = 4 * 1024 * 1024 // 4MB safety margin

/** Resizes/recompresses an image file client-side via canvas. Falls back to the original file if compression fails for any reason (e.g. unsupported format). */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)

    let quality = JPEG_QUALITY
    let blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    // Step quality down further if still too large (rare, but a safety net)
    while (blob && blob.size > TARGET_MAX_BYTES && quality > 0.4) {
      quality -= 0.15
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    }
    if (!blob) return file

    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export interface UploadProgress {
  stage: 'compressing' | 'uploading'
}

/**
 * Compresses (if needed) and uploads an image directly to Cloudinary.
 * Returns the resulting secure_url.
 */
export async function uploadImageDirect(
  file: File,
  kind: UploadKind,
  onProgress?: (p: UploadProgress) => void,
): Promise<string> {
  onProgress?.({ stage: 'compressing' })
  const prepared = await compressImage(file)

  if (prepared.size > TARGET_MAX_BYTES) {
    throw new Error('Image is too large even after compression — try a smaller photo.')
  }

  onProgress?.({ stage: 'uploading' })

  const signRes = await authFetch('/api/uploads/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
  if (!signRes.ok) {
    const err = await signRes.json().catch(() => ({}))
    throw new Error(err.error || 'Could not start upload')
  }
  const { cloudName, apiKey, timestamp, folder, signature } = await signRes.json()

  const form = new FormData()
  form.append('file', prepared)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('folder', folder)
  form.append('signature', signature)

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  })
  if (!uploadRes.ok) {
    throw new Error('Upload to Cloudinary failed')
  }
  const result = await uploadRes.json()
  if (!result.secure_url) {
    throw new Error(result.error?.message || 'Upload failed')
  }
  return result.secure_url as string
}
