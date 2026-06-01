import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { isNewConversation, tryReserveNewConversation } = await import('../new-convo-throttle.js')
afterEach(() => { vi.clearAllMocks() })

describe('isNewConversation', () => {
  it('false when a contact row exists', async () => {
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [{ phone: '+1' }], error: null }) }) }) }) })
    expect(await isNewConversation('+15550100123')).toBe(false)
  })
  it('true when no row', async () => {
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) })
    expect(await isNewConversation('+15550100123')).toBe(true)
  })
})

describe('tryReserveNewConversation', () => {
  function mock({ existing = [], todayCount = 0, insertError = null }) {
    return {
      from: (t) => ({
        select: (cols, opts) => ({
          eq: () => ({ limit: () => Promise.resolve({ data: existing, error: null }) }),
          gte: () => Promise.resolve({ count: todayCount, error: null })
        }),
        insert: () => Promise.resolve({ error: insertError })
      })
    }
  }
  it('returns isNew:false when already contacted (no count against cap)', async () => {
    getSupabase.mockReturnValue(mock({ existing: [{ phone: '+1' }] }))
    expect(await tryReserveNewConversation('+15550100123', 14)).toEqual({ ok: true, isNew: false })
  })
  it('reserves when new and under cap', async () => {
    getSupabase.mockReturnValue(mock({ existing: [], todayCount: 5 }))
    const r = await tryReserveNewConversation('+15550100123', 14)
    expect(r).toEqual({ ok: true, isNew: true })
  })
  it('defers when new and at cap', async () => {
    getSupabase.mockReturnValue(mock({ existing: [], todayCount: 14 }))
    const r = await tryReserveNewConversation('+15550100123', 14)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('daily-cap')
  })
})
