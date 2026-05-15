import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkPassword,
  makeSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth
} from '../auth.js'

beforeEach(() => {
  process.env.REPLY_CONSOLE_PASSWORD = 'correct-horse-battery-staple'
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
})

function makeRes() {
  return {
    statusCode: 200,
    _json: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this._json = o; return this }
  }
}

function reqWithCookie(cookieHeader) {
  return { headers: { cookie: cookieHeader } }
}

describe('checkPassword', () => {
  it('returns true on exact match', () => {
    expect(checkPassword('correct-horse-battery-staple')).toBe(true)
  })
  it('returns false on mismatch', () => {
    expect(checkPassword('wrong')).toBe(false)
  })
  it('returns false on non-string', () => {
    expect(checkPassword(undefined)).toBe(false)
    expect(checkPassword(null)).toBe(false)
    expect(checkPassword({})).toBe(false)
  })
  it('throws when env var missing', () => {
    delete process.env.REPLY_CONSOLE_PASSWORD
    expect(() => checkPassword('anything')).toThrow(/REPLY_CONSOLE_PASSWORD/)
  })
})

describe('session cookies', () => {
  it('makeSessionCookie + getSession roundtrip succeeds', () => {
    const setCookie = makeSessionCookie()
    expect(setCookie).toMatch(/^lush_console=/)
    expect(setCookie).toMatch(/HttpOnly/)
    expect(setCookie).toMatch(/Secure/)
    expect(setCookie).toMatch(/SameSite=Strict/)
    // Strip "lush_console=" prefix and trailing attrs to get the token, then
    // simulate the browser sending it back as just `lush_console=<token>`.
    const token = setCookie.split(';')[0]
    const session = getSession(reqWithCookie(token))
    expect(session).toBeTruthy()
    expect(session.v).toBe(1)
    expect(typeof session.iat).toBe('number')
    expect(typeof session.exp).toBe('number')
  })

  it('getSession returns null when no cookie present', () => {
    expect(getSession({ headers: {} })).toBeNull()
  })

  it('getSession returns null when cookie tampered', () => {
    const setCookie = makeSessionCookie()
    const token = setCookie.split(';')[0]
    // Corrupt the signature
    const corrupted = token.slice(0, -3) + 'AAA'
    expect(getSession(reqWithCookie(corrupted))).toBeNull()
  })

  it('getSession returns null when cookie signed with a different secret', () => {
    const setCookie = makeSessionCookie()
    const token = setCookie.split(';')[0]
    process.env.REPLY_CONSOLE_SESSION_SECRET = 'a-completely-different-secret-yo'
    expect(getSession(reqWithCookie(token))).toBeNull()
  })

  it('clearSessionCookie produces a Max-Age=0 cookie', () => {
    expect(clearSessionCookie()).toMatch(/Max-Age=0/)
  })
})

describe('requireAuth', () => {
  it('returns the session when valid', () => {
    const setCookie = makeSessionCookie()
    const token = setCookie.split(';')[0]
    const res = makeRes()
    const session = requireAuth(reqWithCookie(token), res)
    expect(session).toBeTruthy()
    expect(res.statusCode).toBe(200)
  })

  it('returns null and writes 401 when no session', () => {
    const res = makeRes()
    const session = requireAuth({ headers: {} }, res)
    expect(session).toBeNull()
    expect(res.statusCode).toBe(401)
    expect(res._json).toEqual({ error: 'unauthorized' })
  })
})
