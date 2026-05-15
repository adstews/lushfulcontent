import crypto from 'node:crypto'
import { requireAuth } from '../../../lib/auth.js'
import { getSupabase } from '../../../lib/supabase.js'

// Accepts a base64-encoded file and uploads it to the public
// `imessage-media` Supabase Storage bucket. Returns a public URL that
// SendBlue can fetch when we pass it as `media_url` on send.
//
// Body shape: { filename, contentType, dataBase64 }
// Vercel's serverless body limit caps us around 4.5MB of JSON; with
// base64 inflation that's ~3MB of actual file. Plenty for photos, tight
// for video — short clips OK, longer ones need a direct-to-storage flow.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
  if (!requireAuth(req, res)) return

  const { filename, contentType, dataBase64 } = req.body || {}
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    return res.status(400).json({ error: 'dataBase64 required' })
  }
  if (!contentType || typeof contentType !== 'string') {
    return res.status(400).json({ error: 'contentType required' })
  }

  const allowed = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime'
  ]
  if (!allowed.includes(contentType)) {
    return res.status(400).json({ error: `unsupported contentType: ${contentType}` })
  }

  let buf
  try {
    buf = Buffer.from(dataBase64, 'base64')
  } catch {
    return res.status(400).json({ error: 'invalid base64' })
  }
  if (buf.length === 0) return res.status(400).json({ error: 'empty file' })
  if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'file too large (10MB max)' })

  const ext = filename?.match(/\.[a-z0-9]+$/i)?.[0] || mimeToExt(contentType)
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`

  try {
    const sb = getSupabase()
    const { error: uploadErr } = await sb.storage
      .from('imessage-media')
      .upload(path, buf, { contentType, cacheControl: '31536000', upsert: false })
    if (uploadErr) throw new Error(uploadErr.message)

    const { data: pub } = sb.storage.from('imessage-media').getPublicUrl(path)
    return res.status(200).json({
      ok: true,
      url: pub?.publicUrl || null,
      path,
      bytes: buf.length,
      contentType
    })
  } catch (err) {
    console.error('console/upload failed', err)
    return res.status(500).json({ error: String(err?.message || err) })
  }
}

function mimeToExt(ct) {
  switch (ct) {
    case 'image/jpeg': return '.jpg'
    case 'image/png': return '.png'
    case 'image/gif': return '.gif'
    case 'image/webp': return '.webp'
    case 'image/heic': return '.heic'
    case 'video/mp4': return '.mp4'
    case 'video/quicktime': return '.mov'
    default: return ''
  }
}
