# SendBlue ↔ Close CRM middleware

Two-way iMessage texting between Close CRM leads and Lushful Aesthetics via the
SendBlue API ($100/mo API plan, not the full SendBlue platform).

## Endpoints

All routes live under `/api/sendblue/`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/sendblue/send` | POST | Send an iMessage and (optionally) log it on a Close lead. Use from Close workflows or scripts. |
| `/api/sendblue/outbound` | POST | Close workflow webhook handler — accepts flat or `event.data` payloads, sends, logs. |
| `/api/sendblue/inbound` | POST | SendBlue inbound-message webhook handler — matches the sender's phone to a Close lead and logs the message. |
| `/api/sendblue/health` | GET | Verifies both API keys are valid + reports which env vars are configured. |

### `POST /api/sendblue/send`

```jsonc
{
  "phone": "+15550100123",        // required, will be normalized to E.164
  "message": "Hi Jane!",          // required
  "leadId": "lead_abc",           // optional — when present, message logged on lead
  "contactId": "cont_xyz",        // optional
  "sendStyle": "celebration",     // optional, SendBlue effect
  "mediaUrl": "https://..."       // optional, image/MMS
}
```

Returns `{ ok, phone, messageHandle, logged, logError }`.

### `POST /api/sendblue/outbound`

Accepts either of:

```jsonc
// Flat (recommended for Close workflow HTTP step)
{ "lead_id": "lead_abc", "phone": "+15550100123", "message": "Hi Jane!" }

// Close-style envelope (also supported)
{ "event": { "lead_id": "lead_abc", "data": { "phone": "+15550100123", "message": "Hi Jane!" } } }
```

Camel- and snake-case keys are both recognized.

### `POST /api/sendblue/inbound`

Configure SendBlue to POST inbound messages to:

```
https://<your-domain>/api/sendblue/inbound?secret=<SENDBLUE_WEBHOOK_SECRET>
```

(or set the secret in the `X-Webhook-Secret` header). The handler:

1. Normalizes the sender phone to E.164.
2. Looks up the matching Close lead via `GET /lead/?query=phone:"..."`.
3. Logs the message as a Custom Activity on the lead's timeline.

If no lead matches, the endpoint returns `200 { matched: false }` so SendBlue
does not retry — but the message is **not** stored locally. Add a Supabase
table later if persistent inbox is needed.

## Environment variables

All required for full functionality:

```
SENDBLUE_API_KEY=          # from SendBlue dashboard
SENDBLUE_API_SECRET=       # from SendBlue dashboard
SENDBLUE_WEBHOOK_SECRET=   # random string you generate; share with SendBlue webhook URL
CLOSE_API_KEY=             # already configured for existing lead sync
CLOSE_CUSTOM_ACTIVITY_IMESSAGE=    # cf_xxx — see Custom Activity setup below
CLOSE_CF_IMESSAGE_TEXT=    # cf_xxx — message body field
CLOSE_CF_IMESSAGE_DIRECTION=  # cf_xxx — "inbound" or "outbound"
CLOSE_CF_IMESSAGE_PHONE=   # cf_xxx — phone field
# Optional:
CLOSE_CF_IMESSAGE_MEDIA_URL=
CLOSE_CF_IMESSAGE_HANDLE=  # SendBlue message_handle for traceability
```

If you skip `CLOSE_CF_IMESSAGE_TEXT`, the message body is written to the
activity's built-in `note` field as `[direction] message` instead.

## Close Custom Activity setup

The middleware logs each iMessage as a Custom Activity so it shows on the
lead's timeline. Set it up once in Close:

1. **Close → Settings → Custom Activities → New custom activity.**
2. Name it `iMessage`. Optionally set an icon (e.g. chat bubble).
3. Add custom fields on the activity:
   - **Message** — type *Long Text*. Holds the message body.
   - **Direction** — type *Choice* (options: `inbound`, `outbound`).
   - **Phone** — type *Text*. Sender or recipient phone in E.164 form.
   - *(optional)* **Media URL** — type *URL*. Set if you handle MMS.
   - *(optional)* **SendBlue Handle** — type *Text*. For debugging.
4. Save the activity. Open it from the same Settings page and copy the IDs:
   - The activity type ID (top of the page, format `actitype_xxxxxxxxxx`) →
     `CLOSE_CUSTOM_ACTIVITY_IMESSAGE`
   - Each custom field's ID (`cf_xxxxxxxxxx`, visible on hover or via the
     Close API `GET /custom_activity/<type-id>/`) → the matching
     `CLOSE_CF_IMESSAGE_*` env var.
5. Deploy with the new env vars set on Vercel.

### Verifying setup

```
curl https://<your-domain>/api/sendblue/health
```

A healthy response returns `200`:

```json
{
  "ok": true,
  "checks": [
    { "service": "sendblue", "ok": true },
    { "service": "close", "ok": true }
  ],
  "env": {
    "SENDBLUE_API_KEY": true,
    "SENDBLUE_API_SECRET": true,
    "CLOSE_API_KEY": true,
    "CLOSE_CUSTOM_ACTIVITY_IMESSAGE": true,
    "SENDBLUE_WEBHOOK_SECRET": true
  }
}
```

## Hooking up Close workflows

In a Close workflow, add an **HTTP request** step:

- **URL:** `https://<your-domain>/api/sendblue/send`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Body (JSON):**

  ```json
  {
    "phone": "{{lead.contact.phone}}",
    "message": "Hi {{lead.display_name}}, this is Lushful Aesthetics — your consult is coming up...",
    "leadId": "{{lead.id}}"
  }
  ```

Close substitutes the template variables at send time. Use `/outbound` instead
if you prefer Close's automatic event payload format.

## Reply console (`/imessage`)

A password-gated inbox + reply UI lives at the root of the deploy:

- **Production URL:** `https://start.lushfulaesthetics.com/imessage`
- Single shared password set via `REPLY_CONSOLE_PASSWORD`
- Sessions are HMAC-signed cookies (30-day lifetime), keyed on `REPLY_CONSOLE_SESSION_SECRET` (>= 16 chars, random)

What it does:

- Left pane: every lead that has any iMessage activity, sorted by most recent message
- Right pane: the full thread for a selected lead (inbound + outbound), with a reply box
- Replies POST to `/api/sendblue/console/reply`, which goes through the same `/send` code path — so replies are automatically logged as outbound iMessage activities on the lead in Close
- Polls for new messages every 20 seconds while the tab is visible

Endpoints under `/api/sendblue/console/`:

| Route | Method | Purpose |
| --- | --- | --- |
| `/login` | POST `{ password }` | Sign in, sets session cookie |
| `/login` | DELETE | Sign out, clears cookie |
| `/threads` | GET | List threads (one per lead with iMessage activity) |
| `/thread?leadId=X` | GET | Full thread for one lead |
| `/reply` | POST `{ leadId, phone, message }` | Send a reply, logs to Close |

## Hooking up SendBlue inbound

In the SendBlue dashboard → **Webhooks** (or `Receive` settings):

- Set the **Inbound URL** to
  `https://<your-domain>/api/sendblue/inbound?secret=<SENDBLUE_WEBHOOK_SECRET>`.
- Verify by sending a test iMessage to your SendBlue number from a phone that
  already exists as a contact in Close — you should see a new iMessage custom
  activity on the lead within a few seconds.
