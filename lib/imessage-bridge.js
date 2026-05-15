import { sendMessage, normalizePhone } from './sendblue.js'
import { createCustomActivity } from './close.js'
import { getSupabase } from './supabase.js'

// Mirror an iMessage into the Supabase inbox table. Best-effort: returns
// `{ ok, error }` and never throws. The inbox (/api/sendblue/console/threads)
// reads from this table because Close's API doesn't support listing all
// custom activities of a type across leads.
async function mirrorToInbox({ closeActivityId, leadId, leadName, contactId, direction, message, phone, mediaUrl, sendblueHandle }) {
  if (!leadId) return { ok: false, error: 'leadId required' }
  try {
    const sb = getSupabase()
    const { error } = await sb
      .from('imessage_console_messages')
      .insert({
        close_activity_id: closeActivityId ?? null,
        lead_id: leadId,
        lead_name: leadName ?? null,
        contact_id: contactId ?? null,
        direction,
        message: message ?? null,
        phone: phone ?? null,
        media_url: mediaUrl ?? null,
        sendblue_handle: sendblueHandle ?? null
      })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    console.error('mirrorToInbox failed', err)
    return { ok: false, error: String(err?.message || err) }
  }
}

// Best-effort: log an iMessage as a Custom Activity on a Close lead and
// mirror it to the Supabase inbox table. Returns
// `{ ok, activityId, mirrored }` and never throws.
export async function logImessageActivity({ leadId, contactId, direction, message, phone, mediaUrl, sendblueHandle, leadName }) {
  const activityTypeId = process.env.CLOSE_CUSTOM_ACTIVITY_IMESSAGE
  if (!activityTypeId) {
    return { ok: false, error: 'CLOSE_CUSTOM_ACTIVITY_IMESSAGE not set' }
  }
  if (!leadId) return { ok: false, error: 'leadId required' }

  const customFields = {}
  if (process.env.CLOSE_CF_IMESSAGE_TEXT) {
    customFields[process.env.CLOSE_CF_IMESSAGE_TEXT] = message
  }
  if (process.env.CLOSE_CF_IMESSAGE_DIRECTION) {
    customFields[process.env.CLOSE_CF_IMESSAGE_DIRECTION] = direction
  }
  if (process.env.CLOSE_CF_IMESSAGE_PHONE && phone) {
    customFields[process.env.CLOSE_CF_IMESSAGE_PHONE] = phone
  }
  if (process.env.CLOSE_CF_IMESSAGE_MEDIA_URL && mediaUrl) {
    customFields[process.env.CLOSE_CF_IMESSAGE_MEDIA_URL] = mediaUrl
  }
  if (process.env.CLOSE_CF_IMESSAGE_HANDLE && sendblueHandle) {
    customFields[process.env.CLOSE_CF_IMESSAGE_HANDLE] = sendblueHandle
  }

  // Fall back to using `note` for the message body if no text custom field exists,
  // so the message is still visible on the timeline.
  const note = process.env.CLOSE_CF_IMESSAGE_TEXT ? undefined : `[${direction}] ${message}`

  let activityId = null
  let closeOk = true
  let closeError = null
  try {
    const result = await createCustomActivity({
      leadId,
      activityTypeId,
      contactId,
      customFields,
      note
    })
    activityId = result?.id || null
  } catch (err) {
    closeOk = false
    closeError = String(err?.message || err)
  }

  // Always attempt the Supabase mirror, even if the Close write failed —
  // we'd rather the message show up in our inbox than be silently lost.
  const mirror = await mirrorToInbox({
    closeActivityId: activityId,
    leadId,
    leadName: leadName ?? null,
    contactId,
    direction,
    message,
    phone,
    mediaUrl,
    sendblueHandle
  })

  if (!closeOk) return { ok: false, error: closeError, mirrored: mirror.ok }
  return { ok: true, activityId, mirrored: mirror.ok }
}

// Send an iMessage via SendBlue and optionally record it on a Close lead.
// `leadId` is optional; if provided we log the outbound message as a Custom Activity.
export async function sendImessage({ phone, message, leadId, contactId, sendStyle, mediaUrl, leadName }) {
  const normalized = normalizePhone(phone)
  if (!normalized) throw new Error('phone is required')
  const hasMessage = typeof message === 'string' && message.length > 0
  const hasMedia = typeof mediaUrl === 'string' && mediaUrl.length > 0
  if (!hasMessage && !hasMedia) throw new Error('message or mediaUrl is required')

  const sendResult = await sendMessage({
    phone: normalized,
    message,
    sendStyle,
    mediaUrl
  })

  let logResult = { ok: false, error: 'no leadId provided' }
  if (leadId) {
    logResult = await logImessageActivity({
      leadId,
      leadName,
      contactId,
      direction: 'outbound',
      message,
      phone: normalized,
      mediaUrl,
      sendblueHandle: sendResult?.message_handle
    })
  }

  return { send: sendResult, log: logResult, phone: normalized }
}
