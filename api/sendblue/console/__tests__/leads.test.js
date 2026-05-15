import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../leads.js')).default

function authedReq(query = {}) {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'GET', headers: { cookie: token }, body: null, query }
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

beforeEach(() => {
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
  process.env.CLOSE_API_KEY = 'api_test'
})

afterEach(() => { vi.restoreAllMocks() })

describe('GET /api/sendblue/console/leads', () => {
  it('returns 401 unauthed', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {}, query: { q: 'x' } }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns empty list when q missing', async () => {
    const res = makeRes()
    await handler(authedReq({}), res)
    expect(res.statusCode).toBe(200)
    expect(res._json).toEqual({ leads: [], count: 0 })
  })

  it('maps Close results to compact shape', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: 'lead_1',
          display_name: 'Jane Doe',
          status_label: 'Qualified',
          contacts: [{ id: 'cont_1', phones: [{ phone: '+15551110000' }] }]
        }]
      })
    })
    const res = makeRes()
    await handler(authedReq({ q: 'jane' }), res)
    expect(fetchSpy.mock.calls[0][0]).toContain('query=jane')
    expect(res.statusCode).toBe(200)
    expect(res._json.leads).toEqual([{
      leadId: 'lead_1',
      leadName: 'Jane Doe',
      statusLabel: 'Qualified',
      phone: '+15551110000',
      contactId: 'cont_1'
    }])
  })

  it('returns 502 when Close fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'down'
    })
    const res = makeRes()
    await handler(authedReq({ q: 'x' }), res)
    expect(res.statusCode).toBe(502)
  })
})
