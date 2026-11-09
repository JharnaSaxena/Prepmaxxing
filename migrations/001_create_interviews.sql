CREATE TABLE IF NOT EXISTS repoready_interviews (
    interview_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    phase INTEGER NOT NULL,
    candidate_context TEXT NOT NULL DEFAULT '',
    integrity_flags INTEGER NOT NULL DEFAULT 0,
    report_approved BOOLEAN NOT NULL DEFAULT FALSE,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    submissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    interview_data JSONB NOT NULL DEFAULT '{}'::jsonb
);
