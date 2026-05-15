import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))

const { getSupabase } = await import('../../../../lib/supabase.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../upload.js')).default

function authedReq(body) {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'POST', headers: { cookie: token }, body, query: {} }
}
function makeRes() {
  return {
    statusCode: 200,
    _json: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this._json = o; return this },
    setHeader() {}
  }
}

function mockStorage({ uploadError = null, publicUrl = 'https://cdn.example.com/x.jpg' } = {}) {
  getSupabase.mockReturnValue({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: uploadError }),
        getPublicUrl: () => ({ data: { publicUrl } })
      })
    }
  })
}

beforeEach(() => {
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
})

afterEach(() => { vi.clearAllMocks() })

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('POST /api/sendblue/console/upload', () => {
  it('returns 401 unauthed', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, body: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when dataBase64 missing', async () => {
    const res = makeRes()
    await handler(authedReq({ contentType: 'image/png' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when contentType missing', async () => {
    const res = makeRes()
    await handler(authedReq({ dataBase64: PNG_BASE64 }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rejects unsupported contentType', async () => {
    const res = makeRes()
    await handler(authedReq({ dataBase64: PNG_BASE64, contentType: 'application/zip' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('uploads and returns the public URL', async () => {
    mockStorage({ publicUrl: 'https://cdn.example.com/xyz.png' })
    const res = makeRes()
    await handler(authedReq({
      filename: 'test.png',
      contentType: 'image/png',
      dataBase64: PNG_BASE64
    }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.ok).toBe(true)
    expect(res._json.url).toBe('https://cdn.example.com/xyz.png')
    expect(res._json.bytes).toBeGreaterThan(0)
    expect(res._json.contentType).toBe('image/png')
  })

  it('returns 500 when storage upload fails', async () => {
    mockStorage({ uploadError: { message: 'storage down' } })
    const res = makeRes()
    await handler(authedReq({
      contentType: 'image/png',
      dataBase64: PNG_BASE64
    }), res)
    expect(res.statusCode).toBe(500)
  })
})
