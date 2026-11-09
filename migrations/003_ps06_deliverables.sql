CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS students (
    id BIGSERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'placement_officer', 'admin')),
    track TEXT,
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resumes (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES students(id),
    parsed_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_text TEXT NOT NULL DEFAULT '',
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    track TEXT NOT NULL,
    level TEXT NOT NULL,
    skills TEXT[] NOT NULL DEFAULT '{}',
    jd_text TEXT NOT NULL,
    embedding vector(384),
    is_synthetic BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    skill TEXT NOT NULL,
    url TEXT NOT NULL,
    hours INTEGER NOT NULL CHECK (hours > 0),
    description TEXT NOT NULL DEFAULT '',
    embedding vector(384),
    is_synthetic BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    student_id BIGINT NOT NULL REFERENCES students(id),
    job_id TEXT REFERENCES jobs(id),
    track TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    readiness_score NUMERIC(5,2),
    status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS round_scores (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    round_num INTEGER NOT NULL CHECK (round_num BETWEEN 1 AND 5),
    score NUMERIC(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(attempt_id, round_num)
);

CREATE TABLE IF NOT EXISTS skill_gaps (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    skill TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    evidence_json JSONB NOT NULL,
    resource_id TEXT REFERENCES resources(id),
    is_synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(attempt_id, skill)
);

CREATE TABLE IF NOT EXISTS bug_hunt_prompts (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL REFERENCES attempts(id),
    prompt TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    quality_score NUMERIC(5,2),
    verified_fix BOOLEAN NOT NULL DEFAULT FALSE,
    elapsed_seconds INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT REFERENCES students(id),
    attempt_id TEXT REFERENCES attempts(id),
    event_json JSONB NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approvals (
    id BIGSERIAL PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES attempts(id),
    approved_by BIGINT NOT NULL REFERENCES students(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE repoready_interviews
    ADD COLUMN IF NOT EXISTS student_id BIGINT REFERENCES students(id),
    ADD COLUMN IF NOT EXISTS attempt_id TEXT REFERENCES attempts(id);

CREATE INDEX IF NOT EXISTS jobs_track_level_idx ON jobs(track, level);
CREATE INDEX IF NOT EXISTS attempts_student_started_idx ON attempts(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS scores_attempt_round_idx ON round_scores(attempt_id, round_num);
CREATE INDEX IF NOT EXISTS gaps_attempt_skill_idx ON skill_gaps(attempt_id, skill);
CREATE INDEX IF NOT EXISTS audit_attempt_id_idx ON audit_log(attempt_id, id);
CREATE INDEX IF NOT EXISTS jobs_embedding_idx ON jobs USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS resources_embedding_idx ON resources USING hnsw (embedding vector_cosine_ops);

REVOKE UPDATE, DELETE ON audit_log FROM repoready_app;
