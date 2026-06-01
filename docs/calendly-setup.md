# Calendly → Close webhook setup

Marks a Close lead "Call Booked" (and logs the Q&A) whenever someone books the
30-min consult on Calendly — funnel embed, `/consultation-book`, or a bare
Calendly link in an email. Handler: `api/calendly-webhook.js`.

**Host:** the funnel + API run on the Vercel domain `https://lushfulcontent.vercel.app`.
(`lushfulaesthetics.com` is the separate WordPress marketing site — do not point
the webhook there.) The webhook is registered against the Vercel domain.

## Authentication: shared secret in the callback URL

Calendly does not issue a signing key for this account (the create-subscription
response returns no `signing_key`) and can't send custom headers. So we
authenticate with a shared secret carried in the callback URL's query string —
the same pattern as the Close webhook (`api/sendblue/close-webhook.js`). The
secret is used both as the URL `?secret=` and the `CALENDLY_WEBHOOK_SECRET` env
var. Generate a strong one:

```bash
openssl rand -hex 24
```

## One-time registration

Calendly webhook subscriptions are created via API (paid plan) and require a
Personal Access Token (PAT): Calendly → Integrations → API & Webhooks.

1. Set the secret in Vercel (Production) and redeploy so the function knows it:
   ```
   CALENDLY_WEBHOOK_SECRET=<secret>
   ```

2. Get your organization URI:
   ```bash
   curl https://api.calendly.com/users/me \
     -H "Authorization: Bearer $CALENDLY_PAT"
   # → resource.current_organization
   ```

3. Create the subscription — note the `?secret=` on the callback URL:
   ```bash
   curl -X POST https://api.calendly.com/webhook_subscriptions \
     -H "Authorization: Bearer $CALENDLY_PAT" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://lushfulcontent.vercel.app/api/calendly-webhook?secret=<secret>",
       "events": ["invitee.created"],
       "organization": "<organization_uri>",
       "scope": "organization"
     }'
   ```

To rotate the secret: set the new value in Vercel, delete the old subscription
(`DELETE /webhook_subscriptions/<uuid>`), and create a new one with the new
`?secret=`.

## Close prerequisite

If the Close `Source` custom field is a **choice (dropdown)** field rather than
free text, add a `calendly-direct` option in the Close UI first, or creating a
direct-booking lead will fail.

## Verify

- `GET https://lushfulcontent.vercel.app/api/calendly-webhook` → **405**
  (function deployed). A POST without the secret → **401**.
- Book a test event on the 30-min Calendly. Confirm in Close: the lead is
  **Call Booked** with a "Calendly booking confirmed" note, and the
  `calendly_bookings` table got a row.
- Re-deliver the same event from Calendly's webhook log → handler returns 200
  `skipped: already processed` (no duplicate writes).
- A booking with a brand-new email creates a `calendly-direct` lead at Call
  Booked.

## Notes

- The link the customer clicks needs no params: Calendly's own booking form
  always collects the name + email, which is what we match on. The `?secret=` is
  only on the *webhook callback* URL, never the booking link.
- Replay protection is the `calendly_bookings.invitee_uri` unique key; a
  redelivered event is deduped.
