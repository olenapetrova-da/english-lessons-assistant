# Issue: Google Drive watch expired — pipeline stops receiving new files

## Description

Google Drive push notifications are delivered through a "watch channel" that Google creates when `/drive/setup` is called. This channel has a hard expiry of approximately **7 days**, set by Google and cannot be changed.

When the channel expires:
- Google silently stops sending push notifications to the Cloudflare Worker
- The Worker receives no events, so ENG1 and ENG2 never run
- No errors appear anywhere — the pipeline just stops processing new files
- Files added to the Drive folder after expiry are ignored until the watch is renewed

**How to confirm this is the cause:** call `/drive/status` and check the `expirationMs` field. If the expiry timestamp is in the past, the watch has expired.

## Solution 1 — Quick manual fix

Run this command to renew the watch immediately:

```
curl.exe -X POST https://english-lessons-assistant.elenipster.workers.dev/drive/setup
```

This registers a new 7-day watch channel with Google. You will need to repeat this every ~7 days or the issue returns.

## Solution 2 — Permanent fix via Cloudflare cron trigger (recommended)

The Worker already contains a `renewIfNeeded()` function that checks whether expiry is less than 1 hour away and renews the watch if so. It just needs a scheduled trigger to run it automatically.

**One-time setup in the Cloudflare dashboard:**

1. Open your Worker → **Triggers** tab → **Cron Triggers**
2. Add cron trigger: `0 */6 * * *` (runs every 6 hours)
3. Save

After this, the Worker self-renews before the channel ever expires. `/drive/setup` never needs to be called manually again for expiry reasons.

---

# Issue: ENG2 "Google Drive: export doc as text" fails with authentication error

## Description

The node that exports the Google Doc as plain text via the Drive API fails with one of two errors depending on the credential type in use:

- **`refreshToken is required`** — the OAuth2 user credential stored in n8n has lost its refresh token (Google invalidated it)
- **`403 The request is missing a valid API key`** — the node has no credential attached, or the credential is attached but has no scopes configured

This node broke twice during the project lifetime and required manual intervention each time.

## Why the first solution failed (OAuth2 re-authorization)

The initial fix was to re-authorize the Google OAuth2 user credential in n8n with `prompt=consent` to force Google to issue a new refresh token. This worked temporarily but broke again.

**Root cause of recurrence:** Google OAuth2 user credentials are tied to a user session and can be silently invalidated by Google for various reasons (security events, credential changes, token limits). Even with `prompt=consent`, there is no guarantee the token will remain valid indefinitely. This approach requires manual browser re-authorization every time it breaks — not acceptable for an automated pipeline.

## Permanent solution: Service Account credential

A Service Account is a non-human Google identity designed for server-to-server automation. It authenticates with a JSON key file, never requires user re-authorization, and does not expire.

### One-time setup

**Step 1 — Create or reuse a Service Account (Google Cloud Console)**
- IAM & Admin → Service Accounts → create new or use existing
- Keys tab → Add Key → JSON → download the file
- The `client_email` field in the JSON is the service account's identity

**Step 2 — Share the Drive intake folder with the service account**
- Google Drive → right-click intake folder → Share
- Add the `client_email` address, role: **Viewer**

**Step 3 — Create the credential in n8n**
- Credentials → New → **Google Service Account API**
- Enter Service Account Email and Private Key from the JSON file
- **Critical:** enable **"Set up for use in HTTP Request node"** — this reveals the Scope(s) field
- Add scope: `https://www.googleapis.com/auth/drive.readonly`
- Save and verify "Connection tested successfully"

**Step 4 — Update the ENG2 node**
- Open "Google Drive: export doc as text"
- Authentication → **Predefined Credential Type**
- Credential Type → **Google Service Account API**
- Select the credential created in Step 3
- Remove the query parameters `access_type=offline` and `prompt=consent` — these are OAuth2-only parameters, irrelevant for service accounts
- Keep only: `mimeType = text/plain`

### How to prevent this issue in future projects

Use a Service Account from the start for any server-side Google API access. Never use OAuth2 user credentials in automated pipelines — they require a human browser session to authorize and Google can revoke them at any time. Service Account + shared folder is the correct pattern for automation.

---

# Issue: ENG2 status UPDATE nodes fail — "UPDATE requires a WHERE clause"

## Description

In ENG2, two nodes update the `processing_log` status as the file moves through the pipeline:
- **Supabase: set processing** — sets `status = processing` when ENG2 starts
- **Supabase: set done** — sets `status = done` after all data is written to Supabase

Both were originally built using the **n8n Supabase node v1**. They failed with:

```
UPDATE requires a WHERE clause
```

## Root cause

The n8n Supabase node v1 has a `filterString` parameter that works correctly for **SELECT** (`getAll`) operations but is silently ignored for **UPDATE** operations. The node generates an UPDATE query with no WHERE clause, which Supabase (PostgREST) rejects as a safety measure to prevent updating every row in the table.

This is a known limitation of the Supabase node v1 in n8n. There is no fix within the node itself — the filter UI does not apply to updates regardless of how it is configured.

## Solution: replace with HTTP Request node (PATCH to Supabase REST API)

Both UPDATE nodes were replaced with HTTP Request nodes that call the Supabase REST API directly.

**Node configuration:**

| Field | Value |
|---|---|
| Method | PATCH |
| URL | `https://[SUPABASE_URL]/rest/v1/processing_log?file_id=eq.{{ $('Webhook from ENG1').first().json.body.fileId }}` |
| Authentication | None (auth passed via headers) |

**Headers:**

| Name | Value |
|---|---|
| `apikey` | Supabase service role key |
| `Authorization` | `Bearer [service role key]` |
| `Content-Type` | `application/json` |
| `Prefer` | `return=minimal` |

**Body (JSON):**
- For "set processing": `{ "status": "processing" }`
- For "set done": `{ "status": "done" }`

**Important — use `.first()` in the URL expression:**

Write `$('Webhook from ENG1').first().json.body.fileId`, not `$node["Webhook from ENG1"].json.body.fileId`.

When ENG2 runs the "set done" node, there may be multiple items in context (one per vocabulary word). `$node["Webhook from ENG1"].json` uses the current item index and fails with "node has 1 item but you're trying to access item N". `.first()` always reads item 0 from that node regardless of the current loop index.

## How to prevent this in future projects

Never use the n8n Supabase node v1 for UPDATE or DELETE operations — use HTTP Request nodes with PATCH/DELETE to the Supabase REST API directly. The Supabase node v1 is reliable only for INSERT and SELECT.

---

# Issue: ENG2 "Supabase: insert lesson" fails with `invalid input syntax for type date: "null"`

## Description

When GPT returns `null` for a date field (e.g. `lesson_date` or `homework_due_date`), the n8n Supabase node v1 serialises the JavaScript `null` value as the string `"null"` and sends it to Supabase. PostgreSQL rejects `"null"` as an invalid date value.

## What does NOT reliably fix it

Using `={{ $json.lesson_date ?? undefined }}` in the Supabase node field expression. In theory, `null ?? undefined` returns `undefined` and n8n should omit undefined fields. In practice, n8n's expression evaluator may not honour this for all field positions in the node, causing the bug to persist for some fields.

## Reliable fix: delete null date fields in a Code node

Before the Supabase insert node, add (or modify) a Code node to explicitly delete null date properties from the object:

```javascript
if (result.lesson_date == null) delete result.lesson_date;
if (result.homework_due_date == null) delete result.homework_due_date;
```

`delete` completely removes the property. The Supabase node then has nothing to serialise, so the field is omitted from the INSERT body entirely. PostgreSQL uses the column default (`null`) for omitted fields.

**Rule:** Never rely on n8n expression-level `?? undefined` for date fields going into Supabase. Always handle null dates in a Code node.

---

# Issue: PowerShell `curl` is not the real curl

## Description

In PowerShell, `curl` is an alias for `Invoke-WebRequest`, not the real `curl.exe`. Running `curl -X POST -H ... -d ...` produces errors like `-H is not a recognized parameter` because `Invoke-WebRequest` uses completely different flags.

## Solutions

**Option 1 — Use `curl.exe`** (calls the real curl binary):
```powershell
curl.exe -X POST "https://..." -H "Content-Type: application/json" -d '{"key":"value"}'
```
Caution: single-quoted JSON bodies in PowerShell may pass literal quote characters to the executable on some systems.

**Option 2 — Use `Invoke-RestMethod`** (native PowerShell, recommended):
```powershell
Invoke-RestMethod -Method POST -Uri "https://..." `
  -Headers @{"Content-Type"="application/json"; "x-token"="abc"} `
  -Body '{"key":"value"}'
```
`Invoke-RestMethod` handles headers and body natively with no quoting issues.

**Note on the response:** `Invoke-RestMethod` throws an exception for non-2xx status codes AND for empty response bodies (e.g. 204 No Content from `Prefer: return=minimal`). The exception message contains the error body. A successful workflow that returns no content will still show as an error in the terminal — check n8n Executions to confirm the actual result.

---

# Issue: Google Service Account JSON key causes JSON parse error when stored as Supabase secret

## Description

When pasting a service account JSON key file as a Supabase Edge Function secret, the JSON may fail to parse at runtime with errors like `Expected property name or '}' in JSON at position 2` or similar. The `private_key` field contains `\n` sequences that can be corrupted during copy-paste.

## Root cause

The `private_key` value in a service account JSON file is a PEM-encoded string with `\n` as literal two-character escape sequences (backslash + n). If a text editor or terminal renders these as actual newlines during copy, the resulting string is no longer valid JSON.

## Fix

Use PowerShell to read the raw file bytes and copy to clipboard, preserving the `\n` sequences as-is:

```powershell
Get-Content 'C:\path\to\credentials.json' -Raw | Set-Clipboard
```

Then in the Supabase Secrets UI: delete the existing secret, create a new one, and paste from clipboard. Verify the value starts with `{` and ends with `}` with no surrounding quotes.

---

# Issue: Google Calendar API returns empty results for `?action=next_lesson`

Three separate causes have been encountered. Check in this order:

## Cause 1 — Google Calendar API not enabled in GCP project

**Symptom:** API returns `403 SERVICE_DISABLED` with a link to enable the API.

**Fix:** Click the link in the error message or go to Google Cloud Console → APIs & Services → Enable APIs → search for "Google Calendar API" → Enable. Wait ~1 minute after enabling.

## Cause 2 — Querying `primary` instead of the user's calendar

**Symptom:** API returns 200 with empty `items` array, no error.

**Cause:** When a Service Account calls `calendars/primary/events`, it queries the service account's own calendar (which is empty). It does NOT query the user's calendar, even if the user shared their calendar with the service account.

**Fix:** Use the calendar owner's email as the calendar ID:
```typescript
const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID') || 'elenipster@gmail.com'
```

The user must have shared their primary calendar with the service account email (Google Calendar → Settings → Share with specific people).

## Cause 3 — `q` search parameter with special characters

**Symptom:** API returns 200 but empty `items` even though the event exists and the calendar is accessible.

**Cause:** The `q` (free-text search) parameter can behave unexpectedly when the event title contains parentheses or other special characters. `q=English (Olena P.)` may not match "English (Olena P.)".

**Fix:** Use a simple keyword without special characters: `q=english`. The Calendar API search is case-insensitive and matches substrings, so `english` will match "English (Olena P.)".

---

# Issue: GitHub Pages shows 404 at the root URL

## Description

`https://username.github.io/repo-name/` returns a 404 even though HTML files exist in the repo.

## Cause

GitHub Pages requires a file named `index.html` at the root of the branch/folder it is configured to serve from. If the HTML file is in a subdirectory (e.g. `UI/english_lessons_assistant.html`), the root URL has nothing to serve.

## Fix

Add an `index.html` at the repo root with a meta-refresh redirect:

```html
<!DOCTYPE html>
<meta http-equiv="refresh" content="0; url=UI/english_lessons_assistant.html">
```

GitHub Pages will rebuild automatically within ~30 seconds of the commit being pushed.