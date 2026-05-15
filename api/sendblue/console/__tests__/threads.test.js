import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/close.js', () => ({
  listCustomActivities: vi.fn()
}))

const { listCustomActivities } = await import('../../../../lib/close.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../threads.js')).default

function authedReq() {
  const token = makeSessionCookie().split(';')[0]
  return { method: 'GET', headers: { cookie: token }, body: null, query: {} }
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
  process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE = 'actitype_im'
  process.env.CLOSE_CF_IMESSAGE_TEXT = 'cf_text'
  process.env.CLOSE_CF_IMESSAGE_DIRECTION = 'cf_dir'
  process.env.CLOSE_CF_IMESSAGE_PHONE = 'cf_phone'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/sendblue/console/threads', () => {
  it('returns 405 on non-GET', async () => {
    const req = { ...authedReq(), method: 'POST' }
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })

  it('returns 401 when no session cookie', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {}, query: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 500 when CLOSE_CUSTOM_ACTIVITY_IMESSAGE missing', async () => {
    delete process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(500)
  })

  it('groups activities by lead and sorts by most recent', async () => {
    listCustomActivities.mockResolvedValue({
      data: [
        { id: 'a1', lead_id: 'lead_A', 'custom.cf_text': 'first to A', 'custom.cf_dir': 'inbound', 'custom.cf_phone': '+15550000001', date_created: '2026-05-10T10:00:00Z', lead_display_name: 'A Person' },
        { id: 'a2', lead_id: 'lead_A', 'custom.cf_text': 'latest to A', 'custom.cf_dir': 'outbound', 'custom.cf_phone': '+15550000001', date_created: '2026-05-12T10:00:00Z', lead_display_name: 'A Person' },
        { id: 'a3', lead_id: 'lead_B', 'custom.cf_text': 'hello B', 'custom.cf_dir': 'inbound', 'custom.cf_phone': '+15550000002', date_created: '2026-05-11T10:00:00Z', lead_display_name: 'B Person' }
      ]
    })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.count).toBe(2)
    expect(res._json.threads[0]).toMatchObject({
      leadId: 'lead_A',
      lastMessage: 'latest to A',
      lastDirection: 'outbound',
      leadName: 'A Person'
    })
    expect(res._json.threads[1].leadId).toBe('lead_B')
  })

  it('returns 502 when Close fails', async () => {
    listCustomActivities.mockRejectedValue(new Error('Close list custom activities failed: 500'))
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(502)
  })
})
