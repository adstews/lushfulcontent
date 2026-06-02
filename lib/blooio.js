import crypto from 'node:crypto'
import { normalizePhone } from './phone.js'

const BASE = 'https://backend.blooio.com/v2/api'

function authHeaders() {
  const key = process.env.BLOOIO_API_KEY
  if (!key) throw new Error('Blooio env var missing: BLOOIO_API_KEY')
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// chatId = recipient phone in E.164; Blooio auto-creates the chat.
export async function sendMessage({ phone, message, mediaUrl, fromNumber }) {
  const number = normalizePhone(phone)
  if (!number) throw new Error('Blooio sendMessage: phone is required')
  const hasMessage = typeof message === 'string' && message.length > 0
  const hasMedia = typeof mediaUrl === 'string' && mediaUrl.length > 0
  if (!hasMessage && !hasMedia) throw new Error('Blooio sendMessage: message or mediaUrl is required')

  const body = { text: hasMessage ? message : '', 'Idempotency-Key': crypto.randomUUID() }
  if (hasMedia) body.attachments = [mediaUrl]
  const from = fromNumber || process.env.BLOOIO_FROM_NUMBER
  if (from) body.from_number = from

  const res = await fetch(`${BASE}/chats/${number}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Blooio send failed: ${res.status} ${text}`)
  }
  const json = await res.json()
  return { ...json, message_handle: json.message_id ?? json.id ?? null }
}

// Health check: list webhooks (auth-scoped, read-only) to verify the key.
export async function checkAuth() {
  const res = await fetch(`${BASE}/webhooks`, { method: 'GET', headers: authHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Blooio auth check failed: ${res.status} ${text}`)
  }
  return res.json()
}
