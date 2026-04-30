const BASE = 'https://api.close.com/api/v1'

function authHeader() {
  const key = process.env.CLOSE_API_KEY
  if (!key) throw new Error('CLOSE_API_KEY not set')
  return 'Basic ' + Buffer.from(key + ':').toString('base64')
}

export async function createLead({ name, email, phone, statusId, customFields }) {
  const body = {
    name,
    status_id: statusId,
    contacts: [{
      name,
      emails: email ? [{ email, type: 'office' }] : [],
      phones: phone ? [{ phone, type: 'office' }] : []
    }],
    custom: customFields
  }
  const res = await fetch(`${BASE}/lead/`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close create failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  return { closeLeadId: data.id }
}

export async function updateLead({ leadId, statusId, customFields }) {
  const body = {}
  if (statusId) body.status_id = statusId
  if (customFields) {
    for (const [cfId, value] of Object.entries(customFields)) {
      body[`custom.${cfId}`] = value
    }
  }
  const res = await fetch(`${BASE}/lead/${leadId}/`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Close update failed: ${res.status} ${text}`)
  }
}
