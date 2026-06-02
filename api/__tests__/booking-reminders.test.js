import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({ getSupabase: vi.fn() }))
vi.mock('../../lib/close.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../../lib/reminders.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, findDueReminders: vi.fn(), claimReminder: vi.fn() }
})

const { getSupabase } = await import('../../lib/supabase.js')
const close = await import('../../lib/close.js')
const reminders = await import('../../lib/reminders.js')
const handler = (await import('../cron/booking-reminders.js')).default

function makeReqRes(over = {}) {
  const req = { method: 'POST', headers: { authorization: 'Bearer test-cron' }, ...over }
  const res = { statusCode: 200, _json: null, status(c) { this.statusCode = c; return this }, json(o) { this._json = o; return this } }
  return { req, res }
}

function booking() {
  return { id: 'b1', lead_id: 'sb1', close_lead_id: 'lead_1', scheduled_at: '2026-06-03T18:00:00Z',
    raw: { payload: { name: 'Jane Doe', email: 'jane@example.com', timezone: 'America/New_York',
      reschedule_url: 'https://calendly.com/r/AAA', cancel_url: 'https://calendly.com/c/BBB',
      scheduled_event: { start_time: '2026-06-03T18:00:00Z' } } } }
}

function mockSupabaseErrors() {
  const calls = { inserts: {} }
  getSupabase.mockReturnValue({ from: (t) => ({ insert(row) { calls.inserts[t] = (calls.inserts[t] || []).concat([row]); return Promise.resolve({ error: null }) } }) })
  return calls
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-cron'
  process.env.CLOSE_REMINDER_FROM = 'hello@startlushfulaesthetics.com'
  reminders.claimReminder.mockResolvedValue(true)
})
afterEach(() => vi.clearAllMocks())

describe('GET-cron /api/cron/booking-reminders', () => {
  it('401 on bad cron auth', async () => {
    const { req, res } = makeReqRes({ headers: {} })
    await handler(req, res)
    expect(res.statusCode).toBe(401)
  })
  it('200 nothing due', async () => {
    reminders.findDueReminders.mockResolvedValue([])
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res._json.sent).toBe(0)
  })
  it('claims + sends a due reminder', async () => {
    reminders.findDueReminders.mockResolvedValue([booking()])
    close.sendEmail.mockResolvedValue({ id: 'acti_1' })
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(reminders.claimReminder).toHaveBeenCalledWith('b1')
    expect(close.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead_1', to: 'jane@example.com', sender: 'hello@startlushfulaesthetics.com'
    }))
    expect(res._json.sent).toBe(1)
  })
  it('skips when claim is lost (race)', async () => {
    reminders.findDueReminders.mockResolvedValue([booking()])
    reminders.claimReminder.mockResolvedValue(false)
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(close.sendEmail).not.toHaveBeenCalled()
  })
  it('logs to lead_sync_errors when send fails', async () => {
    const calls = mockSupabaseErrors()
    reminders.findDueReminders.mockResolvedValue([booking()])
    close.sendEmail.mockRejectedValue(new Error('smtp boom'))
    const { req, res } = makeReqRes()
    await handler(req, res)
    expect(res._json.failed).toBe(1)
    expect(calls.inserts.lead_sync_errors[0]).toMatchObject({ service: 'calendly-reminder' })
  })
})
