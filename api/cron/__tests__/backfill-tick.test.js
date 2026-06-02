import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../lib/imessage-bridge.js', () => ({ sendImessage: vi.fn() }))
vi.mock('../../../lib/imessage-provider.js', () => ({ sendMessage: vi.fn() }))
vi.mock('../../../lib/opt-outs.js', () => ({ isSuppressed: vi.fn() }))
vi.mock('../../../lib/new-convo-throttle.js', () => ({ tryReserveNewConversation: vi.fn() }))
vi.mock('../../../lib/supabase.js', () => ({ getSupabase: vi.fn() }))

const { sendImessage } = await import('../../../lib/imessage-bridge.js')
const { sendMessage } = await import('../../../lib/imessage-provider.js')
const { isSuppressed } = await import('../../../lib/opt-outs.js')
const { tryReserveNewConversation } = await import('../../../lib/new-convo-throttle.js')
const { getSupabase } = await import('../../../lib/supabase.js')
const handler = (await import('../backfill-tick.js')).default

function makeReqRes(over = {}) {
  const req = { method: 'GET', headers: { 'x-vercel-cron': '1' }, query: {}, ...over }
  const res = {
    statusCode: 200, _json: null,
    status(c) { this.statusCode = c; return this },
    json(o) { this._json = o; return this }
  }
  return { req, res }
}

// Supabase stub: queue read resolves at .limit(); count read is awaited after
// .is() (thenable); update().eq() records the write and resolves.
function mockSupabase({ queue = [], remaining = 0 } = {}) {
  const updates = []
  function from() {
    return {
      select(_cols, opts) {
        const isCount = !!(opts && opts.head)
        const chain = {
          is() { return chain },
          order() { return chain },
          limit() { return Promise.resolve({ data: queue, error: null }) },
          then(onF, onR) {
            return Promise.resolve(isCount ? { count: remaining } : { data: queue, error: null }).then(onF, onR)
          }
        }
        return chain
      },
      update(obj) {
        return { eq(_c, val) { updates.push({ status: obj.status, id: val }); return Promise.resolve({ error: null }) } }
      }
    }
  }
  getSupabase.mockReturnValue({ from })
  return { updates }
}

const Q = (n) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, position: i, close_lead_id: `lead_${i}`, phone: `+1555000000${i}`, name: `Lead ${i}`
}))

beforeEach(() => {
  isSuppressed.mockResolvedValue(false)
  tryReserveNewConversation.mockResolvedValue({ ok: true, isNew: true })
  sendImessage.mockResolvedValue({ send: { message_handle: 'h123' } })
  sendMessage.mockResolvedValue({})
})
afterEach(() => { vi.clearAllMocks() })

describe('GET /api/cron/backfill-tick', () => {
  it('401s an unauthorized call', async () => {
    const { req, res } = makeReqRes({ headers: {} })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
    expect(sendImessage).not.toHaveBeenCalled()
  })

  it('sends the queued batch, marks them sent, and texts the owner a recap', async () => {
    const { updates } = mockSupabase({ queue: Q(3), remaining: 0 })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(sendImessage).toHaveBeenCalledTimes(3)
    expect(updates.filter(u => u.status === 'sent')).toHaveLength(3)
    expect(res._json).toMatchObject({ ok: true, sent: 3 })
    expect(sendMessage).toHaveBeenCalledTimes(1) // owner recap
    expect(sendMessage.mock.calls[0][0].message).toContain('texted 3 today')
  })

  it('skips an opted-out lead without sending', async () => {
    isSuppressed.mockImplementation(async ({ phone }) => phone === '+15550000001')
    const { updates } = mockSupabase({ queue: Q(3) })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).toHaveBeenCalledTimes(2)
    expect(updates.find(u => u.id === 2)).toMatchObject({ status: 'skipped_optout' })
    expect(res._json).toMatchObject({ sent: 2, skippedOptout: 1 })
  })

  it('stops early when the daily cap is exhausted', async () => {
    tryReserveNewConversation.mockResolvedValue({ ok: false, reason: 'daily-cap' })
    mockSupabase({ queue: Q(3) })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(sendImessage).not.toHaveBeenCalled()
    expect(res._json).toMatchObject({ sent: 0, capHit: true })
  })

  it('dry-run reports the batch but sends nothing', async () => {
    mockSupabase({ queue: Q(2), remaining: 2 })
    const { req, res } = makeReqRes({ query: { dry: '1' } })
    await handler(req, res)
    expect(sendImessage).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(res._json).toMatchObject({ dry: true, remaining: 2 })
    expect(res._json.wouldSend).toHaveLength(2)
  })

  it('reports completion when the queue is empty', async () => {
    mockSupabase({ queue: [], remaining: 0 })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json).toMatchObject({ ok: true, done: true })
    expect(sendImessage).not.toHaveBeenCalled()
    expect(sendMessage.mock.calls[0][0].message).toContain('complete')
  })
})
