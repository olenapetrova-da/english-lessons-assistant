-- Migration: 002_add_lesson_fields
-- Adds homework_due_date and file_type to lessons; adds url to homework

ALTER TABLE lessons ADD COLUMN homework_due_date date;
ALTER TABLE lessons ADD COLUMN file_type text CHECK (file_type IN ('notes', 'homework', 'both'));

ALTER TABLE homework ADD COLUMN url text;
