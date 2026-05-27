# Architecture Decision Records

---

## ADR-001 — Reuse PMI Cloudflare Worker pattern

**Date:** 2026-05-22
**Status:** Done

**Decision:** Deploy a second instance of `pmi-drive-watch.js` with no code changes, only different environment variables.

**Reason:** The Worker is fully parameterised via env vars (`INTAKE_FOLDER_ID`, `N8N_WEBHOOK_URL`, `N8N_SHARED_SECRET`). No code change needed to watch a different folder.

**Constraints:** Deployment is via Cloudflare dashboard (no Wrangler CLI). Env vars set manually in Worker Settings → Variables.

---

## ADR-002 — n8n execution budget

**Date:** 2026-05-22
**Status:** Active constraint

**Decision:** Design all workflows to minimise n8n executions. No per-word or per-vocabulary triggers.

**Reason:** n8n Starter plan has 2,500 executions/month. Budget is critical.

**Result:** 2 executions per new file (ENG1 + ENG2). ~8–10 executions/month at current lesson frequency.

---

## ADR-003 — OpenAI GPT-4o-mini for extraction

**Date:** 2026-05-22
**Status:** Done

**Decision:** Use OpenAI GPT-4o-mini via HTTP Request node in ENG2 to extract vocabulary, homework, topic, and dates from lesson docs.

**Reason:** No Claude API budget (Claude Pro subscription does not include API access). GPT-4o-mini is cheapest available model sufficient for structured extraction.

**Cost estimate:** ~$0.004 for 20 files initial load. Ongoing: cents per month.

**Alternatives rejected:**
- Claude API — no budget
- Rule-based parsing — docs are freestyle, no consistent structure

---

## ADR-004 — Supabase (PostgreSQL) for storage

**Date:** 2026-05-22
**Status:** Done

**Decision:** Use existing Supabase free tier project for all data storage.

**Reason:** Already set up for other projects. Free tier has no row limits. User comfortable with SQL.

**Alternatives rejected:**
- Notion database — free tier gets slow with thousands of vocabulary entries; API rate limits
- Airtable — same concerns as Notion

**Tables:** `processing_log`, `lessons`, `vocabulary`, `homework`

---

## ADR-005 — RLS disabled on all tables

**Date:** 2026-05-22
**Status:** Done

**Decision:** Row Level Security disabled on all four tables.

**Reason:** Personal single-user project. Access controlled at Edge Function level instead. Simplifies queries from the frontend.

**Risk:** Anyone with the anon key can read all data. Acceptable for a personal language learning tool.

---

## ADR-006 — Supabase Edge Function for frontend API

**Date:** 2026-05-22
**Status:** Done

**Decision:** Create a Supabase Edge Function (`lesson-api`) as the data layer between Supabase and the frontend.

**Reason:** Direct browser calls to Supabase REST API are blocked by CORS when called from GitHub Pages or Claude.ai domains. Edge Function adds CORS headers and solves this without any extra backend.

**JWT verification:** Disabled on the function (personal project, no auth needed).

**Supported actions:**
- `?action=lesson_prep` — latest lesson, homework, previous vocabulary
- `?action=vocabulary` — all vocabulary with lesson metadata
- `?action=next_lesson` — next upcoming lesson from Google Calendar (planned)

**Alternatives rejected:**
- n8n as API proxy — costs executions on every page load
- Direct Supabase REST — blocked by CORS

---

## ADR-007 — Static HTML frontend on GitHub Pages

**Date:** 2026-05-22
**Status:** Done

**Decision:** Build the UI as a single standalone HTML file (`english-lessons.html`) hosted on GitHub Pages.

**Reason:** Claude.ai artifact is not bookmarkable and requires scrolling through chat to find. GitHub Pages gives a permanent URL accessible from any device.

**Alternatives rejected:**
- Claude artifact — not bookmarkable, inconvenient for daily use
- n8n webhook returning formatted text — costs executions, no UI

---

## ADR-008 — Filename as primary source for date extraction

**Date:** 2026-05-27
**Status:** Active

**Decision:** Pass the filename to GPT-4o-mini alongside doc text. Extract `lesson_date` and `homework_due_date` from the filename, not from document content.

**Reason:** Document content does not consistently contain dates. Filename patterns are more reliable.

**Known filename patterns:**
- `3. 18.05 - 22.05 topic` → lesson_date = 18.05, homework_due_date = 22.05
- `2. 08.05 >> 12.05 topic` → lesson_date = 08.05, homework_due_date = 12.05
- `3. 12.05 topic` → lesson_date = 12.05, no homework_due_date

**Assume current year** when parsing DD.MM patterns.

---

## ADR-009 — Google Calendar as source for next lesson date

**Date:** 2026-05-27
**Status:** Planned

**Decision:** Add `?action=next_lesson` to Edge Function, querying Google Calendar API for the next upcoming English lesson event.

**Reason:** Supabase `lessons` table contains past processed files only. The next lesson date and Google Meet link come from the calendar, not from Drive files.

**Implementation:** Use same Google OAuth credentials as the Cloudflare Worker (same Google account).

---

## ADR-011 — Google Drive auth in ENG2 migrated to Service Account

**Date:** 2026-05-27
**Status:** Done

**Decision:** Replace the Google OAuth2 user credential in ENG2's "Google Drive: export doc as text" node with a Google Service Account credential.

**Reason:** The OAuth2 refresh token was invalidated twice, requiring manual browser re-authorization each time. OAuth2 user credentials are tied to a user session and can be silently revoked by Google. Service Accounts use a JSON key file, never require re-authorization, and do not expire unless the key is explicitly deleted.

**Setup:**
- Reused existing service account from a prior project (`ai-first-agent@telegram-ai-sheet.iam.gserviceaccount.com`)
- Drive intake folder shared with the service account email (Viewer role)
- n8n credential type: **Google Service Account API**, with "Set up for use in HTTP Request node" enabled and scope `https://www.googleapis.com/auth/drive.readonly`
- HTTP Request node Authentication set to Predefined Credential Type → Google Service Account API

**Alternatives rejected:**
- Re-authorize OAuth2 again — already failed twice, not a durable fix

---

## ADR-010 — homework URL extraction added to ENG2 prompt

**Date:** 2026-05-27
**Status:** Planned

**Decision:** Update GPT-4o-mini extraction prompt to extract URLs from homework items. Add `url` column to `homework` table.

**Reason:** Lesson files contain YouTube links and website URLs in homework sections. Current pipeline loses them. URLs confirmed present in real files.

**JSON shape update:**
```json
{ "description": "string", "due_date": "YYYY-MM-DD or null", "url": "string or null" }
```
