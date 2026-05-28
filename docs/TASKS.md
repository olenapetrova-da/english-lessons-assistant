# Tasks

## In progress

---

## Backlog

- [ ] **Step 5** — Manual: verify data in Supabase (dates, URLs, file_type correct across all 6 lessons)

- [ ] **Step 6 verify** — Test rebuilt frontend in browser across all 3 tabs
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
- [x] ENG2 extraction prompt updated: filename passed to GPT, dates from filename, homework URLs, file_type (see ADR-008, ADR-010)
- [x] ENG2 null date fix: `?? undefined` on date fields in Supabase: insert lesson
- [x] ENG1 Trigger WF2: Continue on Error enabled — prevents retry loops on ENG2 failure
- [x] Supabase migration 002: added `homework_due_date`, `file_type` to lessons; `url` to homework
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
- [x] **Step 3** — All 6 files reprocessed with new ENG2 prompt; null date fix applied in Code node (delete null fields before Supabase insert)
- [x] **Step 4** — `?action=next_lesson` added to Edge Function; Google Calendar API via Service Account; returns date, Meet link, title
- [x] **Step 6** — Frontend rebuilt: 3 tabs (Lesson prep, All lessons, Vocabulary); next lesson card with Meet button; homework URLs; expandable all-lessons view grouped by date
