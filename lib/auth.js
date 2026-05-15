import crypto from 'node:crypto'

const COOKIE_NAME = 'lush_console'
const MAX_AGE_SEC = 60 * 60 * 24 * 30 // 30 days

function getSecret() {
  const s = process.env.REPLY_CONSOLE_SESSION_SECRET
  if (!s || s.length < 16) {
    throw new Error('REPLY_CONSOLE_SESSION_SECRET not set (or too short)')
  }
  return s
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj))
  const sig = b64url(
    crypto.createHmac('sha256', getSecret()).update(payload).digest()
  )
  return `${payload}.${sig}`
}

function verify(token) {
  if (!token || typeof token !== 'string') return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = b64url(
    crypto.createHmac('sha256', getSecret()).update(payload).digest()
  )
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(b64urlDecode(payload).toString())
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null
    return data
  } catch {
    return null
  }
}

export function checkPassword(submitted) {
  const expected = process.env.REPLY_CONSOLE_PASSWORD
  if (!expected) throw new Error('REPLY_CONSOLE_PASSWORD not set')
  if (typeof submitted !== 'string') return false
  const a = Buffer.from(submitted)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function makeSessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const token = sign({ v: 1, iat: now, exp: now + MAX_AGE_SEC })
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_SEC}`
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of String(header).split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (!k) continue
    out[k] = rest.join('=')
  }
  return out
}

// Returns the session object on success, or null on failure.
// Routes that need auth should call this and 401 when null.
export function getSession(req) {
  const cookies = parseCookies(req.headers?.cookie)
  return verify(cookies[COOKIE_NAME])
}

export function requireAuth(req, res) {
  const session = getSession(req)
  if (!session) {
    res.status(401).json({ error: 'unauthorized' })
    return null
  }
  return session
}
