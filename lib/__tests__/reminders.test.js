import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({ getSupabase: vi.fn() }))
const { getSupabase } = await import('../supabase.js')
const { findDueReminders, claimReminder, buildReminderEmail } = await import('../reminders.js')

afterEach(() => vi.clearAllMocks())

describe('findDueReminders', () => {
  it('queries the 30-minute window, unreminded, future, ordered', async () => {
    const calls = {}
    const chain = {
      select(c) { calls.select = c; return this },
      is(col, val) { calls.is = [col, val]; return this },
      gt(col) { calls.gt = col; return this },
      lte(col) { calls.lte = col; return this },
      order(col, o) { calls.order = [col, o]; return this },
      limit() { return Promise.resolve({ data: [{ id: 'b1' }], error: null }) }
    }
    getSupabase.mockReturnValue({ from: () => chain })
    const out = await findDueReminders({ now: new Date('2026-06-03T17:30:00Z'), limit: 50 })
    expect(out).toEqual([{ id: 'b1' }])
    expect(calls.is).toEqual(['reminder_sent_at', null])
    expect(calls.gt).toBe('scheduled_at')
    expect(calls.lte).toBe('scheduled_at')
    expect(calls.select).toContain('raw')
  })
  it('throws on error', async () => {
    const chain = { select() { return this }, is() { return this }, gt() { return this }, lte() { return this }, order() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'boom' } }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    await expect(findDueReminders({ now: new Date() })).rejects.toThrow('findDueReminders failed: boom')
  })
})

describe('claimReminder', () => {
  it('returns true when a row is claimed', async () => {
    const chain = { update() { return this }, eq() { return this }, is() { return this }, select() { return Promise.resolve({ data: [{ id: 'b1' }], error: null }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    expect(await claimReminder('b1')).toBe(true)
  })
  it('returns false when no row is claimed (lost race)', async () => {
    const chain = { update() { return this }, eq() { return this }, is() { return this }, select() { return Promise.resolve({ data: [], error: null }) } }
    getSupabase.mockReturnValue({ from: () => chain })
    expect(await claimReminder('b1')).toBe(false)
  })
})

function booking(extra = {}) {
  return {
    id: 'b1', close_lead_id: 'lead_1',
    raw: { payload: {
      name: 'Jane Doe', email: 'jane@example.com', timezone: 'America/New_York',
      reschedule_url: 'https://calendly.com/reschedulings/AAA',
      cancel_url: 'https://calendly.com/cancellations/BBB',
      scheduled_event: { start_time: '2026-06-03T18:00:00Z' },
      ...extra
    } }
  }
}

describe('buildReminderEmail', () => {
  it('renders subject, recipient, first name, and both links', () => {
    const e = buildReminderEmail(booking())
    expect(e.to).toBe('jane@example.com')
    expect(e.subject).toContain('Reminder')
    expect(e.bodyText).toContain('Hi Jane,')
    expect(e.bodyText).toContain('Reschedule: https://calendly.com/reschedulings/AAA')
    expect(e.bodyText).toContain('Cancel: https://calendly.com/cancellations/BBB')
    expect(e.bodyHtml).toContain('href="https://calendly.com/reschedulings/AAA"')
    expect(e.bodyHtml).toContain('href="https://calendly.com/cancellations/BBB"')
  })
  it('omits a link line when its URL is absent', () => {
    const e = buildReminderEmail(booking({ cancel_url: undefined }))
    expect(e.bodyText).toContain('Reschedule:')
    expect(e.bodyText).not.toContain('Cancel:')
  })
  it('is robust to a missing name', () => {
    const e = buildReminderEmail(booking({ name: undefined }))
    expect(e.bodyText).toContain('Hi there,')
  })
})
