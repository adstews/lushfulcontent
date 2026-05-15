const BASE = 'https://api.sendblue.co/api'

function authHeaders() {
  const keyId = process.env.SENDBLUE_API_KEY
  const secret = process.env.SENDBLUE_API_SECRET
  if (!keyId || !secret) {
    throw new Error('SendBlue env vars missing: SENDBLUE_API_KEY or SENDBLUE_API_SECRET')
  }
  return {
    'sb-api-key-id': keyId,
    'sb-api-secret-key': secret,
    'Content-Type': 'application/json'
  }
}

// Normalize a phone string to E.164-ish form for SendBlue + matching.
// Strips everything except digits and a leading +; if no +, assumes US (+1) when length is 10.
export function normalizePhone(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (hasPlus) return '+' + digits
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  return '+' + digits
}

export async function sendMessage({ phone, message, sendStyle, mediaUrl, statusCallback }) {
  const number = normalizePhone(phone)
  if (!number) throw new Error('SendBlue sendMessage: phone is required')
  if (!message || typeof message !== 'string') {
    throw new Error('SendBlue sendMessage: message is required')
  }
  const body = { number, content: message }
  if (sendStyle) body.send_style = sendStyle
  if (mediaUrl) body.media_url = mediaUrl
  if (statusCallback) body.status_callback = statusCallback

  const res = await fetch(`${BASE}/send-message`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SendBlue send failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Lightweight account check used by the health endpoint.
// SendBlue exposes GET /accounts which returns the workspace details.
export async function getAccount() {
  const res = await fetch(`${BASE}/accounts`, {
    method: 'GET',
    headers: authHeaders()
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SendBlue account check failed: ${res.status} ${text}`)
  }
  return res.json()
}
