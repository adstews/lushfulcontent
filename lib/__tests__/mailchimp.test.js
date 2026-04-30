import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { upsertSubscriber, addTags } from '../mailchimp.js'

beforeEach(() => {
  process.env.MAILCHIMP_API_KEY = 'test-key'
  process.env.MAILCHIMP_AUDIENCE_ID = 'aud123'
  process.env.MAILCHIMP_DC = 'us21'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('upsertSubscriber', () => {
  it('PUTs to MD5(lowercase(email)) endpoint with merge fields', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({})
    })
    const result = await upsertSubscriber({
      email: 'TEST@Example.COM',
      mergeFields: { FNAME: 'Test', PHONE: '555' }
    })
    // MD5 of 'test@example.com' = '55502f40dc8b7c769880b10874abc9d0'
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/aud123/members/55502f40dc8b7c769880b10874abc9d0',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          email_address: 'TEST@Example.COM',
          status_if_new: 'subscribed',
          merge_fields: { FNAME: 'Test', PHONE: '555' }
        })
      })
    )
    expect(result).toEqual({
      subscriberHash: '55502f40dc8b7c769880b10874abc9d0'
    })
  })

  it('throws when Mailchimp returns non-OK', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"detail":"bad"}'
    })
    await expect(
      upsertSubscriber({ email: 'a@b.com', mergeFields: {} })
    ).rejects.toThrow('Mailchimp upsert failed: 400')
  })

  it('throws when env vars are missing', async () => {
    delete process.env.MAILCHIMP_API_KEY
    await expect(
      upsertSubscriber({ email: 'a@b.com', mergeFields: {} })
    ).rejects.toThrow('MAILCHIMP_API_KEY not set')
  })
})

describe('addTags', () => {
  it('POSTs tags as active to the tags endpoint', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => ''
    })
    await addTags({
      email: 'test@example.com',
      tags: ['girthfill-landing', 'girthfill-qualified']
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://us21.api.mailchimp.com/3.0/lists/aud123/members/55502f40dc8b7c769880b10874abc9d0/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tags: [
            { name: 'girthfill-landing', status: 'active' },
            { name: 'girthfill-qualified', status: 'active' }
          ]
        })
      })
    )
  })

  it('throws when Mailchimp returns non-OK on tags', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'oops'
    })
    await expect(
      addTags({ email: 'a@b.com', tags: ['x'] })
    ).rejects.toThrow('Mailchimp tag failed: 500')
  })
})
