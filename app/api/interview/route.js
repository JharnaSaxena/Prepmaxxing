import { NextResponse } from "next/server";
import { currentUser, requireUser } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { askAI } from "../../../lib/ai";
import { jsonError, readJson } from "../../../lib/http";
import { appendAuditEvent } from "../../../lib/audit";
import { parseJsonObject, validateResumeEvidence } from "../../../lib/evidence";
import { seeds } from "../../../lib/catalogue";
import { technicalOpening, behavioralOpening, scoreSystemDesign, calculateReadiness, chatTurn, codeResults, completeInterview, complexityReview, createInterview, getOwnedInterview, persistSnapshot, scoreConversation } from "../../../lib/interview";

export const runtime = "nodejs";
export const maxDuration = 60;

function stateFrom(row) {
  const data = typeof row.interview_data === "string" ? JSON.parse(row.interview_data) : (row.interview_data || {});
  return { ...data, events: Array.isArray(row.events) ? row.events : data.events || [], submissions: Array.isArray(row.submissions) ? row.submissions : [] };
}

function studentSnapshot(snapshot, row) {
  const safe = { ...snapshot, phase: row.phase, integrityFlags: row.integrity_flags, approved: Boolean(row.report_approved) };
  const publicQuestion = (question) => {
    if (!question) return question;
    const { reference_solution, hidden_test_cases, ...publicFields } = question;
    publicFields.test_cases = (question.test_cases || []).filter((test) => !test.hidden);
    return publicFields;
  };
  for (const key of ["dsaQuestions", "domainQuestions"]) safe[key] = (safe[key] || []).map(publicQuestion);
  if (safe.repoChallenge) {
    const { reference_solution, test_cases, ...publicChallenge } = safe.repoChallenge;
    safe.repoChallenge = publicChallenge;
  }
  safe.repoFixResults = (safe.repoFixResults || []).filter((result) => !result.hidden).map(({ hidden, ...result }) => result);
  safe.submissions = (safe.submissions || []).map((item) => ({ ...item, results: (item.results || []).filter((result) => !result.hidden).map(({ hidden, ...result }) => result) }));
  for (const phase of ["dsa", "domain"]) safe.codeResults = { ...safe.codeResults, [phase]: (safe.codeResults?.[phase] || []).filter((result) => !result.hidden).map(({ hidden, ...result }) => result) };
  safe.events = (safe.events || []).map((item) => {
    const { score, readinessScore, ...event } = item;
    return event;
  });
  if (!row.report_approved) {
    delete safe.roundScores;
    delete safe.finalScore;
    delete safe.readiness;
    if (safe.resumeReport && typeof safe.resumeReport === "object") {
      const { score, ...screening } = safe.resumeReport;
      safe.resumeReport = screening;
    }
    if (safe.repoEvaluation && typeof safe.repoEvaluation === "object") {
      const { score, ...evaluation } = safe.repoEvaluation;
      safe.repoEvaluation = evaluation;
    }
    if (safe.systemDesignReview && typeof safe.systemDesignReview === "object") {
      const { score, ...review } = safe.systemDesignReview;
      safe.systemDesignReview = review;
    }
  }
  return safe;
}

function activeQuestion(snapshot, phase) {
  return phase === "dsa" ? snapshot.dsaQuestions?.[snapshot.activeDsa || 0] : snapshot.domainQuestions?.[snapshot.activeDomain || 0];
}

export async function GET(request) {
  try {
    const user = requireUser(await currentUser());
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      const { rows } = await query(`SELECT a.id,ri.interview_data,ri.phase,ri.events,ri.submissions,ri.integrity_flags
        FROM attempts a JOIN LATERAL (SELECT * FROM repoready_interviews WHERE attempt_id=a.id ORDER BY updated_at DESC LIMIT 1) ri ON TRUE
        WHERE a.student_id=$1 AND (a.status='in_progress' OR ri.interview_data->>'cancelled'='true') ORDER BY a.started_at DESC LIMIT 1`, [user.id]);
      if (!rows[0]) return NextResponse.json({ interview: null });
      return NextResponse.json({ interview: { id: rows[0].id, ...studentSnapshot(stateFrom(rows[0]), rows[0]) } });
    }
    const row = await getOwnedInterview(user, id);
    return NextResponse.json({ interview: { id, ...studentSnapshot(stateFrom(row), row) } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request) {
  try {
    const user = requireUser(await currentUser());
    if (user.role !== "student") throw Object.assign(new Error("Student access is required for interview rounds."), { status: 403 });
    const body = await readJson(request);
    if (body.action === "start") return NextResponse.json({ interview: await createInterview(user, body.track, String(body.focusSkill || "").slice(0, 120)) }, { status: 201 });
    const id = String(body.attemptId || "");
    if (!id) throw Object.assign(new Error("Interview ID is required."), { status: 400 });
    const row = await getOwnedInterview(user, id);
    const old = stateFrom(row);
    if (old.cancelled && body.action !== "resume") throw Object.assign(new Error("This interview is paused for placement review. Resume the same attempt to continue."), { status: 409 });
    if (old.paused && body.action !== "resume") throw Object.assign(new Error("This interview is paused after a tab visibility change. Resume when ready."), { status: 409 });
    const done = new Set(old.completedRounds || []);
    const action = body.action;
    const phase = body.payload?.phase;
    if (action === "resume_screen" && done.has(1)) throw Object.assign(new Error("Resume screening is already complete for this attempt."), { status: 409 });
    if (["run_code", "complexity_review", "next_question"].includes(action)) {
      const round = phase === "domain" ? 3 : 2;
      if (round > 2 && !done.has(2)) throw Object.assign(new Error("Complete the DSA round before opening role-specific coding."), { status: 409 });
      if (round === 2 && !done.has(1)) throw Object.assign(new Error("Complete resume screening before starting DSA."), { status: 409 });
      if (done.has(round)) throw Object.assign(new Error("This coding round is already complete."), { status: 409 });
    }
    if (action === "demo_solution" && (process.env.DEMO_MODE !== "true" || !old.demoMode)) throw Object.assign(new Error("Sample solutions are only available when demo mode is enabled."), { status: 403 });
    if (["repo_load", "repo_verify", "repo_submit", "copilot_chat"].includes(action) && !done.has(2)) throw Object.assign(new Error("Complete the DSA round before starting the role studio."), { status: 409 });
    if (action === "technical_open" && !done.has(3)) throw Object.assign(new Error("Complete the role studio before opening the technical interview."), { status: 409 });
    if (action === "technical_chat" && !done.has(3)) throw Object.assign(new Error("Complete the role studio before starting the technical interview."), { status: 409 });
    if (action === "behavioral_chat" && !done.has(4)) throw Object.assign(new Error("Complete the AI technical round before starting the behavioral round."), { status: 409 });
    const next = { ...old };
    const payload = body.payload || {};
    let responseData = {};
    let event = { type: body.action || "interview_action" };

    if (body.action === "resume_screen") {
      const resume = String(payload.resume || "").slice(0, 18000);
      const jobDescription = String(payload.jobDescription || "").slice(0, 14000);
      if (resume.trim().length < 30 || jobDescription.trim().length < 30) throw Object.assign(new Error("Add a resume and job description with enough detail to compare."), { status: 400 });
      const { rows: resumeRows } = await query("INSERT INTO resumes(student_id,raw_text,parsed_json,is_synthetic) VALUES($1,$2,$3::jsonb,FALSE) RETURNING id", [user.id, resume, JSON.stringify({ source: "candidate-provided text" })]);
      const report = await askAI("Compare only the provided resume and job description. Never invent candidate facts. Return JSON only with keys: score (integer 0-100), summary (string), matches (array of objects with requirement and resumeEvidence), weak_points (array of objects with requirement, status='absent|unclear', and improvement). Every item must cite only supplied text.", `Role: ${next.track}\nJob description:\n${jobDescription}\nResume:\n${resume}`);
      let parsed;
      try { parsed = validateResumeEvidence(parseJsonObject(report), resume, jobDescription); }
      catch { parsed = { score: 0, summary: "The AI screening response could not be safely parsed. Please retry in a moment.", matches: [], weak_points: [] }; }
      next.resumeText = resume; next.jobDescription = jobDescription; next.resumeReport = parsed; next.roundScores = { ...next.roundScores, 1: Number(parsed.score) || 0 };
      next.completedRounds = [...new Set([...(next.completedRounds || []), 1])]; next.phase = 2;
      event = { type: "resume_screen_completed", resumeId: resumeRows[0].id, score: next.roundScores[1] };
      const { score: privateScreeningScore, ...publicReport } = parsed;
      responseData = { report: publicReport };
    } else if (body.action === "run_code") {
      const phase = payload.phase === "domain" ? "domain" : "dsa";
      const question = activeQuestion(next, phase);
      if (!question) throw Object.assign(new Error("No active coding question was found."), { status: 400 });
      const code = String(payload.code || "").slice(0, 16000);
      if (!code.trim()) throw Object.assign(new Error("Write a solution before running it."), { status: 400 });
      const results = await codeResults(code, payload.language || "python", question.test_cases || []);
      next.code = code; next.codeResults = { ...(next.codeResults || {}), [phase]: results };
      next.submissions = [...(next.submissions || []), { phase, questionId: question.id, language: payload.language || "python", code, results, at: new Date().toISOString() }].slice(-30);
      event = { type: "code_executed", phase, questionId: question.id, passed: results.filter((item) => item.passed).length, total: results.length };
      responseData = { results };
    } else if (body.action === "demo_solution") {
      if (payload.kind === "repo") {
        if (!next.repoChallenge?.reference_solution) throw Object.assign(new Error("A sample patch is not available."), { status: 404 });
        responseData = { solution: next.repoChallenge.reference_solution };
        event = { type: "demo_repo_solution_requested" };
      } else {
      const phase = payload.phase === "domain" ? "domain" : "dsa";
      const question = activeQuestion(next, phase);
      if (!question?.reference_solution) throw Object.assign(new Error("A sample solution is not available for this prompt."), { status: 404 });
      responseData = { solution: question.reference_solution };
      event = { type: "demo_solution_requested", phase, questionId: question.id };
      }
    } else if (body.action === "complexity_review") {
      const question = activeQuestion(next, payload.phase === "domain" ? "domain" : "dsa");
      const review = await complexityReview({ role: next.track, question: question?.description || "", code: String(payload.code || next.code || ""), timeClaim: String(payload.timeClaim || ""), spaceClaim: String(payload.spaceClaim || ""), results: payload.results || [] });
      next.complexityReviews = { ...(next.complexityReviews || {}), [question?.id || "current"]: review };
      next.complexityReview = review;
      event = { type: "complexity_assessed", phase: payload.phase || "dsa" };
      responseData = { review };
    } else if (body.action === "next_question") {
      const phase = payload.phase === "domain" ? "domain" : "dsa";
      const current = activeQuestion(next, phase);
      if (!current || !(next.submissions || []).some((item) => item.phase === phase && item.questionId === current.id)) throw Object.assign(new Error("Run your current question before moving to the next one."), { status: 409 });
      const currentIndex = phase === "dsa" ? next.activeDsa || 0 : next.activeDomain || 0;
      const followingIndex = currentIndex + 1;
      const total = phase === "dsa" ? 3 : 2;
      if (followingIndex >= total) throw Object.assign(new Error("That is the final coding question in this round."), { status: 409 });
      const latest = [...(next.submissions || [])].reverse().find((item) => item.phase === phase && item.questionId === current.id);
      const passed = Boolean(latest?.results?.length && latest.results.every((result) => result.passed));
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(next.questionStartedAt || Date.now()).getTime()) / 1000));
      if (phase === "dsa") {
        const used = new Set((next.dsaQuestions || []).slice(0, followingIndex).map((question) => question.id));
        const pool = (next.dsaPoolIds || []).map((id) => seeds.DSA_QUESTIONS.find((question) => question.id === id)).filter((question) => question && !used.has(question.id));
        const targetRank = Math.max(1, Math.min(3, Number(current.difficulty_rank || 1) + (passed && elapsedSeconds <= 600 ? 1 : -1)));
        const selected = pool.sort((a, b) => Math.abs(Number(a.difficulty_rank || 1) - targetRank) - Math.abs(Number(b.difficulty_rank || 1) - targetRank))[0];
        if (selected) next.dsaQuestions[followingIndex] = selected;
        responseData.adaptiveHint = passed ? null : current.hint || "Review the edge cases and complexity, then try the next one.";
        responseData.adaptive = { previousPassed: passed, elapsedSeconds, targetDifficulty: targetRank };
      }
      if (phase === "domain") next.domainQuestions[followingIndex] = next.domainQuestions[followingIndex];
      if (phase === "dsa") next.activeDsa = followingIndex;
      if (phase === "domain") next.activeDomain = followingIndex;
      next.questionStartedAt = new Date().toISOString();
      next.code = "";
      event = { type: "coding_question_advanced", phase, previousQuestionId: current.id, nextQuestionId: activeQuestion(next, phase)?.id, previousPassed: passed, elapsedSeconds, adaptedDifficulty: responseData.adaptive?.targetDifficulty || null };
    } else if (body.action === "complete_round") {
      const round = Number(payload.round);
      if (![1, 2, 3, 4, 5].includes(round)) throw Object.assign(new Error("Unknown interview round."), { status: 400 });
      if (round > 1 && !(next.completedRounds || []).includes(round - 1)) throw Object.assign(new Error("Complete the previous interview round first."), { status: 409 });
      if (round === 2 || round === 3) {
        const key = round === 2 ? "dsa" : "domain";
        const questionSet = round === 2 ? next.dsaQuestions || [] : next.domainQuestions || [];
        const submitted = new Set((next.submissions || []).filter((item) => item.phase === key).map((item) => item.questionId));
        if (questionSet.some((question) => !submitted.has(question.id))) throw Object.assign(new Error(`Run and submit code for all ${questionSet.length} ${key === "dsa" ? "DSA" : "role-specific"} questions first.`), { status: 400 });
        if (round === 2 && questionSet.some((question) => !next.complexityReviews?.[question.id])) throw Object.assign(new Error("Submit explicit time and space complexity claims for all three DSA questions, then review each one with Nova."), { status: 400 });
        if (round === 3 && (!next.repoEvaluation || !next.repoNotes?.trim() || !next.repoVerifiedFix)) throw Object.assign(new Error("Find the bug, submit your investigation, and pass the patch checks before continuing."), { status: 400 });
        if (round === 3 && next.track === "sde" && !String(payload.systemDesign || "").trim()) throw Object.assign(new Error("Complete the SDE system design response before moving on."), { status: 400 });
        const submissions = (next.submissions || []).filter((item) => item.phase === key && questionSet.some((question) => question.id === item.questionId));
        const totalTests = submissions.flatMap((item) => item.results || []);
        const passRate = totalTests.length ? totalTests.filter((item) => item.passed).length / totalTests.length : 0;
        const complexityPoints = round === 2 && next.complexityReviews && Object.keys(next.complexityReviews).length >= questionSet.length ? 15 : 0;
        const baseScore = Math.round(passRate * 75 + complexityPoints + (payload.explanation?.trim() ? 10 : 0));
        let roundScore = round === 3 ? Math.round(baseScore * 0.5 + (Number(next.repoEvaluation?.score) || 0) * 0.3 + (Number(next.repoCollaborationScore) || 0) * 0.2) : baseScore;
        if (round === 3 && next.track === "sde") {
          next.systemDesignAnswer = String(payload.systemDesign).slice(0, 6000);
          next.systemDesignReview = await scoreSystemDesign(next.systemDesignAnswer, next.designQuestion?.prompt || "Design a production system for the selected role.");
          roundScore = Math.round(roundScore * 0.8 + next.systemDesignReview.score * 0.2);
        }
        next.roundScores = { ...next.roundScores, [round]: roundScore };
      }
      if (round === 1 && !next.resumeReport) throw Object.assign(new Error("Complete resume screening before finishing Round 1."), { status: 409 });
      if (round === 4 || round === 5) {
        const kind = round === 4 ? "technical" : "behavioral";
        if (!(next.conversations?.[kind] || []).some((turn) => turn.role === "user")) throw Object.assign(new Error("Share at least one answer with Nova before finishing this conversation round."), { status: 400 });
        const scored = await scoreConversation(kind, next.conversations?.[kind] || []);
        next.roundScores = { ...next.roundScores, [round]: scored.score };
        responseData.scoreDetail = scored;
        if (round === 4) {
          const opening = await behavioralOpening(next);
          next.conversations = { ...(next.conversations || {}), behavioral: [{ role: "assistant", content: opening }] };
          event.adaptiveBehavioralOpening = true;
        }
      }
      next.completedRounds = [...new Set([...(next.completedRounds || []), round])].sort();
      next.phase = Math.min(6, round + 1);
      event = { type: "interview_round_completed", round, score: next.roundScores[round] ?? null };
      responseData.roundScores = next.roundScores;
    } else if (["technical_chat", "behavioral_chat", "copilot_chat"].includes(body.action)) {
      const kind = { technical_chat: "technical", behavioral_chat: "behavioral", copilot_chat: "copilot" }[body.action];
      const message = String(payload.message || "").trim();
      if (!message) throw Object.assign(new Error("Write a message first."), { status: 400 });
      const repoEvidence = (next.repoFiles || []).map((file) => `${file.path}\n${file.content}`).join("\n\n").slice(0, 18000);
      const question = activeQuestion(next, payload.phase === "domain" ? "domain" : "dsa");
      const codeEvidence = payload.phase ? `Problem: ${question?.title || ""}\n${question?.description || ""}\nCandidate code draft:\n${String(payload.code || "").slice(0, 12000)}` : "";
      const reply = await chatTurn(kind, next, message, [codeEvidence, repoEvidence].filter(Boolean).join("\n\n").slice(0, 20000));
      if (kind === "copilot" && next.repoStartedAt) {
        const elapsed = Math.max(0, Math.floor((Date.now() - new Date(next.repoStartedAt).getTime()) / 1000));
        const specificity = /\b(src\/|\.py|\.js|\.ts|line\s+\d+|function|class)\b/i.test(message) ? 20 : 0;
        const quality = Math.min(100, Math.round(35 + specificity + (repoEvidence ? 25 : 0) + (message.length > 30 ? 20 : 0)));
        await query("INSERT INTO bug_hunt_prompts(attempt_id,prompt,quality_score,verified_fix,elapsed_seconds) VALUES($1,$2,$3,FALSE,$4)", [id, message.slice(0, 5000), quality, elapsed]);
      }
      event = { type: "interviewer_message", kind };
      responseData = { reply, conversation: next.conversations?.[kind] || [] };
    } else if (body.action === "repo_load") {
      const challenge = next.repoChallenge;
      if (!challenge || !Array.isArray(challenge.files) || challenge.files.length === 0) throw Object.assign(new Error("Repository challenge is not available."), { status: 400 });
      const files = challenge.files.map((file) => ({ path: file.path, content: String(file.content || "").slice(0, 9000) }));
      next.repoFiles = files;
      if (!next.repoStartedAt) next.repoStartedAt = new Date().toISOString();
      event = { type: "repo_challenge_opened", repo: challenge.repo, files: files.map((file) => file.path), source: "curated" };
      const { reference_solution, test_cases, ...publicChallenge } = challenge;
      responseData = { files, challenge: publicChallenge, startedAt: next.repoStartedAt };
    } else if (body.action === "repo_verify") {
      if (!next.repoStartedAt || !(next.repoFiles || []).length) throw Object.assign(new Error("Load the repository challenge first."), { status: 409 });
      if (Date.now() - new Date(next.repoStartedAt).getTime() > 30 * 60 * 1000) throw Object.assign(new Error("The 30-minute repository investigation window has ended."), { status: 409 });
      const code = String(payload.code || "").slice(0, 16000);
      if (!code.trim()) throw Object.assign(new Error("Write your patched repository code before running checks."), { status: 400 });
      const results = await codeResults(code, "python", next.repoChallenge?.test_cases || []);
      next.repoPatch = code;
      next.repoFixResults = results;
      next.repoVerifiedFix = results.length > 0 && results.every((result) => result.passed);
      await query("UPDATE bug_hunt_prompts SET verified_fix=$2 WHERE attempt_id=$1", [id, next.repoVerifiedFix]);
      event = { type: "repo_patch_verified", passed: results.filter((result) => result.passed).length, total: results.length, verified: next.repoVerifiedFix };
      responseData = { results: results.filter((result) => !result.hidden).map(({ hidden, ...result }) => result), verified: next.repoVerifiedFix };
    } else if (body.action === "repo_submit") {
      next.repoNotes = String(payload.notes || "").slice(0, 8000);
      if (!next.repoNotes.trim()) throw Object.assign(new Error("Write what you found before submitting the repository investigation."), { status: 400 });
      if (!next.repoStartedAt || !(next.repoFiles || []).length) throw Object.assign(new Error("Load the repository before submitting your investigation."), { status: 409 });
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(next.repoStartedAt).getTime()) / 1000));
      if (elapsed > 30 * 60) throw Object.assign(new Error("The 30-minute repository investigation window has ended."), { status: 409 });
      if (!next.repoVerifiedFix) throw Object.assign(new Error("Run your patch against the visible and hidden repository checks before submitting."), { status: 409 });
      const repoEvidence = (next.repoFiles || []).map((file) => `${file.path}\n${file.content}`).join("\n\n").slice(0, 18000);
      const evaluation = await askAI("Assess the candidate's repository bug investigation using only the supplied repository excerpts and their notes. Do not claim a real bug if unsupported. Return JSON only with score (0-100), findings array, evidence array with exact file/line references when available, and uncertainty string. If excerpts do not establish a real defect, mark it uncertain and do not treat it as verified.", `Repo: ${next.repoChallenge?.repo}\nExcerpts:\n${repoEvidence}\nCandidate notes:\n${next.repoNotes}`);
      try { next.repoEvaluation = JSON.parse(evaluation); } catch { next.repoEvaluation = { score: 0, findings: [], evidence: [], uncertainty: evaluation }; }
      next.roundScores = { ...next.roundScores, 3: Math.round((next.roundScores?.[3] || 0) * 0.6 + (Number(next.repoEvaluation.score) || 0) * 0.4) };
      const chatTurns = (next.conversations?.copilot || []).filter((turn) => turn.role === "user");
      const specificPrompt = chatTurns.some((turn) => /\b(src\/|\.py|\.js|\.ts|line\s+\d+|function|class)\b/i.test(turn.content || ""));
      const collaborationScore = Math.min(100, Math.round((chatTurns.length ? 35 : 0) + (specificPrompt ? 25 : 0) + (next.repoVerifiedFix ? 40 : 0)));
      next.repoCollaborationScore = collaborationScore;
      await query("INSERT INTO bug_hunt_prompts(attempt_id,prompt,quality_score,verified_fix,elapsed_seconds) VALUES($1,$2,$3,TRUE,$4)", [id, next.repoNotes.slice(0, 5000), collaborationScore, elapsed]);
      event = { type: "repo_investigation_submitted", repo: next.repoChallenge?.repo, score: next.repoEvaluation.score };
      responseData = { evaluation: next.repoEvaluation };
    } else if (body.action === "technical_open") {
      const turns = next.conversations?.technical || [];
      if (!next.technicalOpened && !turns.some((turn) => turn.role === "user")) {
        const { opening, evidence } = await technicalOpening(next);
        next.conversations = { ...(next.conversations || {}), technical: [{ role: "assistant", content: opening }] };
        next.technicalEvidence = evidence;
        next.technicalOpened = true;
        event = { type: "technical_interview_opened", basedOnEvidence: Boolean(evidence), evidence: evidence.slice(0, 800) };
      } else { next.technicalOpened = true; event = { type: "technical_interview_resumed" }; }
      responseData = { opening: next.conversations?.technical?.[0]?.content || "" };
    } else if (body.action === "tab_switch") {
      next.tabSwitchCount = Number(next.tabSwitchCount || 0) + 1; next.paused = true; next.cancelled = false;
      event = { type: "browser_tab_became_hidden", integrityFlag: next.tabSwitchCount, interviewPausedForReview: true, requiresHumanReview: true };
      responseData = { alarm: true, paused: true, cancelled: false };
    } else if (body.action === "camera_event") {
      next.cameraFlags = Number(next.cameraFlags || 0) + (payload.kind === "present" ? 0 : 1);
      event = { type: "camera_presence_check", kind: String(payload.kind || "unknown"), faceCount: Number(payload.count) || 0 };
    } else if (body.action === "paste_event") {
      const phase = payload.phase === "domain" ? "domain" : "dsa";
      if (!(done.has(1) && !done.has(2) && phase === "dsa") && !(done.has(2) && !done.has(3) && phase === "domain")) throw Object.assign(new Error("Paste review events are only recorded during an active coding round."), { status: 409 });
      const characters = Math.max(0, Math.min(12000, Number(payload.characters) || 0));
      if (characters < 120) throw Object.assign(new Error("This paste was too small to record as a review note."), { status: 400 });
      next.pasteFlags = Number(next.pasteFlags || 0) + 1;
      event = { type: "large_code_paste", phase, characters, reviewOnly: true };
      responseData = { reviewNotice: "A large paste was recorded as context for placement review; it is not an automatic misconduct finding." };
    } else if (body.action === "typing_event") {
      const phase = payload.phase === "domain" ? "domain" : "dsa";
      if (!(done.has(1) && !done.has(2) && phase === "dsa") && !(done.has(2) && !done.has(3) && phase === "domain")) throw Object.assign(new Error("Typing review events are only recorded during an active coding round."), { status: 409 });
      const question = activeQuestion(next, phase);
      const flagged = new Set(next.typingFlaggedQuestions || []);
      if (!question || flagged.has(question.id)) { responseData = { reviewNotice: "A typing-pattern note has already been recorded for this question." }; }
      else {
        const characters = Math.max(0, Math.min(12000, Number(payload.characters) || 0));
        if (characters < 100) throw Object.assign(new Error("This edit was too small to record as a review note."), { status: 400 });
        next.typingFlags = Number(next.typingFlags || 0) + 1;
        next.typingFlaggedQuestions = [...flagged, question.id];
        event = { type: "unusually_large_code_edit", phase, questionId: question.id, characters, reviewOnly: true };
        responseData = { reviewNotice: "A large code edit was recorded as context for placement review. Typing pace is an imperfect signal and does not establish misconduct." };
      }
    } else if (body.action === "resume") {
      next.paused = false; next.cancelled = false;
      event = { type: "interview_resumed_after_review_notice" };
    } else if (body.action === "finish") {
      if (next.paused) throw Object.assign(new Error("Resume the interview before submitting the report."), { status: 409 });
      const result = await completeInterview(user, id, next);
      next.reportSubmitted = true; next.finalScore = result.score; next.phase = 6;
      event = { type: "interview_report_submitted", score: result.score, requiresHumanApproval: true };
      responseData = { submitted: true, requiresHumanApproval: true };
    } else if (body.action === "set_context") {
      next.candidateContext = String(payload.context || "").slice(0, 8000);
      event = { type: "candidate_context_updated" };
    } else {
      throw Object.assign(new Error("That interview action is not supported."), { status: 400 });
    }

    const saved = await persistSnapshot(user, id, row, next, event);
    if (!row.report_approved) {
      delete responseData.roundScores;
      delete responseData.scoreDetail;
      if (responseData.evaluation) { const { score, ...evaluation } = responseData.evaluation; responseData.evaluation = evaluation; }
      if (responseData.results) responseData.results = responseData.results.filter((result) => !result.hidden).map(({ hidden, ...result }) => result);
    }
    return NextResponse.json({ interview: studentSnapshot(saved, { phase: saved.phase, integrity_flags: Number(saved.tabSwitchCount || 0) + Number(saved.cameraFlags || 0) + Number(saved.pasteFlags || 0) + Number(saved.typingFlags || 0), report_approved: false }), ...responseData });
  } catch (error) { return jsonError(error); }
}
