# English Lessons Assistant — Specification (v0.1.0-pre)

## Goal

Automate the capture and structuring of English lesson content. When a teacher drops a Google Doc into a designated Google Drive folder, the system automatically extracts the lesson topic, vocabulary, and homework into a Supabase database — without any manual steps.

---

## Architecture

```
Google Drive folder
       │  (push notification)
       ▼
Cloudflare Worker  ──────────────────────────────────────────────
  - Watches Drive changes feed                                   │
  - Filters to intake folder                                     │ POST /webhook (ENG1)
  - Deduplicates by fileId (48h KV cache)                       │
  - Forwards new files to n8n                                    │
                                                                  ▼
                                                          n8n ENG1 (Intake)
                                                            - Auth check
                                                            - Duplicate check (Supabase)
                                                            - Insert processing_log record
                                                            - Trigger ENG2
                                                                  │
                                                                  │ POST /webhook (ENG2)
                                                                  ▼
                                                          n8n ENG2 (Processor)
                                                            - Auth check
                                                            - Export Google Doc as plain text
                                                            - GPT-4o-mini extraction
                                                            - Write to Supabase tables
                                                            - Update processing_log status
                                                                  │
                                                                  ▼
                                                             Supabase DB
                                               (processing_log, lessons, vocabulary, homework)
                                                                  │
                                                                  │ HTTPS (Edge Function)
                                                                  ▼
                                                       Supabase Edge Function (lesson-api)
                                                            - Serves data to frontend
                                                            - Handles CORS
                                                            - ?action=lesson_prep
                                                            - ?action=vocabulary
                                                                  │
                                                                  ▼
                                                    Frontend (UI/english_lessons_assistant.html)
                                                       Standalone HTML — hosted on GitHub Pages
```

---

## Components

### Cloudflare Worker (`drive-watch.js`)

Watches Google Drive for changes and forwards new files to n8n.

**Endpoints:**
- `POST /drive/setup` — registers (or renews) the Google Drive push watch. Must be called manually on first deploy and before expiry (~7 days).
- `POST /drive/push` — receives push notifications from Google Drive (called by Google, not manually).
- `GET /drive/status` — returns current watch state from KV (no secrets exposed).

**What it watches:** The entire Drive changes feed, filtered client-side to files whose parent matches `INTAKE_FOLDER_ID`.

**What triggers a forward to n8n:**
- File is in the intake folder
- File is not deleted or trashed
- `fileId` is not in the Worker's 48-hour dedup cache (`recentEmitted`)

**What it does NOT watch:**
- Changes to files outside the intake folder (filtered out)
- Deletions and trashed files (skipped explicitly)

**KV state keys:** `folderId`, `pushUrl`, `pageToken`, `channelId`, `resourceId`, `channelToken`, `expirationMs`, `lastMessageNumber`, `lastMaxChangeTimeMs`, `recentEmitted` (map of fileId → timestamp), `inFlightUntilMs`

**Scheduled function:** `renewIfNeeded()` — renews the Drive watch when expiry is within 1 hour. Requires a Cloudflare cron trigger to run (not yet configured).

---

### n8n ENG1 — Intake (`ENG1-DRIVE-INTAKE`)

Receives file events from the Worker and gates them into the pipeline.

**Flow:**
1. Validate `x-worker-token` header against `N8N_SHARED_SECRET` → 403 if wrong
2. Query `processing_log` WHERE `file_id = incoming fileId`
3. If record found → respond `200 duplicate_ignored` (stop)
4. If not found → INSERT into `processing_log` with `status = pending`
5. POST to ENG2 webhook with `fileId`, `fileName`, `webViewLink`
6. Respond `200 new_file_accepted`

**Idempotency behaviour:** Once a `file_id` appears in `processing_log` (any status), ENG1 will never process it again — regardless of how many times the Worker sends it or whether the file is later edited.

---

### n8n ENG2 — Processor (`ENG2-LESSON-PROCESSOR`)

Reads the Google Doc, extracts structured lesson data via GPT-4o-mini, and writes it to Supabase.

**Flow:**
1. Validate `x-worker-token` header → stop if wrong
2. UPDATE `processing_log` SET `status = processing` WHERE `file_id = fileId`
3. Export Google Doc as plain text via Drive API (`/drive/v3/files/{id}/export?mimeType=text/plain`)
4. Send text to GPT-4o-mini with extraction prompt → returns JSON with `topic`, `lesson_date`, `vocabulary[]`, `homework[]`
5. Parse GPT response
6. INSERT into `lessons` (`file_id`, `topic`, `lesson_date`, `doc_url`, `raw_text`)
7. INSERT into `vocabulary` (one row per word) — runs in parallel with homework
8. INSERT into `homework` (one row per task) — runs in parallel with vocabulary
9. UPDATE `processing_log` SET `status = done` WHERE `file_id = fileId`

**GPT-4o-mini extraction prompt expects this JSON shape:**
```json
{
  "topic": "string",
  "lesson_date": "YYYY-MM-DD or null",
  "vocabulary": [
    { "word": "string", "definition": "string", "example": "string or null" }
  ],
  "homework": [
    { "description": "string", "due_date": "YYYY-MM-DD or null" }
  ]
}
```

---

## Database Schema

### `processing_log`
Tracks every file seen by the pipeline. `file_id` is the Google Drive file ID and is the deduplication key.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `file_id` | text | UNIQUE, not null |
| `file_name` | text | |
| `mime_type` | text | |
| `web_view_link` | text | |
| `status` | text | `pending` → `processing` → `done` / `error` |
| `error_msg` | text | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | auto-updated by trigger |

### `lessons`
One row per successfully processed lesson document.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `file_id` | text | UNIQUE, FK → `processing_log.file_id` |
| `topic` | text | extracted by GPT |
| `lesson_date` | date | extracted by GPT |
| `doc_url` | text | Google Doc link |
| `raw_text` | text | full plain-text export of the doc |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `vocabulary`
Words and phrases extracted per lesson.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `lesson_id` | uuid | FK → `lessons.id` CASCADE DELETE |
| `word` | text | not null |
| `definition` | text | |
| `example` | text | |
| `created_at` | timestamptz | |

### `homework`
Homework tasks extracted per lesson.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `lesson_id` | uuid | FK → `lessons.id` CASCADE DELETE |
| `description` | text | not null |
| `due_date` | date | |
| `completed` | boolean | default false |
| `created_at` | timestamptz | |

---

## Frontend

A standalone HTML file (`UI/english_lessons_assistant.html`) hosted on GitHub Pages. It calls the Supabase Edge Function directly — no backend server required.

## Supabase Configuration

### Row Level Security (RLS)
RLS is **disabled** on all four tables: `processing_log`, `lessons`, `vocabulary`, `homework`. Access is controlled at the Edge Function level instead.

### Edge Function: `lesson-api`
A Supabase Edge Function that serves lesson data to the frontend. It exists to handle CORS restrictions that would otherwise block direct browser calls to the Supabase REST API.

**JWT verification:** disabled on the function.

**Supported actions:**

| Query param | Description |
|---|---|
| `?action=lesson_prep` | Returns lesson data for the teacher's lesson prep view |
| `?action=vocabulary` | Returns vocabulary items for review |

---

## Current Assumptions and Limitations

### File processing scope
**Current behaviour:** Only new files are processed. A Google Doc is processed exactly once — the first time it appears in the folder. If the teacher edits the doc after processing, the changes are ignored.

**Open question:** Should edits to existing lesson docs trigger reprocessing? If yes, the `processing_log` idempotency check in ENG1 needs a rethink (e.g., check status = `done` and compare a content hash or `modifiedTime`).

### Drive watch expiry
The Google Drive push watch expires approximately every 7 days. The Worker has a `scheduled()` function to auto-renew, but a **Cloudflare cron trigger is not yet configured**. Until it is, `/drive/setup` must be called manually before expiry.

### ENG1 error handling
If ENG2 fails or is slow, n8n returns an error to ENG1 ("Trigger ENG2" node), which causes ENG1 to return a non-200 response to the Worker. The Worker then does not mark the file as emitted, leading to retry attempts on the next Drive push. Fixing this requires adding `Continue on Error` to the Trigger ENG2 node so ENG1 always responds 200 to the Worker.

### Supabase node filter limitation
The n8n Supabase node v1 `filterString` parameter works for SELECT (`getAll`) but not for UPDATE operations. The two UPDATE nodes in ENG2 ("set processing", "set done") currently use HTTP Request nodes as a workaround to call the Supabase REST API directly.

### GPT extraction quality
The OpenAI prompt was written generically. It needs tuning based on the actual format of the teacher's lesson documents.

---

## Open Questions — Scenarios to Clarify

The following questions were raised during development and need answers before the next iteration.

### 1. New files vs edits to existing files

Does the teacher:

- **A) Create a new Google Doc for each lesson** — current behaviour is correct; each doc is processed once and never revisited.
- **B) Edit the same doc after the lesson** (e.g. add vocabulary, correct homework after class) — current system silently ignores the update. The doc was already processed and `processing_log` blocks reprocessing.
- **C) Mix of both** — sometimes new docs, sometimes updates to existing ones.

If B or C: the idempotency logic in ENG1 needs to be extended. Options include:
- Re-process on every edit (remove the duplicate check, accept idempotency risk)
- Re-process only if `processing_log.status = done` AND Drive `modifiedTime` is newer than `lessons.updated_at`
- Add a manual "reprocess" trigger (e.g. a flag column in `processing_log`)

### 2. Document format and language

- Are lesson docs written in English, Ukrainian, Russian, or a mix?
- Is there a consistent structure (e.g. always has a "Vocabulary" section header, always has a "Homework" section)?
- Or is the format free-form and varies lesson by lesson?

This directly determines how reliable GPT extraction can be and whether the prompt needs rigid structure enforcement or flexible interpretation.

### 3. Lesson date source

- Does the doc contain an explicit date (e.g. in the title or first line)?
- Or should the lesson date default to the file's creation date in Drive?

### 4. Multiple students or one teacher–student pair?

- Is this for one teacher with one student, or will the folder eventually contain docs from multiple students?
- If multiple students: does vocabulary/homework need to be tagged by student?

### 5. What happens after extraction?

- Who consumes the data from Supabase? (A web app, a Telegram bot, a dashboard?)
- Is `completed` on the `homework` table updated manually or automatically?
- Is the `vocabulary` table used for flashcard-style review, or just as a reference log?
