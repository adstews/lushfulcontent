import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { suppressPhone, isSuppressed } = await import('../opt-outs.js')

afterEach(() => { vi.clearAllMocks() })

describe('suppressPhone', () => {
  it('upserts the normalized phone', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })
    const r = await suppressPhone({ phone: '5550100123', leadId: 'lead_1', reason: 'stop-keyword' })
    expect(r.ok).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      { phone: '+15550100123', close_lead_id: 'lead_1', reason: 'stop-keyword' },
      { onConflict: 'phone' }
    )
  })

  it('is a no-op when phone cannot be normalized', async () => {
    const upsert = vi.fn()
    getSupabase.mockReturnValue({ from: () => ({ upsert }) })
    const r = await suppressPhone({ phone: '' })
    expect(r.ok).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('isSuppressed', () => {
  function mockResult(rows) {
    getSupabase.mockReturnValue({
      from: () => ({
        select: () => ({
          or: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
          eq: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) })
        })
      })
    })
  }

  it('true when a row matches', async () => {
    mockResult([{ phone: '+15550100123' }])
    expect(await isSuppressed({ phone: '+15550100123' })).toBe(true)
  })

  it('false when no row matches', async () => {
    mockResult([])
    expect(await isSuppressed({ phone: '+15550100123' })).toBe(false)
  })

  it('false (no query) when neither phone nor leadId given', async () => {
    const from = vi.fn()
    getSupabase.mockReturnValue({ from })
    expect(await isSuppressed({})).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('matches by leadId alone', async () => {
    mockResult([{ phone: '+1999' }])
    expect(await isSuppressed({ leadId: 'lead_1' })).toBe(true)
  })
})
