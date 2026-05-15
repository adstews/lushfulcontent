import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../lib/close.js', () => ({
  getLead: vi.fn()
}))
vi.mock('../../../../lib/supabase.js', () => ({
  getSupabase: vi.fn()
}))

const { getLead } = await import('../../../../lib/close.js')
const { getSupabase } = await import('../../../../lib/supabase.js')
const { makeSessionCookie } = await import('../../../../lib/auth.js')
const handler = (await import('../thread.js')).default

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

function mockTables({ messages = [], reactions = [], messagesError = null, reactionsError = null }) {
  getSupabase.mockReturnValue({
    from: (table) => {
      if (table === 'imessage_console_messages') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: messages, error: messagesError })
              })
            })
          })
        }
      }
      if (table === 'imessage_console_reactions') {
        return {
          select: () => ({
            in: () => ({
              order: () => Promise.resolve({ data: reactions, error: reactionsError })
            })
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

describe('GET /api/sendblue/console/thread', () => {
  it('returns 401 when not authed', async () => {
    const res = makeRes()
    await handler({ method: 'GET', headers: {}, query: {} }, res)
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when leadId missing', async () => {
    const res = makeRes()
    await handler(authedReq({}), res)
    expect(res.statusCode).toBe(400)
  })

  it('returns messages sorted asc with reactions joined by handle', async () => {
    mockTables({
      messages: [
        { id: 'm1', close_activity_id: 'a1', direction: 'outbound', message: 'hi', phone: '+15551111111', media_url: null, sendblue_handle: 'sb_a', created_at: '2026-05-10T10:00:00Z' },
        { id: 'm2', close_activity_id: 'a2', direction: 'inbound',  message: 'yo', phone: '+15551111111', media_url: null, sendblue_handle: 'sb_b', created_at: '2026-05-11T10:00:00Z' }
      ],
      reactions: [
        { message_handle: 'sb_a', direction: 'inbound', reaction: 'love', removed: false, created_at: '2026-05-11T11:00:00Z' }
      ]
    })
    getLead.mockResolvedValue({
      id: 'lead_1',
      display_name: 'Jane Doe',
      status_label: 'Qualified',
      contacts: [{ id: 'cont_1', phones: [{ phone: '+15552222222' }] }]
    })

    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.leadId).toBe('lead_1')
    expect(res._json.leadName).toBe('Jane Doe')
    expect(res._json.statusLabel).toBe('Qualified')
    expect(res._json.replyPhone).toBe('+15551111111')
    expect(res._json.messages.map(m => m.id)).toEqual(['m1', 'm2'])
    // sb_a (outbound) got an inbound love reaction
    expect(res._json.messages[0].reactions).toEqual([
      { direction: 'inbound', reaction: 'love', at: '2026-05-11T11:00:00Z' }
    ])
    // sb_b has no reactions
    expect(res._json.messages[1].reactions).toEqual([])
  })

  it('falls back to lead contact phone when no messages exist', async () => {
    mockTables({ messages: [], reactions: [] })
    getLead.mockResolvedValue({
      id: 'lead_1',
      display_name: 'Jane',
      contacts: [{ id: 'cont_1', phones: [{ phone: '+15553333333' }] }]
    })
    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.messages).toEqual([])
    expect(res._json.replyPhone).toBe('+15553333333')
  })

  it('treats a removed reaction as no reaction (latest event wins)', async () => {
    mockTables({
      messages: [
        { id: 'm1', sendblue_handle: 'sb_x', direction: 'outbound', message: 'hi', phone: '+1', media_url: null, created_at: '2026-05-10T10:00:00Z' }
      ],
      reactions: [
        { message_handle: 'sb_x', direction: 'inbound', reaction: 'love', removed: false, created_at: '2026-05-11T10:00:00Z' },
        { message_handle: 'sb_x', direction: 'inbound', reaction: 'love', removed: true,  created_at: '2026-05-11T11:00:00Z' }
      ]
    })
    getLead.mockResolvedValue({ id: 'lead_1', display_name: 'X', contacts: [] })
    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res._json.messages[0].reactions).toEqual([])
  })

  it('returns 502 when Supabase messages query errors', async () => {
    mockTables({ messagesError: { message: 'pg down' } })
    getLead.mockResolvedValue({ id: 'lead_1', display_name: 'X', contacts: [] })
    const res = makeRes()
    await handler(authedReq({ leadId: 'lead_1' }), res)
    expect(res.statusCode).toBe(502)
  })
})
