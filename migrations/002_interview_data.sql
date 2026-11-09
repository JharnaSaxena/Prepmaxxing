ALTER TABLE repoready_interviews
    ADD COLUMN IF NOT EXISTS interview_data JSONB NOT NULL DEFAULT '{}'::jsonb;
