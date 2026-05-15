import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))

const { getSupabase } = await import('../../../../lib/supabase.js')
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

// Two-table mock: messages table (chain: select.order.limit) and
// read_state table (chain: select.in).
function mockTables({ messages = [], readState = [], readError = null, messagesError = null }) {
  getSupabase.mockReturnValue({
    from: (table) => {
      if (table === 'imessage_console_messages') {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: messages, error: messagesError })
            })
          })
        }
      }
      if (table === 'imessage_console_read_state') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: readState, error: readError })
          })
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }
  })
}

beforeEach(() => {
  process.env.REPLY_CONSOLE_SESSION_SECRET = 'this-is-a-long-enough-secret-yes'
})

afterEach(() => { vi.clearAllMocks() })

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

  it('returns 500 when supabase fails', async () => {
    mockTables({ messagesError: { message: 'pg down' } })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(500)
  })

  it('groups messages by lead and sorts by most recent', async () => {
    mockTables({
      messages: [
        // Newest first (matches our query order)
        { lead_id: 'lead_A', lead_name: 'A Person', direction: 'outbound', message: 'latest to A', phone: '+15550000001', created_at: '2026-05-12T10:00:00Z' },
        { lead_id: 'lead_B', lead_name: 'B Person', direction: 'inbound', message: 'hello B',     phone: '+15550000002', created_at: '2026-05-11T10:00:00Z' },
        { lead_id: 'lead_A', lead_name: 'A Person', direction: 'inbound', message: 'first to A',  phone: '+15550000001', created_at: '2026-05-10T10:00:00Z' }
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

  it('counts unread inbound messages newer than last_read_at', async () => {
    mockTables({
      messages: [
        { lead_id: 'lead_X', direction: 'outbound', message: 'reply', created_at: '2026-05-13T11:00:00Z' },
        { lead_id: 'lead_X', direction: 'inbound',  message: 'new2',  created_at: '2026-05-13T10:00:00Z' },
        { lead_id: 'lead_X', direction: 'inbound',  message: 'new1',  created_at: '2026-05-12T10:00:00Z' },
        { lead_id: 'lead_X', direction: 'inbound',  message: 'old',   created_at: '2026-05-10T10:00:00Z' }
      ],
      readState: [{ lead_id: 'lead_X', last_read_at: '2026-05-11T00:00:00Z' }]
    })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(200)
    const t = res._json.threads[0]
    expect(t.leadId).toBe('lead_X')
    expect(t.unreadCount).toBe(2)
    expect(t.lastReadAt).toBe('2026-05-11T00:00:00Z')
  })

  it('treats threads with no read state as all-unread inbound', async () => {
    mockTables({
      messages: [
        { lead_id: 'lead_Y', direction: 'outbound', message: 'r', created_at: '2026-05-11T10:00:00Z' },
        { lead_id: 'lead_Y', direction: 'inbound',  message: 'h', created_at: '2026-05-10T10:00:00Z' }
      ],
      readState: []
    })
    const res = makeRes()
    await handler(authedReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.threads[0].unreadCount).toBe(1)
  })
})
