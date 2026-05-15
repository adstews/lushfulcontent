import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../supabase.js', () => ({
  getSupabase: vi.fn()
}))
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn()
  }
}))

const { getSupabase } = await import('../supabase.js')
const webpush = (await import('web-push')).default
const { recordSubscription, removeSubscription, listActiveSubscriptions, pushToAll, getPublicKey } = await import('../web-push.js')

function mockChain(handlers) {
  const chain = {
    upsert: () => chain,
    select: () => chain,
    single: () => Promise.resolve(handlers.single || { data: null, error: null }),
    delete: () => chain,
    update: () => chain,
    eq: () => Promise.resolve(handlers.eq || { data: null, error: null }),
    in: () => Promise.resolve(handlers.in || { data: [], error: null }),
    is: () => Promise.resolve(handlers.is || { data: [], error: null })
  }
  getSupabase.mockReturnValue({ from: () => chain })
  return chain
}

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = 'PUB'
  process.env.VAPID_PRIVATE_KEY = 'PRIV'
  process.env.VAPID_SUBJECT = 'mailto:x@y.com'
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('getPublicKey', () => {
  it('returns env var', () => {
    expect(getPublicKey()).toBe('PUB')
  })
})

describe('recordSubscription', () => {
  it('upserts and returns data', async () => {
    mockChain({ single: { data: { id: 'sub_1' }, error: null } })
    const result = await recordSubscription({ endpoint: 'e', p256dh: 'p', auth: 'a', userAgent: 'ua' })
    expect(result).toEqual({ id: 'sub_1' })
  })

  it('throws on supabase error', async () => {
    mockChain({ single: { data: null, error: { message: 'boom' } } })
    await expect(recordSubscription({ endpoint: 'e', p256dh: 'p', auth: 'a' })).rejects.toThrow(/boom/)
  })
})

describe('removeSubscription', () => {
  it('returns on success', async () => {
    mockChain({ eq: { error: null } })
    await expect(removeSubscription('e')).resolves.toBeUndefined()
  })

  it('throws on supabase error', async () => {
    mockChain({ eq: { error: { message: 'rm fail' } } })
    await expect(removeSubscription('e')).rejects.toThrow(/rm fail/)
  })
})

describe('listActiveSubscriptions', () => {
  it('returns rows from supabase', async () => {
    mockChain({ is: { data: [{ id: 's1', endpoint: 'e1', p256dh: 'p', auth: 'a' }], error: null } })
    const rows = await listActiveSubscriptions()
    expect(rows).toEqual([{ id: 's1', endpoint: 'e1', p256dh: 'p', auth: 'a' }])
  })
})

describe('pushToAll', () => {
  it('returns sent:0 when no subscriptions', async () => {
    mockChain({ is: { data: [], error: null } })
    const result = await pushToAll({ title: 't', body: 'b' })
    expect(result).toEqual({ ok: true, sent: 0 })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })

  it('counts successful sends', async () => {
    mockChain({ is: { data: [
      { id: 's1', endpoint: 'e1', p256dh: 'p1', auth: 'a1' },
      { id: 's2', endpoint: 'e2', p256dh: 'p2', auth: 'a2' }
    ], error: null } })
    webpush.sendNotification.mockResolvedValue({})
    const result = await pushToAll({ title: 'hi' })
    expect(result.sent).toBe(2)
    expect(result.total).toBe(2)
  })

  it('marks 410-gone subscriptions as failed', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    getSupabase.mockReturnValue({
      from: (table) => {
        if (table === 'imessage_console_push_subscriptions') {
          return {
            select: () => ({ is: () => Promise.resolve({ data: [
              { id: 's1', endpoint: 'e1', p256dh: 'p', auth: 'a' }
            ], error: null }) }),
            update: () => ({ eq: updateEq })
          }
        }
      }
    })
    webpush.sendNotification.mockRejectedValue({ statusCode: 410, body: 'gone' })
    const result = await pushToAll({ title: 'x' })
    expect(result.sent).toBe(0)
    expect(updateEq).toHaveBeenCalled()
  })

  it('returns ok:false when VAPID not set', async () => {
    delete process.env.VAPID_PUBLIC_KEY
    const result = await pushToAll({ title: 'x' })
    expect(result.ok).toBe(false)
  })
})
