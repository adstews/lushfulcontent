import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
const { sendMessage } = await import('../blooio.js')

beforeEach(() => {
  process.env.BLOOIO_API_KEY = 'bk_test'
  delete process.env.BLOOIO_FROM_NUMBER
  globalThis.fetch = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

describe('blooio.sendMessage', () => {
  it('POSTs to /chats/{phone}/messages with Bearer auth and returns message_handle', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_123' }) })
    const r = await sendMessage({ phone: '5550100123', message: 'hi' })
    const [url, opts] = globalThis.fetch.mock.calls[0]
    expect(url).toBe('https://backend.blooio.com/v2/api/chats/+15550100123/messages')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer bk_test')
    expect(JSON.parse(opts.body).text).toBe('hi')
    expect(r.message_handle).toBe('m_123')
  })

  it('sends media as attachments array', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'm_2' }) })
    await sendMessage({ phone: '+15550100123', message: '', mediaUrl: 'https://x/y.jpg' })
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).attachments).toEqual(['https://x/y.jpg'])
  })

  it('throws on phone missing', async () => {
    await expect(sendMessage({ phone: '', message: 'x' })).rejects.toThrow(/phone is required/)
  })
  it('throws on no message and no media', async () => {
    await expect(sendMessage({ phone: '+15550100123', message: '' })).rejects.toThrow(/message or mediaUrl/)
  })
  it('throws on non-ok response', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 422, text: async () => 'bad' })
    await expect(sendMessage({ phone: '+15550100123', message: 'hi' })).rejects.toThrow(/Blooio send failed: 422/)
  })
})
