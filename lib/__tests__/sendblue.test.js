import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendMessage, sendReaction, checkAuth, normalizePhone } from '../sendblue.js'

beforeEach(() => {
  process.env.SENDBLUE_API_KEY = 'key_test'
  process.env.SENDBLUE_API_SECRET = 'secret_test'
  delete process.env.SENDBLUE_FROM_NUMBER
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizePhone', () => {
  it('adds +1 to 10-digit US numbers', () => {
    expect(normalizePhone('5550100123')).toBe('+15550100123')
  })
  it('keeps existing + prefix', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123')
  })
  it('strips formatting from 11-digit US numbers', () => {
    expect(normalizePhone('1 (555) 010-0123')).toBe('+15550100123')
  })
  it('returns null for empty input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
  })
})

describe('sendMessage', () => {
  it('POSTs to /send-message with auth headers and normalized number', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ message_handle: 'msg_abc' })
    })
    const result = await sendMessage({
      phone: '555-010-0123',
      message: 'hello'
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.sendblue.co/api/send-message',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'sb-api-key-id': 'key_test',
          'sb-api-secret-key': 'secret_test',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ number: '+15550100123', content: 'hello' })
      })
    )
    expect(result).toEqual({ message_handle: 'msg_abc' })
  })

  it('includes from_number when SENDBLUE_FROM_NUMBER is set', async () => {
    process.env.SENDBLUE_FROM_NUMBER = '+13472681693'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await sendMessage({ phone: '+15550100123', message: 'hi' })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.from_number).toBe('+13472681693')
  })

  it('omits from_number when SENDBLUE_FROM_NUMBER is unset', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await sendMessage({ phone: '+15550100123', message: 'hi' })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.from_number).toBeUndefined()
  })

  it('passes optional send_style and media_url through', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await sendMessage({
      phone: '+15550100123',
      message: 'hi',
      sendStyle: 'celebration',
      mediaUrl: 'https://example.com/x.jpg'
    })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.send_style).toBe('celebration')
    expect(body.media_url).toBe('https://example.com/x.jpg')
  })

  it('throws when phone is missing', async () => {
    await expect(sendMessage({ phone: '', message: 'x' })).rejects.toThrow(/phone is required/)
  })

  it('throws when both message and mediaUrl are missing', async () => {
    await expect(sendMessage({ phone: '+15550100123', message: '' })).rejects.toThrow(/message or mediaUrl is required/)
  })

  it('allows media-only sends (empty message + mediaUrl)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await sendMessage({ phone: '+15550100123', message: '', mediaUrl: 'https://example.com/x.jpg' })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.content).toBe('')
    expect(body.media_url).toBe('https://example.com/x.jpg')
  })

  it('throws when env vars missing', async () => {
    delete process.env.SENDBLUE_API_KEY
    await expect(
      sendMessage({ phone: '+15550100123', message: 'hi' })
    ).rejects.toThrow(/SENDBLUE_API_KEY/)
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    })
    await expect(
      sendMessage({ phone: '+15550100123', message: 'hi' })
    ).rejects.toThrow('SendBlue send failed: 401')
  })
})

describe('sendReaction', () => {
  it('POSTs to /send-reaction with normalized number, handle, reaction', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    })
    await sendReaction({ phone: '+15550100123', messageHandle: 'sb_x', reaction: 'love' })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.sendblue.co/api/send-reaction',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '+15550100123',
          reaction: 'love',
          message_handle: 'sb_x'
        })
      })
    )
  })

  it('includes from_number when SENDBLUE_FROM_NUMBER set', async () => {
    process.env.SENDBLUE_FROM_NUMBER = '+13472681693'
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    await sendReaction({ phone: '+15550100123', messageHandle: 'sb_x', reaction: 'love' })
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.from_number).toBe('+13472681693')
  })

  it('throws when fields missing', async () => {
    await expect(sendReaction({ messageHandle: 'x', reaction: 'love' })).rejects.toThrow(/phone is required/)
    await expect(sendReaction({ phone: '+1', reaction: 'love' })).rejects.toThrow(/messageHandle is required/)
    await expect(sendReaction({ phone: '+1', messageHandle: 'x' })).rejects.toThrow(/reaction is required/)
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'no'
    })
    await expect(
      sendReaction({ phone: '+15550100123', messageHandle: 'x', reaction: 'love' })
    ).rejects.toThrow(/SendBlue reaction failed: 422/)
  })
})

describe('checkAuth', () => {
  it('GETs /lines with auth headers', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ lines: [{ number: '+15550100123' }] })
    })
    const result = await checkAuth()
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.sendblue.co/api/lines',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'sb-api-key-id': 'key_test',
          'sb-api-secret-key': 'secret_test'
        })
      })
    )
    expect(result).toEqual({ lines: [{ number: '+15550100123' }] })
  })

  it('throws on non-OK response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    })
    await expect(checkAuth()).rejects.toThrow('SendBlue auth check failed: 401')
  })
})
