// lib/__tests__/scheduled-messages.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const {
  scheduleMessage, findDueScheduledMessages, claimScheduledMessage,
  markScheduledSent, markScheduledFailed
} = await import('../scheduled-messages.js')

afterEach(() => { vi.clearAllMocks() })

describe('scheduleMessage', () => {
  it('inserts a normalized pending row', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({
      phone: '5550100123', closeLeadId: 'lead_1', message: 'hi',
      sendAt: new Date('2026-06-03T17:30:00Z'), dedupKey: 'inv_1', source: 'calendly-reminder'
    })
    expect(r.ok).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+15550100123', close_lead_id: 'lead_1', message: 'hi',
      send_at: '2026-06-03T17:30:00.000Z', status: 'pending',
      dedup_key: 'inv_1', source: 'calendly-reminder'
    }))
  })

  it('treats a duplicate-key error as a successful dedup', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint' } })
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({ phone: '+15550100123', message: 'hi', sendAt: new Date(), dedupKey: 'inv_1' })
    expect(r).toEqual({ ok: true, deduped: true })
  })

  it('no-op without a usable phone', async () => {
    const insert = vi.fn()
    getSupabase.mockReturnValue({ from: () => ({ insert }) })
    const r = await scheduleMessage({ phone: '', message: 'hi', sendAt: new Date() })
    expect(r.ok).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('findDueScheduledMessages', () => {
  it('selects pending rows at/under now', async () => {
    const rows = [{ id: 'm1', phone: '+1', message: 'hi', send_at: 'x', close_lead_id: null, media_url: null }]
    const lte = vi.fn().mockReturnValue({ limit: () => Promise.resolve({ data: rows, error: null }) })
    const eq = vi.fn().mockReturnValue({ lte })
    getSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) })
    const due = await findDueScheduledMessages({ now: new Date('2026-06-03T17:30:00Z') })
    expect(due).toEqual(rows)
    expect(eq).toHaveBeenCalledWith('status', 'pending')
  })
})

describe('claimScheduledMessage', () => {
  function mockClaim(rows) {
    getSupabase.mockReturnValue({
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: rows, error: null }) }) }) })
      })
    })
  }
  it('true when the row was claimed', async () => {
    mockClaim([{ id: 'm1' }])
    expect(await claimScheduledMessage('m1')).toBe(true)
  })
  it('false when already claimed (race)', async () => {
    mockClaim([])
    expect(await claimScheduledMessage('m1')).toBe(false)
  })
})

describe('markScheduledSent / markScheduledFailed', () => {
  it('marks sent', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    getSupabase.mockReturnValue({ from: () => ({ update }) })
    await markScheduledSent('m1', { handle: 'h1' })
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'sent', message_handle: 'h1' })
  })
  it('marks failed', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    getSupabase.mockReturnValue({ from: () => ({ update }) })
    await markScheduledFailed('m1', 'boom')
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'failed', error: 'boom' })
  })
})
