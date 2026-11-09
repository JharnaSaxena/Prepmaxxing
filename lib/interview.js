import { randomUUID, createHash } from "node:crypto";
import { query } from "./db";
import { appendAuditEvent } from "./audit";
import { askAI, NOVA_PROMPT } from "./ai";
import { seeds, bugHunts, ensureCatalogues } from "./catalogue";
import { exactEvidence, parseJsonObject } from "./evidence";

export const ROUND_NAMES = ["Resume screening", "DSA coding", "Role-specific studio", "AI technical interview", "Behavioral interview"];
const weights = { 1: 15, 2: 25, 3: 30, 4: 15, 5: 10 };

export async function createInterview(user, track, focusSkill = "") {
  await ensureCatalogues();
  const normalized = Object.hasOwn({ machine_learning: 1, full_stack: 1, sde: 1, data_engineering: 1 }, track) ? track : (user.track || "sde");
  const id = randomUUID();
  const interviewId = randomUUID();
  const job = seeds.JOB_CATALOGUE.find((item) => item.track === normalized);
  await query("INSERT INTO attempts(id,student_id,job_id,track,status,is_synthetic) VALUES($1,$2,$3,$4,'in_progress',FALSE)", [id, user.id, job?.id || null, normalized]);
  const repo = bugHunts[normalized] || bugHunts.sde;
  const rank = (question) => createHash("sha256").update(`${id}:${question.id}`).digest("hex");
  const focus = String(focusSkill || "").toLowerCase();
  const relevance = (question) => focus ? (question.title + " " + question.description).toLowerCase().includes(focus) ? 0 : 1 : 1;
  const dsaQuestions = [...seeds.DSA_QUESTIONS].sort((a, b) => relevance(a) - relevance(b) || rank(a).localeCompare(rank(b))).slice(0, 3);
  const domainQuestions = [...(seeds.DOMAIN_QUESTIONS[normalized] || seeds.DOMAIN_QUESTIONS.sde)].sort((a, b) => relevance(a) - relevance(b) || rank(a).localeCompare(rank(b))).slice(0, 2);
  const demoMode = process.env.DEMO_MODE === "true";
  const sampleResume = "Synthetic demo resume\nPython, SQL, Git, and data structures\nBuilt a course analytics dashboard using React and PostgreSQL.\nCreated a batch ETL project with Python and validation checks.";
  const snapshot = { track: normalized, jobId: job?.id || null, demoMode, focusSkill: focusSkill || "", startedAt: new Date().toISOString(), questionStartedAt: new Date().toISOString(), dsaPoolIds: seeds.DSA_QUESTIONS.map((question) => question.id), completedRounds: [], roundScores: {}, resumeText: demoMode ? sampleResume : "", jobDescription: job?.jd_text || "", resumeReport: "", conversations: { technical: [{ role: "assistant", content: "Tell me about a technical project you built. What trade-off took the most thought?" }], behavioral: [{ role: "assistant", content: "Tell me about a time a project did not go to plan. What was your role, and what happened next?" }], copilot: [] }, repoStartedAt: null, repoChallenge: repo, repoFiles: [], repoNotes: "", repoPrompt: null, tabSwitchCount: 0, cameraFlags: 0, pasteFlags: 0, typingFlags: 0, paused: false, activeDsa: 0, activeDomain: 0, code: "", codeResults: {}, dsaQuestions, domainQuestions, designQuestion: normalized === "sde" ? seeds.SYSTEM_DESIGN : null, events: [] };
  await query(`INSERT INTO repoready_interviews(interview_id,student_id,attempt_id,phase,candidate_context,integrity_flags,events,submissions,interview_data)
    VALUES($1,$2,$3,1,'',0,'[]'::jsonb,'[]'::jsonb,$4::jsonb)`, [interviewId, user.id, id, JSON.stringify(snapshot)]);
  await appendAuditEvent({ type: "interview_started", track: normalized }, user.id, id);
  return { id, interviewId, ...snapshot };
}

export async function getOwnedInterview(user, id) {
  const { rows } = await query(`SELECT ri.interview_id,ri.phase,ri.candidate_context,ri.integrity_flags,ri.report_approved,ri.events,ri.submissions,ri.interview_data,ri.updated_at
    FROM repoready_interviews ri JOIN attempts a ON a.id=ri.attempt_id
    WHERE ri.attempt_id=$1 AND a.student_id=$2 ORDER BY ri.updated_at DESC LIMIT 1`, [id, user.id]);
  if (!rows[0]) throw Object.assign(new Error("Interview not found."), { status: 404 });
  return rows[0];
}

export async function persistSnapshot(user, attemptId, old, next, event) {
  const events = Array.isArray(old.events) ? old.events : [];
  const stamped = { ...event, at: new Date().toISOString() };
  events.push(stamped);
  next.events = events.slice(-500);
  const phase = Math.max(1, Math.min(6, Number(next.phase || old.phase || 1)));
  await query(`UPDATE repoready_interviews SET phase=$1,candidate_context=$2,integrity_flags=$3,
    events=$4::jsonb,submissions=$5::jsonb,interview_data=$6::jsonb,updated_at=NOW() WHERE interview_id=$7`,
  [phase, String(next.candidateContext || old.candidate_context || "").slice(0, 8000), Number(next.tabSwitchCount || 0) + Number(next.cameraFlags || 0) + Number(next.pasteFlags || 0) + Number(next.typingFlags || 0), JSON.stringify(next.events), JSON.stringify(next.submissions || []), JSON.stringify(next), old.interview_id]);
  if (event.type === "interview_resumed_after_review_notice") await query("UPDATE attempts SET status='in_progress' WHERE id=$1 AND status='cancelled'", [attemptId]);
  await appendAuditEvent(stamped, user.id, attemptId);
  return { ...next, events: next.events };
}

export async function codeResults(code, language, cases) {
  const key = process.env.ONLINECOMPILER_API_KEY;
  if (!key) throw Object.assign(new Error("Code execution is not configured. Add ONLINECOMPILER_API_KEY to the deployment environment."), { status: 503 });
  const lang = { python: 71, javascript: 63, java: 62, cpp: 54 }[language] || 71;
  const outputs = [];
  for (const test of cases || []) {
    try {
      const response = await fetch("https://api.onlinecompiler.io/api/judge0/submissions?wait=true&base64_encoded=false", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Auth-Token": key },
        body: JSON.stringify({ source_code: code, language_id: lang, stdin: test.input || "", expected_output: test.expected_output || "" }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Execution service returned ${response.status}`);
      const result = await response.json();
      const stdout = String(result.stdout || "").replace(/\r\n/g, "\n").trimEnd();
      const expected = String(test.expected_output || "").replace(/\r\n/g, "\n").trimEnd();
      outputs.push({ hidden: Boolean(test.hidden), passed: result.status?.id === 3 && stdout === expected, stdout, expected, stderr: result.stderr || result.compile_output || result.message || "", status: result.status?.description || "Unknown" });
    } catch (error) {
      outputs.push({ hidden: Boolean(test.hidden), passed: false, stdout: "", expected: test.hidden ? "" : test.expected_output || "", stderr: test.hidden ? "Hidden check failed." : error.message === "fetch failed" ? "The code runner is temporarily unavailable." : error.message, status: "Runner error" });
    }
  }
  return outputs;
}

export async function complexityReview({ role, question, code, timeClaim, spaceClaim, results }) {
  return askAI(`You are an evidence-only algorithm reviewer. Judge time and space complexity independently as CORRECT, INCORRECT, or UNCERTAIN. Inspect only the problem, visible source code, and candidate claims. State the candidate claim, complexity you infer from the code, and concise code-based reason. Treat runner results as execution evidence only, not complexity proof. If code or constraints are insufficient, say UNCERTAIN. Return a short clear review.`,
    `Role: ${role}\nProblem: ${question}\nCode:\n${code}\nCandidate time claim: ${timeClaim}\nCandidate space claim: ${spaceClaim}\nRunner results: ${JSON.stringify(results)}`);
}

export function roundEvidence(snapshot) {
  const lines = [];
  const questions = [...(snapshot.dsaQuestions || []), ...(snapshot.domainQuestions || [])];
  const latest = new Map();
  for (const item of snapshot.submissions || []) latest.set(item.questionId, item);
  for (const [questionId, item] of latest) {
    const question = questions.find((entry) => entry.id === questionId);
    const results = item.results || [];
    if (!question || !results.length) continue;
    const failed = results.filter((test) => !test.passed);
    lines.push(`${question.title}: ${results.length - failed.length}/${results.length} visible tests passed${failed[0] ? ` (first failure status: ${failed[0].status})` : ""}`);
  }
  for (const [questionId, review] of Object.entries(snapshot.complexityReviews || {})) lines.push(`Complexity review for ${questionId}: ${String(review).slice(0, 300)}`);
  for (const weak of (snapshot.resumeReport?.weak_points || []).slice(0, 4)) lines.push(`Resume gap (${weak.status}): ${weak.requirement}`);
  if (snapshot.repoEvaluation?.uncertainty) lines.push(`Repo investigation uncertainty: ${String(snapshot.repoEvaluation.uncertainty).slice(0, 300)}`);
  return lines.join("\n").slice(0, 3000);
}

export async function technicalOpening(snapshot) {
  const evidence = roundEvidence(snapshot);
  const fallback = snapshot.conversations?.technical?.[0]?.content || "Tell me about a technical project you built. What trade-off took the most thought?";
  if (!evidence) return { opening: fallback, evidence: "" };
  try {
    const opening = await askAI(`${NOVA_PROMPT}\nWrite ONLY the opening question for the technical interview of a ${snapshot.track} candidate. Target the single clearest weak spot in the evidence below, name what the evidence shows in a few words, and ask one concise, curious question about it. Do not claim anything beyond the evidence. If the evidence shows no weakness, ask about a design trade-off in code they wrote.`, `Evidence from earlier rounds:\n${evidence}`, { temperature: 0.4, maxTokens: 160 });
    return { opening, evidence };
  } catch { return { opening: fallback, evidence }; }
}

export async function chatTurn(kind, snapshot, message, evidence = "") {
  const conversations = snapshot.conversations || (snapshot.conversations = { technical: [], behavioral: [], copilot: [] });
  const turns = conversations[kind] || (conversations[kind] = []);
  const system = kind === "behavioral"
    ? `${NOVA_PROMPT}\nRun a behavioral interview using STAR. Ask one question at a time and follow up on actual examples. Do not infer personality or invent impact.`
    : kind === "copilot"
      ? `You are Nova's disclosed coding helper. Help the candidate reason through the supplied problem and code draft. If repository excerpts are present, analyze only those excerpts and never claim you inspected files or ran tests beyond them. Point to exact file/line evidence when possible, give a hint before a fix, and identify uncertainty. Do not provide hidden test results or invent code behavior.\n\nProblem, code draft, and supplied repository evidence:\n${evidence}`
      : `${NOVA_PROMPT}\nConduct a technical interview for ${snapshot.track}. Ask at most one concise follow-up, grounded only in the conversation and supplied evidence. Do not invent candidate facts or test outcomes.\nEvidence from earlier rounds (probe weak spots with it; never go beyond it):\n${snapshot.technicalEvidence || roundEvidence(snapshot) || "none recorded"}`;
  turns.push({ role: "user", content: message.slice(0, 6000) });
  const reply = await askAI(system, `Conversation so far:\n${JSON.stringify(turns.slice(-12))}\nLatest candidate message: ${message}`, { temperature: 0.55, maxTokens: 360 });
  turns.push({ role: "assistant", content: reply });
  return reply;
}

export async function scoreConversation(kind, conversation) {
  const rubric = kind === "behavioral" ? "STAR evidence: Situation, Task, Action, Result, clarity, reflection" : "Technical reasoning, correctness, tradeoffs, communication, acknowledgment of uncertainty";
  const result = await askAI(`Score only the candidate messages in the transcript against this rubric: ${rubric}. Return JSON only with integer score from 0 to 100, evidence array with transcript-backed reasons, and missing array. Do not infer unspoken facts.`, JSON.stringify(conversation));
  try { const parsed = JSON.parse(result); return { score: Math.max(0, Math.min(100, Number(parsed.score) || 0)), evidence: parsed.evidence || [], missing: parsed.missing || [] }; }
  catch { return { score: 0, evidence: [], missing: ["The scoring response was not valid JSON and needs human review."] }; }
}

export async function scoreSystemDesign(answer, prompt) {
  const rubric = ["requirements", "API or component boundaries", "data model", "scale and reliability", "trade-off"];
  try {
    const raw = await askAI("Evaluate this system-design response against the supplied prompt. Return JSON only: {criteria:[{criterion,evidence}]}. Evidence must be a short exact quote from the candidate answer, or an empty string. Do not award evidence for unstated details.", `PROMPT:\n${prompt}\nCANDIDATE ANSWER:\n${answer}`, { temperature: 0.1, maxTokens: 500 });
    const parsed = parseJsonObject(raw);
    const criteria = rubric.map((criterion) => {
      const item = (parsed.criteria || []).find((entry) => String(entry.criterion || "").toLowerCase().includes(criterion.split(" ")[0]));
      const evidence = String(item?.evidence || "").trim();
      return { criterion, evidence, verified: exactEvidence(answer, evidence) };
    });
    const score = Math.round(criteria.filter((item) => item.verified).length * 100 / rubric.length);
    return { score, criteria };
  } catch { return { score: 0, criteria: rubric.map((criterion) => ({ criterion, evidence: "", verified: false })), reviewNote: "The system-design evidence review needs a retry." }; }
}

export async function behavioralOpening(snapshot) {
  const conversation = snapshot.conversations?.technical || [];
  const candidateExamples = conversation.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n").slice(0, 5000);
  if (!candidateExamples.trim()) return "Tell me about a time you worked through a difficult situation with a teammate. What was your role?";
  try {
    return await askAI(`${NOVA_PROMPT}\nWrite one concise STAR-style behavioral interview opening. Ground its scenario in a concrete example the candidate actually mentioned. Do not infer impact, emotions, or facts. If their answer contains no specific example, ask a neutral prompt about one project they described.`, `Earlier candidate examples:\n${candidateExamples}`, { temperature: 0.35, maxTokens: 140 });
  } catch { return "Tell me about a time you worked through a difficult situation with a teammate. What was your role?"; }
}

export function calculateReadiness(scores, flags) {
  const dimensions = {};
  for (let round = 1; round <= 5; round++) dimensions[round] = Math.max(0, Math.min(100, Number(scores[round] || 0)));
  const integrity = Math.max(0, 100 - 20 * Math.max(0, Number(flags || 0)));
  const total = Object.entries(weights).reduce((sum, [round, weight]) => sum + dimensions[round] * weight / 100, 0) + integrity * 0.05;
  return { score: Math.round(total * 100) / 100, detail: { rounds: dimensions, integrity, weights, score: Math.round(total * 100) / 100 } };
}

export async function completeInterview(user, attemptId, snapshot) {
  const scores = snapshot.roundScores || {};
  if ([1, 2, 3, 4, 5].some((round) => !snapshot.completedRounds?.includes(round))) {
    throw Object.assign(new Error("Complete each of the five interview rounds before submitting your report."), { status: 400 });
  }
  // Paste, typing, and face-presence notes are review context; only recorded tab switches affect this small integrity component.
  const integrityFlags = Number(snapshot.tabSwitchCount || 0);
  const { score, detail } = calculateReadiness(scores, integrityFlags);
  const detailByRound = { 1: { summary: snapshot.resumeReport || "Resume screening complete" }, 2: { results: snapshot.codeResults?.dsa || [], complexity: snapshot.complexityReview || "" }, 3: { results: snapshot.codeResults?.domain || [], repoNotes: snapshot.repoNotes || "", systemDesign: snapshot.systemDesignReview || null }, 4: { conversation: snapshot.conversations?.technical || [] }, 5: { conversation: snapshot.conversations?.behavioral || [] }, readiness: detail };
  for (const [round, value] of Object.entries(scores)) {
    await query(`INSERT INTO round_scores(attempt_id,round_num,score,detail_json,is_synthetic) VALUES($1,$2,$3,$4::jsonb,FALSE)
      ON CONFLICT(attempt_id,round_num) DO UPDATE SET score=EXCLUDED.score,detail_json=EXCLUDED.detail_json`, [attemptId, Number(round), Number(value), JSON.stringify(detailByRound[round] || {})]);
  }
  const gapRows = [];
  for (const weak of snapshot.resumeReport?.weak_points || []) {
    const skill = String(weak.requirement || "").trim().slice(0, 120);
    if (skill) gapRows.push({ skill, severity: weak.status === "absent" ? "high" : "medium", evidence: [{ type: "resume_requirement", status: weak.status, requirement: skill }] });
  }
  for (const item of snapshot.submissions || []) {
    const failed = (item.results || []).filter((test) => !test.passed);
    if (!failed.length) continue;
    const question = [...(snapshot.dsaQuestions || []), ...(snapshot.domainQuestions || [])].find((entry) => entry.id === item.questionId);
    if (question) gapRows.push({ skill: question.title.slice(0, 120), severity: failed.length >= (item.results || []).length ? "high" : "medium", evidence: [{ type: "failed_test", question: question.title, failedTests: failed.map((test) => ({ expected: test.expected, actual: test.stdout, status: test.status })) }] });
  }
  for (const gap of gapRows) {
    const { rows: resourceRows } = await query("SELECT id FROM resources WHERE lower(skill)=lower($1) OR lower(title) LIKE lower($2) ORDER BY CASE WHEN lower(skill)=lower($1) THEN 0 ELSE 1 END LIMIT 1", [gap.skill, `%${gap.skill.split(" ")[0]}%`]);
    await query(`INSERT INTO skill_gaps(attempt_id,skill,severity,evidence_json,resource_id,is_synthetic) VALUES($1,$2,$3,$4::jsonb,$5,FALSE)
      ON CONFLICT(attempt_id,skill) DO UPDATE SET severity=EXCLUDED.severity,evidence_json=EXCLUDED.evidence_json,resource_id=EXCLUDED.resource_id`, [attemptId, gap.skill, gap.severity, JSON.stringify(gap.evidence), resourceRows[0]?.id || null]);
  }
  await query("UPDATE attempts SET readiness_score=$1,status='completed',completed_at=NOW() WHERE id=$2 AND student_id=$3", [score, attemptId, user.id]);
  await appendAuditEvent({ type: "interview_report_submitted", readinessScore: score, requiresHumanApproval: true }, user.id, attemptId);
  return { score, detail };
}
