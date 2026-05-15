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
  const hasMessage = typeof message === 'string' && message.length > 0
  const hasMedia = typeof mediaUrl === 'string' && mediaUrl.length > 0
  if (!hasMessage && !hasMedia) {
    throw new Error('SendBlue sendMessage: message or mediaUrl is required')
  }
  const body = { number, content: hasMessage ? message : '' }
  // SendBlue requires `from_number` when the workspace has multiple lines or
  // hasn't set a default. We always include it when SENDBLUE_FROM_NUMBER is
  // set so this never bites us silently.
  if (process.env.SENDBLUE_FROM_NUMBER) body.from_number = process.env.SENDBLUE_FROM_NUMBER
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

// Send a tap-back reaction to a prior iMessage. `messageHandle` is the
// SendBlue handle for the message we're reacting to (their inbound message
// to react TO it, or our outbound message to add/replace our own react).
// `reaction` is one of: love, like, dislike, laugh, emphasize, question.
// To remove an existing reaction, prefix with "-" (e.g. "-love").
export async function sendReaction({ phone, messageHandle, reaction }) {
  const number = normalizePhone(phone)
  if (!number) throw new Error('SendBlue sendReaction: phone is required')
  if (!messageHandle) throw new Error('SendBlue sendReaction: messageHandle is required')
  if (!reaction) throw new Error('SendBlue sendReaction: reaction is required')

  const body = {
    number,
    reaction,
    message_handle: messageHandle
  }
  if (process.env.SENDBLUE_FROM_NUMBER) body.from_number = process.env.SENDBLUE_FROM_NUMBER

  const res = await fetch(`${BASE}/send-reaction`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SendBlue reaction failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Lightweight authenticated GET used by the health endpoint to verify
// that the API key + secret are valid. /api/lines returns the workspace's
// assigned SendBlue phone numbers — it's read-only, account-scoped, and a
// real prerequisite for sending (no line = no iMessages).
export async function checkAuth() {
  const res = await fetch(`${BASE}/lines`, {
    method: 'GET',
    headers: authHeaders()
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SendBlue auth check failed: ${res.status} ${text}`)
  }
  return res.json()
}
