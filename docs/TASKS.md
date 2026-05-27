# Tasks

## In progress

- [ ] **Step 1** — Update ENG2 extraction prompt
  - Pass filename to GPT alongside doc text
  - Parse `lesson_date` and `homework_due_date` from filename patterns (see ADR-008)
  - Extract URLs from homework items (see ADR-010)
  - Add `file_type` field: `notes` / `homework` / `both`

- [ ] **Step 2** — Supabase schema changes
  - Add `homework_due_date` date column to `lessons`
  - Add `file_type` text column to `lessons`
  - Add `url` text column to `homework`
  - Write and run migration SQL

---

## Backlog

- [ ] **Step 3** — Reprocess existing files
  - Clear current data from `lessons`, `vocabulary`, `homework`
  - Reset `status` to `pending` in `processing_log` for all existing files
  - Re-trigger ENG2 for all files
  - Verify: dates, URLs, file_type extracted correctly

- [ ] **Step 4** — Google Calendar integration in Edge Function
  - Add `?action=next_lesson` to `lesson-api` (see ADR-009)
  - Query Google Calendar API for next upcoming English lesson event
  - Return: date, Meet link, event title
  - Add Google OAuth credentials to Edge Function secrets

- [ ] **Step 5** — Manual: test data after reprocessing
  - Check Supabase tables for correct dates, URLs, file_type values
  - Report extraction errors to Claude Code for prompt tuning

- [ ] **Step 6** — Rebuild frontend (Claude.ai, not Claude Code)
  - Tab 1 "Lesson prep": next lesson date + Meet link, previous lesson topic + doc link, vocabulary, homework with links
  - Tab 2 "All lessons": grouped by date, multiple files per date, expandable
  - Tab 3 "Vocabulary": search by topic

- [ ] **Step 7** — Deploy updated HTML to repo
  - GitHub Pages updates automatically on push

---

## Done

- [x] Cloudflare Worker deployed (reused PMI pattern, see ADR-001)
- [x] n8n ENG1 intake workflow built
- [x] n8n ENG2 processing workflow built
- [x] Supabase schema created — initial 4 tables
- [x] Supabase Edge Function `lesson-api` deployed (see ADR-006)
- [x] RLS disabled on all tables (see ADR-005)
- [x] Frontend `english-lessons.html` built — v1
- [x] Repo created and HTML committed to GitHub
- [x] GitHub Pages enabled
- [x] Architecture diagram created (`docs/architecture.svg`)
- [x] SPEC.md written and committed
- [x] Exposed service role key revoked and removed from repo
- [x] Cloudflare cron trigger configured for Drive watch auto-renewal (`0 */6 * * *`)
- [x] ENG2 Google Drive auth migrated from OAuth2 user credential to Service Account (see ADR-011)
- [x] Frontend Edge Function URL restored after over-broad git history purge
- [x] `help.md` created as project knowledge base (Drive watch expiry, Supabase UPDATE workaround, OAuth vs Service Account)
