import crypto from 'node:crypto'

function md5Lower(s) {
  return crypto.createHash('md5').update(s.toLowerCase()).digest('hex')
}

function authHeader() {
  const key = process.env.MAILCHIMP_API_KEY
  if (!key) throw new Error('MAILCHIMP_API_KEY not set')
  return 'Basic ' + Buffer.from('any:' + key).toString('base64')
}

function baseUrl() {
  const dc = process.env.MAILCHIMP_DC
  if (!dc) throw new Error('MAILCHIMP_DC not set')
  return `https://${dc}.api.mailchimp.com/3.0`
}

function audienceId() {
  const id = process.env.MAILCHIMP_AUDIENCE_ID
  if (!id) throw new Error('MAILCHIMP_AUDIENCE_ID not set')
  return id
}

export async function upsertSubscriber({ email, mergeFields, status = 'subscribed' }) {
  const hash = md5Lower(email)
  const res = await fetch(
    `${baseUrl()}/lists/${audienceId()}/members/${hash}`,
    {
      method: 'PUT',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email_address: email,
        status_if_new: status,
        merge_fields: mergeFields
      })
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Mailchimp upsert failed: ${res.status} ${text}`)
  }
  return { subscriberHash: hash }
}

export async function addTags({ email, tags }) {
  const hash = md5Lower(email)
  const res = await fetch(
    `${baseUrl()}/lists/${audienceId()}/members/${hash}/tags`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tags: tags.map(name => ({ name, status: 'active' }))
      })
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Mailchimp tag failed: ${res.status} ${text}`)
  }
}
