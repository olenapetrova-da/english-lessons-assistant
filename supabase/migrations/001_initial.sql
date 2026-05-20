-- Migration: 001_initial
-- Tables: processing_log, lessons, vocabulary, homework

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── processing_log ───────────────────────────────────────────────────────────
-- One row per Google Drive file seen by the intake workflow.
-- file_id is the Drive fileId and acts as the deduplication key.
CREATE TABLE processing_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id        text        NOT NULL UNIQUE,
  file_name      text,
  mime_type      text,
  web_view_link  text,
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'processing', 'done', 'error')),
  error_msg      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_processing_log_status     ON processing_log (status);
CREATE INDEX idx_processing_log_created_at ON processing_log (created_at DESC);

CREATE TRIGGER trg_processing_log_updated_at
  BEFORE UPDATE ON processing_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── lessons ──────────────────────────────────────────────────────────────────
-- One row per successfully processed lesson document.
CREATE TABLE lessons (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id      text        NOT NULL UNIQUE REFERENCES processing_log (file_id),
  topic        text,
  lesson_date  date,
  doc_url      text,
  raw_text     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_lessons_updated_at
  BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── vocabulary ───────────────────────────────────────────────────────────────
-- Words and phrases extracted by GPT-4o-mini per lesson.
CREATE TABLE vocabulary (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   uuid        NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  word        text        NOT NULL,
  definition  text,
  example     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vocabulary_lesson_id ON vocabulary (lesson_id);

-- ─── homework ─────────────────────────────────────────────────────────────────
-- Homework tasks extracted by GPT-4o-mini per lesson.
CREATE TABLE homework (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id    uuid        NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  description  text        NOT NULL,
  due_date     date,
  completed    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_homework_lesson_id ON homework (lesson_id);
