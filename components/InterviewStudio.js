"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

async function call(action, payload = {}, attemptId) {
  const response = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, payload, attemptId }), keepalive: action === "tab_switch" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "That interview step could not be saved.");
  return data;
}

const ROUND_TITLES = ["Resume review", "DSA trio", "Role studio", "AI technical", "Behavioral"];
const STARTER = "# Your solution here\n# Read input from stdin and print the requested output.\n";
const INITIAL_PROMPTS = {
  technical: "Tell me about a technical project you built. What trade-off took the most thought?",
  behavioral: "Tell me about a time a project did not go to plan. What was your role, and what happened next?",
};

export default function InterviewStudio({ user, overview, onChanged, setError }) {
  const [interview, setInterview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRound, setSelectedRound] = useState(1);
  const [track, setTrack] = useState(user.track || "sde");
  const [resume, setResume] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [code, setCode] = useState(STARTER);
  const [language, setLanguage] = useState("python");
  const [timeClaim, setTimeClaim] = useState("");
  const [spaceClaim, setSpaceClaim] = useState("");
  const [explanation, setExplanation] = useState("");
  const [systemDesign, setSystemDesign] = useState("");
  const [repoNotes, setRepoNotes] = useState("");
  const [repoPatch, setRepoPatch] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [repoSeconds, setRepoSeconds] = useState(1800);
  const recentPaste = useRef(0);
  const lastCodeChange = useRef({ at: Date.now(), length: 0 });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/interview", { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.interview) {
        setInterview(data.interview);
        setSelectedRound(Math.min(6, Math.max(1, Number(data.interview.phase || 1))));
        setResume(data.interview.resumeText || "");
        setJobDescription(data.interview.jobDescription || "");
        setCode(data.interview.code || STARTER);
        setSystemDesign(data.interview.systemDesignAnswer || "");
        setRepoNotes(data.interview.repoNotes || "");
        setRepoPatch(data.interview.repoPatch || data.interview.repoFiles?.[0]?.content || "");
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh().catch((error) => setError(error.message)); }, [refresh, setError]);

  const activeDsa = interview?.dsaQuestions?.[interview.activeDsa || 0];
  const activeDomain = interview?.domainQuestions?.[interview.activeDomain || 0];
  const activeQuestion = selectedRound === 2 ? activeDsa : selectedRound === 3 ? activeDomain : null;
  const questionPhase = selectedRound === 3 ? "domain" : "dsa";
  const submission = useMemo(() => (interview?.submissions || []).slice().reverse().find((item) => item.questionId === activeQuestion?.id), [interview?.submissions, activeQuestion?.id]);
  const passed = submission?.results?.filter((item) => item.passed).length || 0;
  const complexityDone = Boolean(interview?.complexityReviews?.[activeQuestion?.id]);
  const doAction = async (action, payload = {}) => {
    if (!interview?.id) return null;
    setBusy(true); setError("");
    try {
      const data = await call(action, payload, interview.id);
      if (data.interview) setInterview((current) => ({ ...current, ...data.interview }));
      if (data.reviewNotice) setMessage(data.reviewNotice);
      return data;
    } catch (error) { setError(error.message); return null; }
    finally { setBusy(false); }
  };

  const openedFor = useRef(null);
  useEffect(() => {
    if (selectedRound !== 4 || !interview?.id || interview.technicalOpened || interview.paused || openedFor.current === interview.id) return;
    openedFor.current = interview.id;
    doAction("technical_open").then((data) => { if (data?.opening) speak(data.opening); });
  }, [selectedRound, interview?.id, interview?.technicalOpened, interview?.paused]);

  const start = async () => {
    setBusy(true); setError("");
    try {
      let focusSkill = "";
      try { focusSkill = window.sessionStorage.getItem("pmx-retest-skill") || ""; window.sessionStorage.removeItem("pmx-retest-skill"); } catch {}
      const response = await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", track, focusSkill }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not start this interview.");
      setInterview(data.interview); setSelectedRound(1); setMessage(focusSkill ? `Retest started with a question focused on ${focusSkill}.` : "Five rounds are ready. Take them in order and ask for a hint whenever you'd like.");
      setResume(data.interview.resumeText || ""); setJobDescription(data.interview.jobDescription || ""); setCode(STARTER); setRepoNotes("");
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  };

  // Tab changes become visible in the replay and pause the session for a human review.
  useEffect(() => {
    if (!interview?.id || interview.reportSubmitted) return;
    const key = `pmx-tab-switch:${interview.id}`;
    const handleVisibility = async () => {
      if (document.visibilityState === "hidden") {
        try { sessionStorage.setItem(key, "1"); } catch {}
        try { const data = await call("tab_switch", {}, interview.id); if (data.interview) setInterview((current) => ({ ...current, ...data.interview })); } catch {}
        return;
      }
      let pending = false;
      try { pending = sessionStorage.getItem(key) === "1"; sessionStorage.removeItem(key); } catch {}
      if (pending) {
        playAlarm();
        const response = await fetch(`/api/interview?id=${encodeURIComponent(interview.id)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (data.interview) setInterview(data.interview);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [interview?.id, interview?.reportSubmitted]);

  useEffect(() => {
    if (!interview?.repoStartedAt || interview.repoEvaluation) return;
    const update = () => setRepoSeconds(Math.max(0, 1800 - Math.floor((Date.now() - new Date(interview.repoStartedAt).getTime()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [interview?.repoStartedAt, interview?.repoEvaluation]);

  const runCode = async () => {
    const data = await doAction("run_code", { code, language, phase: questionPhase });
    if (data?.results) setMessage(`Runner finished: ${data.results.filter((item) => item.passed).length}/${data.results.length} visible tests passed.`);
  };
  const handleCodeChange = (value) => {
    const now = Date.now();
    const delta = Math.max(0, value.length - code.length);
    const elapsed = now - lastCodeChange.current.at;
    if (delta >= 120 && elapsed <= 1200 && now - recentPaste.current > 1500) doAction("typing_event", { phase: questionPhase, characters: delta });
    lastCodeChange.current = { at: now, length: value.length };
    setCode(value);
  };
  const handleCodePaste = (event) => {
    const characters = event.clipboardData?.getData("text")?.length || 0;
    recentPaste.current = Date.now();
    if (characters >= 120) doAction("paste_event", { phase: questionPhase, characters });
  };
  const reviewComplexity = async () => {
    if (!timeClaim.trim() || !spaceClaim.trim()) { setError("Write both time and space complexity claims before asking for a review."); return; }
    await doAction("complexity_review", { phase: questionPhase, code, timeClaim, spaceClaim, results: submission?.results || [] });
  };
  const nextQuestion = async (phase, index, length) => {
    if (index < length - 1) { const result = await doAction("next_question", { phase }); if (result) { setCode(STARTER); setTimeClaim(""); setSpaceClaim(""); setExplanation(""); } }
  };
  const completeRound = async (round) => {
    if (round === 1 && !interview?.completedRounds?.includes(1)) { setError("Complete the resume screening first."); return; }
    const result = await doAction("complete_round", { round, explanation, systemDesign });
    if (result) setSelectedRound(Math.min(6, round + 1));
  };

  const submitChat = async (kind, value) => {
    const map = { technical: "technical_chat", behavioral: "behavioral_chat", copilot: "copilot_chat" };
    const data = await doAction(map[kind], { message: value, ...(kind === "copilot" ? { phase: questionPhase, code } : {}) });
    if (data?.reply) setMessage("");
  };

  if (loading) return <div className="empty">Opening your interview notebook…</div>;
  if (!interview) return <>
    <section className="hero"><div><span className="eyebrow">Practice studio · five rounds</span><h1>A thoughtful practice loop, built around your target role.</h1><p>Warm questions, real code execution, role-specific practice, and a report a placement officer reviews before it is finalized.</p>{overview.demoMode && <div className="status success">Demo mode is on · sample resume and job details are prefilled. No live job board calls.</div>}</div><div className="hero-art"><figure className="nova-card"><img src="/nova_interviewer.png" alt="Nova, an original illustrated interviewer" /><figcaption>Nova · original practice interviewer</figcaption></figure></div></section>
    <section className="card"><div className="card-head"><div><span className="eyebrow">Choose your practice track</span><h2>Ready when you are</h2></div><span className="sticker sun">No rush ♡</span></div><div className="field"><label htmlFor="interview-track">Target role</label><select id="interview-track" value={track} onChange={(e) => setTrack(e.target.value)}>{[["machine_learning","Machine Learning & AI"],["full_stack","Full Stack"],["sde","Software Development"],["data_engineering","Data Engineering"]].map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><button className="button" disabled={busy} onClick={start}>{busy ? "Setting up your questions…" : "Start a new five-round interview →"}</button></section>
    <section><div className="section-head"><div><span className="eyebrow">The loop</span><h2>Five small chapters</h2></div></div><div className="grid three">{ROUND_TITLES.map((name, i) => <article className="card soft" key={name}><span className="sticker">Round 0{i + 1}</span><h3 style={{ marginTop: 12 }}>{name}</h3><p>{["Resume + role requirements", "Three LeetCode-style coding tasks + explicit complexity review", "Two coding prompts + repository bug hunt; SDE adds design", "Evidence-grounded technical conversation", "Behavioral conversation using STAR"][i]}</p></article>)}</div></section>
  </>;

  const rounds = interview.completedRounds || [];
  const unlocked = (round) => round === 1 || rounds.includes(round - 1) || rounds.includes(round);
  const startRepo = async () => { const data = await doAction("repo_load"); if (data?.files?.[0]) setRepoPatch(data.files[0].content); };
  const verifyRepo = async () => { const data = await doAction("repo_verify", { code: repoPatch }); if (data?.results) setMessage(data.verified ? "All visible and hidden checks passed. Add your evidence notes and submit." : `${data.results.filter((item) => item.passed).length}/${data.results.length} visible patch checks passed. Review the output and try again.`); };
  const submitRepo = async () => { const data = await doAction("repo_submit", { notes: repoNotes }); if (data?.evaluation) setMessage("Bug hunt submitted with a tested patch. The report includes the evidence review and AI collaboration trace."); };
  const finish = async () => { const result = await doAction("finish"); if (result?.score != null) { setMessage(`Your report is ready for placement-cell review. Readiness: ${Math.round(result.score)}%.`); onChanged(); } };
  const allRoundsDone = [1,2,3,4,5].every((round) => rounds.includes(round));
  const handleCameraUnavailable = useCallback(() => {
    setCameraOn(false);
    setError("This browser does not support the optional local face-presence check.");
  }, [setError]);

  return <>
    <section className="section-head" style={{ marginTop: 24 }}><div><span className="eyebrow">Your interview desk</span><h2>{interview.track?.replaceAll("_", " ")} track</h2><p>Five rounds · one steady conversation at a time</p></div><div className="sticker sun">{Math.min(5, rounds.length)} / 5 rounds finished</div></section>
    <div className="progress-track" aria-label="Interview progress"><span style={{ width: `${rounds.length * 20}%` }} /></div>
    <div className="round-tabs" role="tablist" aria-label="Interview rounds">{ROUND_TITLES.map((title, index) => { const n = index + 1; return <button key={title} className={`${selectedRound === n ? "current" : ""} ${rounds.includes(n) ? "done" : ""}`} disabled={!unlocked(n)} onClick={() => setSelectedRound(n)}>{rounds.includes(n) ? "✓ " : `${String(n).padStart(2, "0")} · `}{title}</button>; })}{interview.reportSubmitted && <button className={selectedRound === 6 ? "current" : "done"} onClick={() => setSelectedRound(6)}>Report</button>}</div>
    {interview.cancelled && !interview.paused ? <div className="interview-cancelled" role="alert"><span aria-hidden="true">×</span><div><strong>Interview cancelled</strong><p>This older attempt was cancelled after a tab-switch flag. It can be resumed for this demo, and the event remains in the replay.</p><button className="button danger" style={{ marginTop: 9 }} disabled={busy} onClick={() => doAction("resume")}>Resume this attempt</button></div></div> : interview.paused && <div className="paused" role="alert"><span className="paused-mark">!</span><div><strong>Tab change spotted · interview paused</strong><p>A tab change was logged for placement-cell review. This is a review flag, not an automatic finding. Resume this attempt when you’re ready.</p><button className="button danger" style={{ marginTop: 9 }} disabled={busy} onClick={() => doAction("resume")}>Resume interview</button></div></div>}
    {message && <div className="status" role="status" style={{ marginBottom: 12 }}>{message}<button className="icon-button" onClick={() => setMessage("")}>Dismiss</button></div>}
    {selectedRound === 1 && <section className="grid two">
      <div className="card"><div className="card-head"><div><span className="eyebrow">Round 01 · evidence only</span><h2>Resume screening</h2></div><span className="sticker sun">Weak points + strengths</span></div><p>Paste resume text and the job description. Nova compares only what you provide.</p><div className="field"><label htmlFor="resume-text">Resume text</label><textarea id="resume-text" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste your resume text or the experience you want reviewed…" /></div><button className="button" disabled={busy || interview.completedRounds?.includes(1)} onClick={async () => { const data = await doAction("resume_screen", { resume, jobDescription }); if (data?.report) setMessage("Screening complete · source text and evidence checks saved."); }}>{busy ? "Comparing evidence…" : interview.completedRounds?.includes(1) ? "Resume screening saved ✓" : "Analyze resume against role →"}</button>
        {interview.resumeReport && <div className="card soft" style={{ marginTop: 17 }}><span className="eyebrow">Screening notes</span><h3>{interview.resumeReport.summary || "Evidence review"}</h3><p>Fit score: {interview.roundScores?.[1] ?? 0}%</p><div className="grid two">{(interview.resumeReport.weak_points || []).map((gap, index) => <div className="status" key={index}><strong>{gap.requirement}</strong><p>{gap.status}: {gap.improvement}</p></div>)}</div></div>}
      </div>
      <div className="card"><div className="card-head"><div><span className="eyebrow">Target role</span><h2>Job description</h2></div><span className="sticker">your track</span></div><div className="field"><label htmlFor="jd-text">Job description</label><textarea id="jd-text" value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Paste a real job description, or use the sample below…" /></div><p className="tiny-label">Sample description · editable</p><p>{overview.jobs?.find((job) => job.track === interview.track)?.jd_text || "Paste the role requirements you want to practice against."}</p>{!interview.completedRounds?.includes(1) && <button className="button secondary" disabled={busy || !interview.resumeReport} onClick={() => completeRound(1)}>Finish resume round →</button>}</div>
    </section>}

    {(selectedRound === 2 || selectedRound === 3) && <>
      <div className="split">
        <section className="card"><div className="card-head"><div><span className="eyebrow">Round 0{selectedRound} · coding desk</span><h2>{selectedRound === 2 ? `DSA ${Number(interview.activeDsa || 0) + 1} of ${interview.dsaQuestions?.length || 3}` : `Role prompt ${Number(interview.activeDomain || 0) + 1} of ${interview.domainQuestions?.length || 2}`}</h2></div><span className="sticker sun">Run the visible tests</span></div>
          {activeQuestion ? <><div className="question"><strong>{activeQuestion.title}</strong><p>{activeQuestion.description}</p>{activeQuestion.leetcode_url && <p><a href={activeQuestion.leetcode_url} target="_blank" rel="noreferrer">LeetCode problem reference ↗</a></p>}</div><div className="field"><label htmlFor="language">Language</label><select id="language" value={language} onChange={(e) => setLanguage(e.target.value)}><option value="python">Python 3</option><option value="javascript">JavaScript (Node.js)</option><option value="java">Java</option><option value="cpp">C++</option></select></div><div className="field"><label htmlFor="code">Your code</label><textarea id="code" className="code-editor" spellCheck="false" value={code} onChange={(e) => handleCodeChange(e.target.value)} onPaste={handleCodePaste} /></div>{interview.demoMode && <button className="button quiet" onClick={async () => { const data = await doAction("demo_solution", { phase: questionPhase }); if (data?.solution) setCode(data.solution); }} disabled={busy}>Fill sample solution · demo mode</button>}<div className="grid two"><button className="button" disabled={busy || interview.paused || interview.cancelled} onClick={runCode}>{busy ? "Running…" : "Run against visible tests ↗"}</button>{selectedRound === 2 && <span className="sticker">Tested {passed}/{submission?.results?.length || 0} visible</span>}</div>
            <div className="grid two" style={{ marginTop: 16 }}><div className="field"><label htmlFor="time-complexity">Your time complexity</label><input id="time-complexity" value={timeClaim} onChange={(e) => setTimeClaim(e.target.value)} placeholder="e.g. O(n log n)" /></div><div className="field"><label htmlFor="space-complexity">Your space complexity</label><input id="space-complexity" value={spaceClaim} onChange={(e) => setSpaceClaim(e.target.value)} placeholder="e.g. O(n)" /></div></div>
            <button className="button quiet" disabled={busy || !submission || interview.paused} onClick={reviewComplexity}>{busy ? "Reviewing…" : complexityDone ? "Refresh complexity review" : "Ask Nova to assess complexity"}</button>
            {interview.complexityReviews?.[activeQuestion.id] && <div className="status" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}><strong>Complexity review</strong><br />{interview.complexityReviews[activeQuestion.id]}</div>}
            {submission?.results?.map((result, i) => <div key={i} className={`status ${result.passed ? "success" : "error"}`} style={{ marginTop: 9 }}><strong>Test {i + 1}: {result.passed ? "Passed" : result.status}</strong><div className="testcase">stdin: {activeQuestion.test_cases?.[i]?.input || "(empty)"}{"\n"}expected: {result.expected}{"\n"}output: {result.stdout || "(no output)"}{result.stderr ? `\nmessage: ${result.stderr}` : ""}</div></div>)}
            <div className="field"><label htmlFor="approach">Explain your approach</label><textarea id="approach" value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="A brief note about your data structure or key trade-off…" /></div>
            {(selectedRound === 2 ? interview.activeDsa < 2 : interview.activeDomain < 1) ? <button className="button secondary" disabled={busy} onClick={() => nextQuestion(questionPhase, selectedRound === 2 ? interview.activeDsa : interview.activeDomain, selectedRound === 2 ? 3 : 2)}>Save & open next question →</button> : <button className="button secondary" disabled={busy || interview.paused} onClick={() => completeRound(selectedRound)}>Finish this round →</button>}
          </> : <div className="empty">No question is loaded.</div>}
        </section>
        <InterviewerPanel kind="copilot" phase={questionPhase} code={code} interview={interview} busy={busy} onSend={submitChat} />
      </div>
      {selectedRound === 3 && <section className="grid two" style={{ marginTop: 18 }}>
        <div className="card"><div className="card-head"><div><span className="eyebrow">Repo investigation · 30 minutes</span><h2>Bug hunt</h2></div><span className="sticker coral">{`${String(Math.floor(repoSeconds / 60)).padStart(2, "0")}:${String(repoSeconds % 60).padStart(2, "0")}`}</span></div><p>{interview.repoChallenge?.prompt || "Read this role-specific mini-repository, explain the defect with evidence, patch it, and run the checks."} The timer and checks are enforced by the server.</p>{!interview.repoFiles?.length && <button className="button" style={{ marginLeft: 10 }} disabled={busy} onClick={startRepo}>Open planted-bug mini-repo</button>}
          {(interview.repoFiles || []).map((file) => <details key={file.path} className="card soft" style={{ marginTop: 12 }} open><summary><strong>{file.path}</strong></summary><pre className="testcase" style={{ maxHeight: 300, overflow: "auto" }}>{file.content}</pre></details>)}
          {interview.repoFiles?.length > 0 && <><div className="field"><label htmlFor="repo-patch">Patch the bug · Python</label><textarea id="repo-patch" className="code-editor" spellCheck="false" value={repoPatch} onChange={(event) => setRepoPatch(event.target.value)} /></div>{interview.demoMode && <button className="button quiet" disabled={busy} onClick={async () => { const data = await doAction("demo_solution", { kind: "repo" }); if (data?.solution) setRepoPatch(data.solution); }}>Show sample patch · demo mode</button>}<button className="button quiet" style={{ marginLeft: 8 }} disabled={busy || interview.paused} onClick={verifyRepo}>{busy ? "Running patch checks…" : "Run patch against visible + hidden checks ↗"}</button>{interview.repoFixResults?.map((result, i) => <div key={i} className={`status ${result.passed ? "success" : "error"}`} style={{ marginTop: 8 }}><strong>Visible patch check {i + 1}: {result.passed ? "Passed" : result.status}</strong>{result.stderr && <p>{result.stderr}</p>}</div>)}</>}
          <div className="field"><label htmlFor="repo-notes">What bug did you find, and how does your patch fix it?</label><textarea id="repo-notes" value={repoNotes} onChange={(e) => setRepoNotes(e.target.value)} placeholder="Name the file and behavior, cite the evidence, and describe how your tests verify the fix…" /></div>{interview.repoEvaluation ? <div className="status" style={{ whiteSpace: "pre-wrap" }}><strong>Evidence review</strong><br />{(interview.repoEvaluation.findings || []).join("\n")}{interview.repoEvaluation.uncertainty ? `\n\nUncertainty: ${interview.repoEvaluation.uncertainty}` : ""}<p className="tiny-label">AI collaboration trace: {interview.repoCollaborationScore ?? "—"}/100 · assessment is included for placement-cell review.</p></div> : <button className="button quiet" disabled={busy || !interview.repoFiles?.length || !interview.repoVerifiedFix} onClick={submitRepo}>Submit tested bug hunt notes</button>}</div>
        {interview.designQuestion && <div className="card"><div className="card-head"><div><span className="eyebrow">Extra for SDE</span><h2>{interview.designQuestion.title}</h2></div><span className="sticker sun">System design</span></div><div className="question"><p>{interview.designQuestion.prompt}</p></div><div className="field"><label htmlFor="system-design">Your design notes</label><textarea id="system-design" value={systemDesign} onChange={(e) => setSystemDesign(e.target.value)} placeholder="Requirements, APIs, data model, scale, and trade-offs…" /></div>{interview.systemDesignReview?.criteria?.length > 0 && <div className="status"><strong>Evidence notes for your design</strong>{interview.systemDesignReview.criteria.map((item) => <p key={item.criterion}>{item.criterion}: {item.verified ? `“${item.evidence}”` : "not explicitly supported in the response"}</p>)}</div>}</div>}
      </section>}
    </>}

    {selectedRound === 4 && <div className="split"><section className="card"><span className="eyebrow">Round 04 · technical conversation</span><h2>Think out loud, one idea at a time.</h2><p>Nova asks follow-ups based on your answers and the role you chose. You can use your microphone only if your browser supports it; text chat always works.</p><Conversation kind="technical" interview={interview} busy={busy} onSend={submitChat} /></section><div className="card"><InterviewerIntro large /><p>Technical topics are grounded in your selected track and the details you share. The interviewer won't treat unstated experience as fact.</p><button className="button quiet" onClick={() => speak(interview.conversations?.technical?.[0]?.content || INITIAL_PROMPTS.technical)}>Hear the opening prompt 🔊</button><div className="question" style={{ marginTop: 18 }}><strong>Opening prompt</strong><p>{interview.conversations?.technical?.[0]?.content || INITIAL_PROMPTS.technical}</p>{interview.technicalEvidence && <p className="tiny-label">Built from your Round 1–3 evidence</p>}</div><button className="button secondary" style={{ marginTop: 14 }} disabled={busy || interview.completedRounds?.includes(4)} onClick={() => completeRound(4)}>Finish technical interview →</button></div></div>}

    {selectedRound === 5 && <div className="split"><section className="card"><span className="eyebrow">Round 05 · behavioral conversation</span><h2>Tell the story, your way.</h2><p>Use Situation, Task, Action, Result as a helpful structure — not a script. Nova asks about the example you actually share.</p><Conversation kind="behavioral" interview={interview} busy={busy} onSend={submitChat} /></section><div className="card"><InterviewerIntro large /><p>Behavioral scoring looks for transcript evidence only. Missing details stay marked as missing; we don't infer personality.</p><button className="button quiet" onClick={() => speak(INITIAL_PROMPTS.behavioral)}>Hear the opening prompt 🔊</button><div className="grid two" style={{ marginTop: 18 }}>{["Situation", "Task", "Action", "Result"].map((part) => <span key={part} className="sticker">{part}</span>)}</div><button className="button secondary" style={{ marginTop: 18 }} disabled={busy || interview.completedRounds?.includes(5)} onClick={() => completeRound(5)}>Finish behavioral round →</button></div></div>}

    {selectedRound === 6 && <section className="card"><span className="eyebrow">Final page · placement-cell review</span><h2>{interview.reportSubmitted ? "Your report is waiting for a human review." : "Five rounds complete."}</h2><p>The readiness score is a practice signal. A placement officer must approve the report before it is finalized.</p>{interview.finalScore != null && <div className="big-number">{Math.round(interview.finalScore)}%</div>}<div className="grid three" style={{ margin: "18px 0" }}>{ROUND_TITLES.map((round, index) => <div className="status" key={round}><strong>Round 0{index + 1}</strong><br />{interview.roundScores?.[index + 1] ?? "—"}/100</div>)}</div>{interview.reportSubmitted ? <div className="status">Pending placement-cell approval · your report has not been finalized yet.</div> : <button className="button" disabled={!allRoundsDone || busy} onClick={finish}>{busy ? "Saving your report…" : "Submit for placement-cell review →"}</button>}</section>}

    <div className="card soft" style={{ marginTop: 20 }}><div className="card-head"><div><span className="eyebrow">Optional check</span><h3>Camera face-presence check</h3></div><span className="sticker">on this device</span></div><p>Only presence/count transitions are recorded. Frames stay in the browser; this check does not detect phones or decide misconduct. A brief camera miss is just a review note.</p><button className="button quiet" disabled={busy || interview.paused} onClick={() => setCameraOn((current) => !current)}>{cameraOn ? "Turn camera check off" : "Turn camera check on"}</button>{cameraOn && <CameraCheck attemptId={interview.id} onUnavailable={handleCameraUnavailable} />}</div>
  </>;
}

function NovaAvatar({ large = false }) {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => { const handler = (event) => setSpeaking(Boolean(event.detail)); window.addEventListener("nova-speaking", handler); return () => window.removeEventListener("nova-speaking", handler); }, []);
  return <div className={`nova-live ${large ? "large" : ""} ${speaking ? "speaking" : ""}`} role="img" aria-label={speaking ? "Nova is speaking" : "Nova is listening"}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="98" fill="#ffe6d5" />
      <path d="M26 200c4-38 36-50 74-50s70 12 74 50z" fill="#8da47e" />
      <g className="nova-head">
        <rect x="88" y="140" width="24" height="22" rx="8" fill="#e8b48c" />
        <ellipse cx="100" cy="98" rx="60" ry="64" fill="#3b2a24" />
        <ellipse cx="100" cy="108" rx="50" ry="56" fill="#f5c7a1" />
        <ellipse cx="51" cy="112" rx="7" ry="11" fill="#eab48c" /><ellipse cx="149" cy="112" rx="7" ry="11" fill="#eab48c" />
        <path d="M46 100c-2-38 24-58 56-58 32 0 54 20 52 58-14-18-34-28-58-24-20 3-38 10-50 24z" fill="#3b2a24" />
        <path d="M70 90q8-7 18-3M112 87q10-4 18 3" stroke="#3b2a24" strokeWidth="4" strokeLinecap="round" fill="none" />
        <g className="nova-eyes"><ellipse cx="78" cy="108" rx="6" ry="7.5" fill="#2b1d18" /><ellipse cx="122" cy="108" rx="6" ry="7.5" fill="#2b1d18" /><circle cx="80" cy="105" r="2" fill="#fff" /><circle cx="124" cy="105" r="2" fill="#fff" /></g>
        <g fill="none" stroke="#1b3228" strokeWidth="3"><circle cx="78" cy="108" r="17" /><circle cx="122" cy="108" r="17" /><path d="M95 108h10" /></g>
        <circle cx="64" cy="130" r="8" fill="#f4a5a0" opacity=".55" /><circle cx="136" cy="130" r="8" fill="#f4a5a0" opacity=".55" />
        <path className="nova-smile" d="M86 140q14 12 28 0" stroke="#7a2e3a" strokeWidth="4" strokeLinecap="round" fill="none" />
        <ellipse className="nova-mouth" cx="100" cy="143" rx="13" ry="8" fill="#7a2e3a" />
      </g>
    </svg>
    {large && <span className="nova-live-tag">{speaking ? "● Nova is speaking" : "Nova is listening"}</span>}
  </div>;
}

function InterviewerIntro({ large = false }) { return large
  ? <div className="avatar-stage"><NovaAvatar large /><div className="avatar-caption"><strong>Nova, your interviewer</strong><p>Original character · free in-browser voice</p></div></div>
  : <div className="avatar-row"><NovaAvatar /><div><strong>Nova, your interviewer</strong><p>Original character · browser speech</p></div></div>; }

function InterviewerPanel({ kind, phase, code, interview, busy, onSend }) {
  return <aside className="card"><InterviewerIntro /><p>Ask for a nudge while you code. Copilot only sees repository excerpts provided here and your question.</p><Conversation kind={kind} interview={interview} busy={busy} onSend={onSend} compact /></aside>;
}

function Conversation({ kind, interview, busy, onSend, compact = false }) {
  const [draft, setDraft] = useState("");
  const turns = interview.conversations?.[kind] || [];
  const messages = turns.length ? turns : [{ role: "assistant", content: kind === "behavioral" ? INITIAL_PROMPTS.behavioral : kind === "technical" ? INITIAL_PROMPTS.technical : "What part of this code would you inspect first, and what behavior are you expecting?" }];
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState("");
  const [voiceStats, setVoiceStats] = useState(null);
  const recRef = useRef(null);
  const micStartedAt = useRef(0);
  const recognizedText = useRef("");
  const seen = useRef(turns.length);
  useEffect(() => { if (kind !== "copilot" && autoSpeak && turns.length > seen.current && turns.at(-1)?.role === "assistant") speak(turns.at(-1).content); seen.current = turns.length; }, [turns.length, kind, autoSpeak]);
  useEffect(() => () => { try { recRef.current?.abort(); } catch {} }, []);
  const toggleMic = () => {
    const Recognition = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!Recognition) { setMicNote("Voice input needs Chrome or Edge. Typing always works."); return; }
    if (listening) { recRef.current?.stop(); return; }
    window.speechSynthesis?.cancel(); setMicNote("");
    const rec = new Recognition(); rec.lang = navigator.language || "en-US"; rec.interimResults = true; rec.continuous = true;
    micStartedAt.current = Date.now(); recognizedText.current = "";
    const base = draft.trim() ? `${draft.trim()} ` : "";
    rec.onresult = (event) => { let text = ""; for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript; recognizedText.current = text.trim(); setDraft(base + text); };
    rec.onstart = () => { micStartedAt.current = Date.now(); };
    rec.onend = () => {
      setListening(false);
      const seconds = Math.max(1, (Date.now() - micStartedAt.current) / 1000);
      const words = recognizedText.current.trim().split(/\s+/).filter(Boolean);
      const fillers = (recognizedText.current.match(/\b(um|uh|erm|like|you know)\b/gi) || []).length;
      if (words.length) {
        const wpm = Math.round(words.length * 60 / seconds);
        const paceScore = wpm >= 95 && wpm <= 165 ? 100 : wpm < 95 ? Math.max(45, Math.round(45 + wpm / 2)) : Math.max(45, Math.round(100 - (wpm - 165) / 2));
        const deliveryScore = Math.max(0, Math.min(100, paceScore - Math.min(25, fillers * 3)));
        setVoiceStats({ words: words.length, wpm, fillers, deliveryScore });
      }
    };
    rec.onerror = (event) => { setListening(false); setMicNote(event.error === "not-allowed" ? "Microphone permission was blocked. Allow it in the address bar, or type instead." : "Voice input stopped. You can try again or type."); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setMicNote("Voice input could not start. Try again."); }
  };
  const send = async (event) => { event.preventDefault(); try { recRef.current?.stop(); } catch {} if (!draft.trim()) return; const text = draft.trim(); setDraft(""); await onSend(kind, text); };
  return <div className="chat-room"><div className="chat-log" aria-live="polite">{messages.map((turn, index) => <div className={`bubble ${turn.role === "user" ? "candidate" : ""}`} key={`${index}-${turn.role}`}><strong>{turn.role === "user" ? "You" : "Nova"}</strong><br />{turn.content}</div>)}</div>
    {messages.at(-1)?.role === "assistant" && <button className="button quiet" style={{ margin: "9px 0" }} onClick={() => speak(messages.at(-1).content)}>Hear Nova 🔊</button>}
    {voiceStats && kind !== "copilot" && <div className="status" role="status"><strong>Voice delivery practice: {voiceStats.deliveryScore}/100</strong><p>{voiceStats.wpm} words/min · {voiceStats.fillers} filler words · {voiceStats.words} transcribed words.</p><small>Formative estimate based on browser speech recognition only. It is not stored, used in readiness, or treated as an interview score.</small></div>}
    <form className="chat-form" onSubmit={send}><div className="field"><label htmlFor={`chat-${kind}`}>{compact ? "Ask while you work" : "Your answer"}</label><textarea id={`chat-${kind}`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={kind === "copilot" ? "Ask about a file or possible bug…" : "Type your answer…"} rows={compact ? 3 : 4} /></div><div className="chat-actions"><button type="button" className={`button quiet mic ${listening ? "live" : ""}`} onClick={toggleMic} aria-pressed={listening}>{listening ? "■ Stop listening" : "🎙 Speak your answer"}</button><button className="button" disabled={busy || !draft.trim()}>{busy ? "Nova is thinking…" : "Send to Nova →"}</button></div>{micNote && <p className="tiny-label" role="status">{micNote}</p>}{kind !== "copilot" && <label className="tiny-label"><input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} /> Nova speaks her replies aloud</label>}</form>
  </div>;
}

function CameraCheck({ attemptId, onUnavailable }) {
  const videoRef = useRef(null); const [status, setStatus] = useState("Asking for camera access…");
  useEffect(() => {
    let stream; let cancelled = false;
    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) { onUnavailable(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        const video = videoRef.current;
        if (!video || cancelled) return;
        video.srcObject = stream; await video.play(); setStatus("Loading local face-presence model…");
        let detect;
        try {
          const vision = await import(/* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs");
          const files = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
          const detector = await vision.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" }, runningMode: "VIDEO", minDetectionConfidence: 0.55 });
          detect = () => detector.detectForVideo(video, performance.now()).detections || [];
          setStatus("Local face-presence check is on. Video stays in this browser.");
        } catch {
          if (!window.FaceDetector) { setStatus("The optional face model could not load; interview text and code still work."); onUnavailable(); return; }
          const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
          detect = async () => detector.detect(video);
          setStatus("Browser face-presence check is on. Video stays in this browser.");
        }
        let last = "present";
        const timer = window.setInterval(async () => {
          const video = videoRef.current;
          if (!video?.readyState || video.readyState < 2 || cancelled) return;
          try { const faces = await detect(); const count = faces.length; const kind = count === 0 ? "no_face" : count > 1 ? "multiple_faces" : "present"; if (kind !== last) { last = kind; setStatus(kind === "present" ? "One face in frame." : kind === "no_face" ? "No face in frame · review note recorded." : "More than one face · review note recorded."); await fetch("/api/interview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, action: "camera_event", payload: { kind, count } }) }); } } catch { setStatus("The browser paused its face check."); }
        }, 1200);
        return () => window.clearInterval(timer);
      } catch { onUnavailable(); }
    };
    const cleanup = run();
    return () => { cancelled = true; stream?.getTracks().forEach((track) => track.stop()); Promise.resolve(cleanup).then((fn) => fn?.()); };
  }, [attemptId, onUnavailable]);
  return <div className="status" style={{ marginTop: 12 }}><video ref={videoRef} muted playsInline style={{ width: 150, borderRadius: 12, background: "#eee" }} /><p>{status}</p></div>;
}

function speak(text) { if (typeof window === "undefined" || !window.speechSynthesis) return; window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = 1.02; const emit = (on) => window.dispatchEvent(new CustomEvent("nova-speaking", { detail: on })); utterance.onstart = () => emit(true); utterance.onend = () => emit(false); utterance.onerror = () => emit(false); window.speechSynthesis.speak(utterance); }

function playAlarm() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (Context) { const context = new Context(); context.resume().then(() => [880, 660, 880, 660, 880].forEach((frequency, index) => { const oscillator = context.createOscillator(); const gain = context.createGain(); const start = context.currentTime + index * 0.21; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.14, start + .02); gain.gain.exponentialRampToValueAtTime(.0001, start + .16); oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .17); })); }
  } catch {}
  speak("A tab change was detected. This interview is paused, and the event was recorded for placement review.");
}
