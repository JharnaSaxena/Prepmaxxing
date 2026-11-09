# PrepMaxxing · React + Node

The production UI is a React application built with Next.js App Router. Route handlers run on Node.js and connect to the existing Neon Postgres tables. The former Streamlit files remain in the repository as a legacy reference; Vercel serves the Next.js app.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `AUTH_SECRET`, one or both of `GEMINI_API_KEY` / `GROQ_API_KEY`, and `ONLINECOMPILER_API_KEY`.
3. Use the existing Neon pooled Postgres URL with `sslmode=require`. The application normalizes the old SQLAlchemy URL prefix if one is used.
4. The existing migrations `001`–`003` are required; no migration is run automatically by the web app.
5. Run `npm install` and `npm run dev`.

`AUTH_SECRET` must be a random secret of at least 32 characters. Do not commit `.env` or paste secrets into source files. Vercel stores production credentials as sensitive environment variables.

## Features

- Student account creation and sign-in, with the existing scrypt password hashes preserved.
- Resume/JD evidence screening, job matches, a progress tracker, and role-specific recommendations.
- Five interview rounds: resume, three LeetCode-linked DSA tasks with explicit time/space review, two role coding tasks plus GitHub repo investigation, technical conversation, and STAR behavioral conversation. SDE also receives system design.
- OnlineCompiler.io code execution, Nova chat and browser speech, optional camera face-presence events, and tab-change alarm/pause with replay logging.
- Staff cohort analytics and a human report approval checkpoint.

The app uses the existing schema. Job and resource seed rows are marked synthetic. The camera check is opt-in and local to the browser; it does not identify phones. The app uses an original illustrated interviewer and does not clone an actor's likeness or voice.

## Vercel

The project uses the native Next.js framework on Vercel. Configure `DATABASE_URL`, `AUTH_SECRET`, at least one of `GEMINI_API_KEY` or `GROQ_API_KEY`, and `ONLINECOMPILER_API_KEY` in the Vercel project settings for Production, Preview, and Development as needed. Set `AI_PROVIDER=gemini` to prefer Gemini, or `AI_PROVIDER=groq` to prefer Groq. `OCR_SPACE_API_KEY` enables scanned-PDF OCR; Gemini is the fallback OCR provider. Scanned PDFs are transmitted to the configured OCR provider for extraction. `GITHUB_TOKEN` is optional for higher GitHub API limits. Browser speech works without a TTS credential.

## Free animated interviewer (added)

Nova is an original SVG character that lip-syncs to the browser's built-in speech voice (no paid avatar/video API). Rounds 4 and 5 also have a "Speak your answer" button using the browser's speech recognition (Chrome/Edge); typing always works. Round 4's opening question is generated from your Round 1–3 evidence (failed tests, complexity review, resume gaps).
