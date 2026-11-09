"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import InterviewStudio from "./InterviewStudio";

const TRACKS = [
  ["machine_learning", "Machine Learning & AI"], ["full_stack", "Full Stack"],
  ["sde", "Software Development"], ["data_engineering", "Data Engineering"],
];
const NAV = [["home", "My desk"], ["matches", "Role matches"], ["interview", "Interview studio"], ["progress", "Progress"]];

async function api(path, body, method) {
  const response = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not complete that request.");
  return data;
}

export default function PrepMaxxing() {
  const [user, setUser] = useState(undefined);
  const [view, setView] = useState("home");
  const [overview, setOverview] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [palette, setPalette] = useState("garden");
  const [serviceNotice, setServiceNotice] = useState("");

  const reload = useCallback(async () => {
    const data = await api("/api/overview");
    setOverview(data);
    setUser(data.user);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("pmx-palette");
    if (stored && ["garden", "peach", "blueberry"].includes(stored)) setPalette(stored);
    fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).then((health) => {
      if (!health.ok) setServiceNotice("Local preview is open, but its database is not connected. Account creation and saved interview progress need DATABASE_URL and migrations 001–003.");
    }).catch(() => setServiceNotice("The app could not check its local database connection."));
    api("/api/me").then(({ user: current }) => {
      if (!current) setUser(null);
      else reload().catch((e) => setError(e.message));
    }).catch((e) => { setUser(null); setError(e.message); });
  }, [reload]);

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    window.localStorage.setItem("pmx-palette", palette);
  }, [palette]);

  const authenticate = async (event) => {
    event.preventDefault(); setError(""); setAuthBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const result = await api(`/api/auth/${authMode === "signup" ? "register" : "login"}`, body);
      setUser(result.user);
      setOverview(null);
      setNotice(authMode === "signup" ? "Your desk is ready. Let's make a plan." : "Welcome back — your progress is here.");
      setAuthBusy(false);
      reload().catch((e) => setError(e.message));
    } catch (e) { setError(e.message); }
    finally { setAuthBusy(false); }
  };

  const signOut = async () => { await api("/api/auth/logout", {}); setUser(null); setOverview(null); setView("home"); };
  const staff = user && user.role !== "student";
  const nav = staff ? [["home", "Placement cell"]] : NAV;

  if (user === undefined) return <main className="shell"><p className="doodle">Opening your notebook…</p></main>;

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#home" onClick={(e) => { e.preventDefault(); setView("home"); }}>
        <span className="brand-mark">✿</span><span><span className="brand-name">PREPMAXXING</span><span className="brand-note">CAREER READINESS STUDIO</span></span>
      </a>
      {user && <nav className="nav" aria-label="Main navigation">{nav.map(([key, label]) => <button key={key} aria-current={view === key ? "page" : undefined} onClick={() => { setView(key); setError(""); }}>{label}</button>)}</nav>}
      <div className="top-actions">
        <select className="palette-select" aria-label="Choose page palette" value={palette} onChange={(e) => setPalette(e.target.value)}>
          <option value="garden">✿ Garden</option><option value="peach">♡ Peachy</option><option value="blueberry">✧ Blueberry</option>
        </select>
        {user && <><span className="user-chip">{user.full_name}</span><button className="icon-button" onClick={signOut}>Sign out</button></>}
      </div>
    </header>

    {error && <div className="error-box" role="alert">{error}</div>}
    {serviceNotice && !user && <div className="status" role="status" style={{ marginBottom: 12 }}>{serviceNotice}</div>}
    {notice && <div className="status success" role="status">{notice}<button className="icon-button" onClick={() => setNotice("")}>Dismiss</button></div>}

    {!user ? <section className="login-layout">
      <div className="login-copy">
        <span className="eyebrow">A softer way to get interview-ready</span>
        <h1>Your next role is a story still being written.</h1>
        <p>Find roles that fit, see what to strengthen, then practice the real work — one calm, clear step at a time.</p>
        <div className="grid three" style={{ marginTop: 22 }}>
          <div className="sticker">✳ Role matches</div><div className="sticker sun">✎ Tiny learning plan</div><div className="sticker coral">♡ Mock interviews</div>
        </div>
        <p className="footer-note">Your progress is private to your account. Synthetic cohort examples are labeled in the placement dashboard.</p>
      </div>
      <div className="card login-card">
        <div className="card-head"><div><span className="eyebrow">{authMode === "signup" ? "Let's make your account" : "Welcome back"}</span><h2>{authMode === "signup" ? "Create your desk" : "Sign in"}</h2></div><span className="sticker sun">✦</span></div>
        <p>{authMode === "signup" ? "Your learning plan and interview progress stay together here." : "Pick up right where you left off."}</p>
        <form onSubmit={authenticate}>
          {authMode === "signup" && <Field name="name" label="Full name" placeholder="Your name" required />}
          <Field name="email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" required />
          <Field name="password" label="Password" type="password" minLength={authMode === "signup" ? 10 : undefined} autoComplete={authMode === "signup" ? "new-password" : "current-password"} required />
          {authMode === "signup" && <div className="field"><label htmlFor="track">Role you are preparing for</label><select id="track" name="track">{TRACKS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>}
          <button className="button" disabled={authBusy}>{authBusy ? "One moment…" : authMode === "signup" ? "Create account →" : "Sign in →"}</button>
        </form>
        <p className="footer-note">{authMode === "signup" ? "Already have a desk?" : "New around here?"} <button className="icon-button" onClick={() => { setError(""); setAuthMode(authMode === "signup" ? "login" : "signup"); }}>{authMode === "signup" ? "Sign in" : "Create an account"}</button></p>
      </div>
    </section> : !overview ? <div className="empty">Loading your notebook…</div> : staff ? <StaffDesk overview={overview} onRefresh={reload} setError={setError} /> : <>
      {view === "home" && <StudentHome user={user} overview={overview} onGo={setView} />}
      {view === "matches" && <MatchesView overview={overview} setError={setError} />}
      {view === "progress" && <ProgressView overview={overview} onRetry={(gap) => { try { window.sessionStorage.setItem("pmx-retest-skill", gap.skill); } catch {} setView("interview"); }} />}
      {view === "interview" && <InterviewStudio user={user} overview={overview} onChanged={reload} setError={setError} />}
    </>}
    <footer className="footer"><span>✿ PrepMaxxing · made for thoughtful practice</span><span>Clear evidence. Useful next steps. A human review at the end.</span></footer>
  </main>;
}

function Field({ label, name, type = "text", ...props }) { return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} type={type} {...props} /></div>; }

export function ResumeUpload({ onText, setError }) {
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/resume/parse", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read that resume file.");
      onText(data.text); setFilename(data.filename || file.name);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); event.target.value = ""; }
  };
  return <div className="file-picker"><label htmlFor="resume-upload">{busy ? "Reading your document…" : "Add a resume file · PDF, DOCX, or TXT"}</label><input id="resume-upload" type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={onFile} disabled={busy} />{filename && <span className="tiny-label">Loaded {filename}</span>}<small>Text is extracted server-side and saved only when you submit the screening. Scanned PDFs are sent to the configured OCR provider for text extraction.</small></div>;
}

function StudentHome({ user, overview, onGo }) {
  const latest = overview.attempts?.[0];
  const approvedAttempt = overview.attempts?.find((item) => item.approved && item.readiness_score != null);
  const openGaps = overview.gaps?.filter((gap) => !gap.is_synthetic).slice(0, 3) || [];
  return <>
    <section className="hero">
      <div><span className="eyebrow">Your next chapter starts here</span><h1>Hi {user.full_name.split(" ")[0]}, let’s make the path a little clearer.</h1><p>Explore roles, pick one skill to grow, or hop into a practice interview when you’re ready.</p><div className="grid three" style={{ marginTop: 18 }}><button className="button" onClick={() => onGo("matches")}>Find my role fit →</button><button className="button secondary" onClick={() => onGo("interview")}>Open interview studio</button></div></div>
      <div className="hero-art"><figure className="nova-card"><img src="/nova_interviewer.png" alt="Nova, your illustrated interview guide" /><figcaption>Nova · your practice pal</figcaption></figure></div>
    </section>
    <div className="grid three">
      <article className="card"><div className="card-head"><span className="tiny-label">Readiness snapshot</span><span className="sticker sun">✦ latest</span></div><div className="big-number">{overview.readiness == null ? "—" : `${Math.round(Number(overview.readiness))}%`}</div><p>{latest ? latest.approved ? "Your placement officer reviewed your latest report." : "Your latest report is waiting for placement-cell review." : "Complete a mock interview to start tracking readiness."}</p></article>
      <article className="card"><div className="card-head"><span className="tiny-label">Role matches</span><span className="sticker">✿ explore</span></div><div className="big-number">{overview.jobs?.length || 0}</div><p>Explore synthetic role cards and see the skills each one asks for.</p><button className="button quiet" onClick={() => onGo("matches")}>Browse roles →</button></article>
      <article className="card"><div className="card-head"><span className="tiny-label">Practice rounds</span><span className="sticker coral">5 rounds</span></div><div className="big-number">5</div><p>Resume, DSA, role work, technical conversation, and STAR stories.</p><button className="button quiet" onClick={() => onGo("interview")}>Practice at my pace →</button></article>
    </div>
    <section className="grid two" style={{ marginTop: 20 }}><article className="card"><div className="card-head"><div><span className="eyebrow">Approved report only</span><h2>Five-round readiness map</h2></div>{approvedAttempt && <span className="sticker sun">{Math.round(Number(approvedAttempt.readiness_score))}% overall</span>}</div><ReadinessRadar attempt={approvedAttempt} /></article><article className="card"><span className="eyebrow">Synthetic cohort examples</span><h2>Real patterns, clearly labeled</h2><p>The placement dashboard can compare synthetic and student records separately. Synthetic profiles are sample data and never affect your personal readiness.</p><span className="sticker">Synthetic data stays separate</span></article></section>
    <section><div className="section-head"><div><span className="eyebrow">Little by little</span><h2>Your next good steps</h2></div><span className="doodle">small wins count! ↗</span></div>
      {openGaps.length ? <div className="grid three">{openGaps.map((gap) => <article className="card soft" key={`${gap.attempt_id}-${gap.skill}`}><span className="sticker coral">{gap.severity} focus</span><h3 style={{ marginTop: 12 }}>{gap.skill}</h3><p>{gap.resource_title || "Add a practice resource"} · {gap.hours || "—"} hours</p>{gap.url && <a href={gap.url} target="_blank" rel="noreferrer">Open learning resource ↗</a>}</article>)}</div> : <div className="empty">Your first skill notes will show here after an interview report is approved.</div>}</section>
  </>;
}

function MatchesView({ overview, setError }) {
  const [resume, setResume] = useState(""); const [matches, setMatches] = useState([]); const [busy, setBusy] = useState(false); const [screening, setScreening] = useState(""); const [rewrite, setRewrite] = useState(null);
  const [resultDialog, setResultDialog] = useState(null);
  const [liveQuery, setLiveQuery] = useState(""); const [liveLocation, setLiveLocation] = useState(""); const [liveRemote, setLiveRemote] = useState(false); const [liveCountry, setLiveCountry] = useState("US"); const [liveResults, setLiveResults] = useState([]); const [liveInfo, setLiveInfo] = useState(""); const [liveOffset, setLiveOffset] = useState(0);
  const [selected, setSelected] = useState(""); const [jd, setJd] = useState("");
  const selectedJob = useMemo(() => overview.jobs?.find((job) => job.id === selected), [overview.jobs, selected]);
  useEffect(() => { if (selectedJob) setJd(selectedJob.jd_text); }, [selectedJob]);
  const match = async () => { if (resume.trim().length < 30) { setResultDialog({ title: "Add a little more resume text", body: "Paste at least a few lines about your skills, projects, or coursework before finding role matches." }); return; } setBusy(true); setError(""); try { const data = await api("/api/jobs/match", { resume }); setMatches(data.matches || []); setResultDialog({ title: "Your role matches", kind: "matches", data: data.matches || [], note: data.warning || data.mode }); } catch (e) { setResultDialog({ title: "Could not match roles", body: e.message }); } finally { setBusy(false); } };
  const searchLive = async (offset = 0) => { setBusy(true); setError(""); try { const data = await api("/api/jobs/search", { query: liveQuery, location: liveLocation, remote: liveRemote, country: liveCountry, offset, resume }); const found = data.matches || data.jobs || []; setLiveResults((current) => offset ? [...current, ...found] : found); setLiveOffset(data.nextOffset); setLiveInfo(`${data.source || "ZipRecruiter live listings"} · ${data.attribution || "Open the original listing to confirm details."}${data.matchMode ? ` · ${data.matchMode}` : ""}`); setResultDialog((current) => ({ title: "ZipRecruiter search results", kind: "live", data: offset && current?.kind === "live" ? [...current.data, ...found] : found, note: data.attribution || data.source })); } catch (e) { setResultDialog({ title: "Job search unavailable", body: e.message }); } finally { setBusy(false); } };
  const scan = async () => { if (resume.trim().length < 30 || jd.trim().length < 30) { setResultDialog({ title: "Add both sides of the comparison", body: "Upload or paste your resume and provide a job description (at least 30 characters each) to find grounded strengths and gaps." }); return; } setBusy(true); setError(""); setScreening(""); try { const data = await api("/api/resume/screen", { resume, jobDescription: jd, role: selectedJob?.title || "Selected role" }); setScreening(data.report); setResultDialog({ title: "Resume overlap & gaps", kind: "screening", data: data.report }); } catch (e) { setResultDialog({ title: "Resume review unavailable", body: e.message }); } finally { setBusy(false); } };
  const draftRewrite = async () => { setBusy(true); setError(""); setRewrite(null); try { const data = await api("/api/resume/rewrite", { resume, jobDescription: jd }); setRewrite(data); setResultDialog({ title: "Resume edit suggestions", kind: "rewrite", data }); } catch (e) { setResultDialog({ title: "Could not draft edits", body: e.message }); } finally { setBusy(false); } };
  return <>
    <section className="hero"><div><span className="eyebrow">Find the fit, then find the next step</span><h1>Roles that meet your skills where they are.</h1><p>Matches use skill mentions from the resume text you provide and requirements in our clearly labeled mock job set.</p></div><div className="hero-art"><span className="doodle" style={{ fontSize: 44 }}>resume ✎<br />+ job notes<br />= a clearer map ♡</span></div></section>
    <div className="grid two">
      <section className="card"><div className="card-head"><div><span className="eyebrow">01 · your experience</span><h2>Paste resume text</h2></div><span className="sticker">✎ private draft</span></div><div className="field"><label htmlFor="resume-match">Resume text or skills</label><textarea id="resume-match" value={resume} onChange={(e) => setResume(e.target.value)} placeholder="Paste the experience, projects, tools, and coursework you want to match…" /></div><ResumeUpload onText={setResume} setError={setError} /><div className="grid two" style={{ marginTop: 12 }}><button className="button" onClick={match} disabled={busy}>{busy ? "Finding overlaps…" : "Show role matches →"}</button><button className="button secondary" onClick={draftRewrite} disabled={busy || resume.length < 30 || jd.length < 30}>{busy ? "Drafting safely…" : "Draft evidence-only resume edits"}</button></div></section>
      <section className="card"><div className="card-head"><div><span className="eyebrow">02 · compare evidence</span><h2>Resume notes</h2></div><span className="sticker sun">AI + provided text</span></div><div className="field"><label htmlFor="job-select">Choose a job description</label><select id="job-select" value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Choose a mock role…</option>{overview.jobs?.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}</select></div><div className="field"><label htmlFor="job-description">Job description</label><textarea id="job-description" value={jd} onChange={(e) => setJd(e.target.value)} onInput={(e) => setJd(e.currentTarget.value)} placeholder="Choose a role or paste a description…" /></div><button className="button secondary" onClick={scan} disabled={busy}>{busy ? "Reading both carefully…" : "Find strengths & weak points"}</button></section>
    </div>
    {overview.demoMode ? <div className="status success" style={{ marginTop: 20 }}>Demo mode is on · live job requests are skipped and synthetic job cards are used.</div> : <section className="card" style={{ marginTop: 20 }}><div className="card-head"><div><span className="eyebrow">Live search · official ZipRecruiter connector</span><h2>Find current openings</h2></div><span className="sticker coral">Read-only search</span></div><p>Search ZipRecruiter’s official job-search service. Its listings cover supported U.S. and Canada searches; applications open on ZipRecruiter.</p><div className="grid three"><div className="field"><label htmlFor="live-query">Role or skills</label><input id="live-query" value={liveQuery} onChange={(e) => setLiveQuery(e.target.value)} placeholder="e.g. data engineer, Python" /></div><div className="field"><label htmlFor="live-country">Country</label><select id="live-country" value={liveCountry} onChange={(e) => setLiveCountry(e.target.value)}><option value="US">United States</option><option value="CA">Canada</option></select></div><div className="field"><label htmlFor="live-location">City / region</label><input id="live-location" value={liveLocation} onChange={(e) => setLiveLocation(e.target.value)} placeholder="e.g. Austin, TX" disabled={liveRemote} /></div></div><label className="tiny-label"><input type="checkbox" checked={liveRemote} onChange={(e) => setLiveRemote(e.target.checked)} /> Remote roles</label><div style={{ marginTop: 12 }}><button className="button" disabled={busy || liveQuery.trim().length < 2 || (!liveRemote && liveLocation.trim().length < 2)} onClick={() => searchLive(0)}>{busy ? "Searching live listings…" : "Search ZipRecruiter →"}</button></div>{liveInfo && <p className="tiny-label" style={{ marginTop: 12 }}>{liveInfo}</p>}{liveResults.length > 0 && <div className="grid three" style={{ marginTop: 14 }}>{liveResults.map((job, index) => <article className="card soft" key={`${job.id}-${index}`}><div className="card-head"><MatchScore job={job} /><span className="tiny-label">{job.track?.replaceAll("_", " ") || "role"}</span></div><h3>{job.title}</h3><p><strong>{job.company}</strong><br />{job.location}</p><p>{job.jd_text}</p><div className="tiny-label">Skills from supplied listing: {job.matched_skills?.join(" · ") || job.skills?.join(" · ") || "Not listed"}</div>{job.gaps?.length > 0 && <ProjectedFit job={job} resources={overview.resources || []} />}{job.salary && <small>{job.salary}</small>}<p><a href={job.url} target="_blank" rel="noreferrer">Open original listing ↗</a></p></article>)}</div>}{liveOffset != null && liveResults.length > 0 && <button className="button quiet" style={{ marginTop: 12 }} disabled={busy} onClick={() => searchLive(liveOffset)}>Load five more listings →</button>}</section>}
    {resultDialog && <ResultsDialog dialog={resultDialog} onClose={() => setResultDialog(null)} onMore={resultDialog.kind === "live" && liveOffset != null ? () => searchLive(liveOffset) : null} busy={busy} resources={overview.resources || []} />}
  </>;
}

function ResultsDialog({ dialog, onClose, onMore, busy, resources }) {
  const report = dialog.data;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal results-modal" role="dialog" aria-modal="true" aria-labelledby="results-dialog-title"><div className="card-head"><div><span className="eyebrow">✿ PrepMaxxing notes</span><h2 id="results-dialog-title">{dialog.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close results">Close ×</button></div>
    {dialog.body && <p role="status">{dialog.body}</p>}{dialog.note && <p className="tiny-label">{dialog.note}</p>}
    {dialog.kind === "screening" && report && <><p>{report.summary}</p><div className="grid two"><div><h3>Verified overlaps</h3>{(report.matches || []).map((item, index) => <div className="status success" key={index}><strong>{item.requirement}</strong><p>Resume evidence: “{item.resumeEvidence}”</p></div>)}</div><div><h3>Shortcomings to strengthen</h3>{(report.weak_points || []).map((item, index) => <div className="status" key={index}><strong>{item.requirement}</strong><p>{item.status === "unverified" ? "Suggestion could not be verified against the supplied text." : item.status}</p><p>{item.improvement}</p>{item.resumeEvidence && <small>Evidence: “{item.resumeEvidence}”</small>}</div>)}</div></div></>}
    {dialog.kind === "matches" && <div className="grid two">{dialog.data.map((job) => <article className="card soft" key={job.id}><div className="card-head"><MatchScore job={job} /><span className="tiny-label">{job.level}</span></div><h3>{job.title}</h3><p>{job.jd_text}</p><strong>Matching skills</strong><p>{job.matched_skills?.join(" · ") || "No exact skills found yet"}</p><strong>Skills to build</strong><p>{job.gaps?.join(" · ") || "No listed gaps from the current text"}</p><ProjectedFit job={job} resources={resources} /><small>Synthetic role example</small></article>)}</div>}
    {dialog.kind === "live" && <div className="grid two">{dialog.data.map((job, index) => <article className="card soft" key={`${job.id}-${index}`}><div className="card-head"><MatchScore job={job} /><span className="tiny-label">{job.track?.replaceAll("_", " ") || "role"}</span></div><h3>{job.title}</h3><p><strong>{job.company}</strong><br />{job.location}</p><p>{job.jd_text}</p><div className="tiny-label">Skills: {job.matched_skills?.join(" · ") || job.skills?.join(" · ") || "Not listed"}</div>{job.gaps?.length > 0 && <ProjectedFit job={job} resources={resources} />}{job.salary && <small>{job.salary}</small>}<p><a href={job.url} target="_blank" rel="noreferrer">Open original listing ↗</a></p></article>)}</div>}
    {dialog.kind === "rewrite" && <><p>{report.note}</p>{report.edits?.length ? <div className="grid two">{report.edits.map((edit, index) => <article className="status" key={`${edit.section}-${index}`}><strong>{edit.section}</strong><p><span className="tiny-label">Original</span><br /><del>{edit.originalText || edit.sourceEvidence}</del></p><p><span className="tiny-label">Suggested</span><br /><ins>{edit.proposedText}</ins></p><small>Grounded in: “{edit.sourceEvidence}”</small><p>{edit.reason}</p></article>)}</div> : <div className="empty">No safe edits were found from the supplied text.</div>}</>}
    {onMore && <button className="button quiet" disabled={busy} onClick={onMore}>{busy ? "Loading…" : "Load five more listings →"}</button>}
  </section></div>;
}

function ProgressView({ overview, onRetry }) {
  const attempts = overview.attempts || []; const nonSynthetic = attempts.filter((item) => !item.is_synthetic);
  return <>
    <section className="hero"><div><span className="eyebrow">Your practice, in one place</span><h1>Progress that points toward a next step.</h1><p>Only completed and reviewed reports contribute to an approved readiness picture.</p></div><div className="hero-art"><span className="doodle" style={{ fontSize: 44 }}>one page<br />at a time ✦</span></div></section>
    <div className="grid three"><Metric label="Practice attempts" value={nonSynthetic.length} note="Your real interview sessions" /><Metric label="Approved reports" value={nonSynthetic.filter((item) => item.approved).length} note="Reviewed by the placement cell" /><Metric label="Current focus areas" value={overview.gaps?.filter((g) => !g.is_synthetic).length || 0} note="Evidence-backed skill gaps" /></div>
    <section><div className="section-head"><div><span className="eyebrow">A small timeline</span><h2>Interview history</h2></div></div>{nonSynthetic.length ? <div className="table-wrap"><table><thead><tr><th>Started</th><th>Track</th><th>Status</th><th>Readiness</th><th>Review</th></tr></thead><tbody>{nonSynthetic.map((attempt) => <tr key={attempt.id}><td>{new Date(attempt.started_at).toLocaleDateString()}</td><td>{attempt.track?.replaceAll("_", " ")}</td><td>{attempt.status}</td><td>{attempt.readiness_score == null ? "—" : `${Math.round(Number(attempt.readiness_score))}%`}</td><td>{attempt.approved ? "Approved" : "Awaiting human review"}</td></tr>)}</tbody></table></div> : <div className="empty">No interview attempts yet. Start one whenever you feel ready.</div>}</section>
    {overview.gaps?.some((gap) => !gap.is_synthetic) && <section><div className="section-head"><div><span className="eyebrow">Focus cards</span><h2>Skills to strengthen</h2></div></div><div className="grid three">{overview.gaps.filter((gap) => !gap.is_synthetic).slice(0, 9).map((gap, index) => <article className="card soft" key={`${gap.attempt_id}-${gap.skill}-${index}`}><span className="sticker coral">{gap.severity} focus</span><h3 style={{ marginTop: 10 }}>{gap.skill}</h3><p>{gap.resource_title || "Add a learning resource"}{gap.hours ? ` · ${gap.hours}h` : ""}</p>{gap.url && <a href={gap.url} target="_blank" rel="noreferrer">Explore resource ↗</a>}<button className="button quiet" style={{ marginTop: 10 }} onClick={() => onRetry(gap)}>Re-test this focus →</button></article>)}</div></section>}
  </>;
}

function Metric({ label, value, note }) { return <article className="card"><div className="tiny-label">{label}</div><div className="big-number" style={{ marginTop: 8 }}>{value}</div><p>{note}</p></article>; }

function ReadinessRadar({ attempt }) {
  if (!attempt) return <div className="empty">Your five-round chart appears after your report is approved by placement staff.</div>;
  const scores = Array.isArray(attempt.round_scores) ? attempt.round_scores : [];
  const labels = ["Resume", "DSA", "Role", "Technical", "Behavioral"];
  const values = labels.map((_, index) => Number(scores.find((row) => Number(row.round_num) === index + 1)?.score || 0));
  const point = (index, value) => { const angle = (Math.PI * 2 * index / 5) - Math.PI / 2; const radius = 72 * value / 100; return [100 + Math.cos(angle) * radius, 100 + Math.sin(angle) * radius]; };
  const polygon = values.map((value, index) => point(index, value).join(",")).join(" ");
  return <div className="radar-wrap"><svg viewBox="0 0 200 200" role="img" aria-label="Approved scores across five interview rounds">{[25,50,75,100].map((value) => <polygon key={value} points={labels.map((_, i) => point(i, value).join(",")).join(" ")} className="radar-grid" />)}{labels.map((label, index) => { const [x,y]=point(index,100); const [lx,ly]=point(index,118); return <g key={label}><line x1="100" y1="100" x2={x} y2={y} className="radar-axis"/><text x={lx} y={ly} className="radar-label" textAnchor="middle">{label}</text></g>; })}<polygon points={polygon} className="radar-shape" /></svg><small>Resume · DSA · role studio · technical · behavioral</small></div>;
}

function ProjectedFit({ job, resources }) {
  const gaps = Array.isArray(job.gaps) ? job.gaps : [];
  const suggestions = resources.filter((resource) => gaps.some((gap) => {
    const a = String(gap).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const b = String(resource.skill || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return a === b || a.includes(b) || b.includes(a);
  })).slice(0, 8);
  const [selected, setSelected] = useState([]);
  const covered = [...new Set(selected.map((id) => suggestions.find((resource) => resource.id === id)?.skill).filter(Boolean))];
  const matchedCount = (job.matched_skills || []).length;
  const projected = Math.round((matchedCount + covered.length) * 100 / Math.max(1, matchedCount + gaps.length));
  return <div className="fit-projection" title="Estimate formula: (verified resume skill mentions + selected catalogue skills that match a listed gap) ÷ listed role skills. It is a scenario, not a new assessment."><strong>What-if estimate: {Math.min(100, projected)}%</strong><details><summary>Choose up to 2 resources to explore</summary>{suggestions.length ? suggestions.map((resource) => <label key={resource.id} className="tiny-label"><input type="checkbox" checked={selected.includes(resource.id)} disabled={!selected.includes(resource.id) && selected.length >= 2} onChange={(event) => setSelected((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))} /> {resource.title} · {resource.skill}</label>) : <small>No catalogue resources directly match these listed gaps yet.</small>}</details><small>Estimate only; selecting a resource does not change readiness.</small></div>;
}

function MatchScore({ job }) {
  if (job.score == null) return <span className="sticker sun">Live listing</span>;
  const matched = job.matched_skills?.length || 0;
  const total = matched + (job.gaps?.length || 0);
  const score = Math.max(0, Math.min(100, Number(job.score) || 0));
  return <span className="match-score" title={`${matched} of ${total} listed skills are explicitly mentioned in the resume`}>
    <strong>{score}% match</strong><span>{matched}/{total} skills</span>
  </span>;
}

function GapHeatmap({ gaps }) {
  const skills = [...new Set(gaps.map((row) => row.skill))].slice(0, 7);
  if (!skills.length) return <div className="empty">Approved reports will populate this map.</div>;
  const tracks = TRACKS.map(([key, label]) => ({ key, label }));
  const max = Math.max(1, ...gaps.map((row) => Number(row.gap_count || 0)));
  return <div className="heatmap-wrap"><div className="heatmap" style={{ gridTemplateColumns: `minmax(115px, 1.3fr) repeat(${skills.length}, minmax(58px, 1fr))` }}><span />{skills.map((skill) => <strong key={skill} title={skill}>{skill}</strong>)}{tracks.flatMap(({ key, label }) => [<strong key={`${key}-label`}>{label}</strong>, ...skills.map((skill) => { const count = gaps.filter((row) => row.track === key && row.skill === skill).reduce((sum, row) => sum + Number(row.gap_count || 0), 0); return <span key={`${key}-${skill}`} title={`${label} · ${skill}: ${count} cases`} className="heat-cell" style={{ opacity: count ? 0.28 + 0.72 * count / max : 0.1 }}>{count || "·"}</span>; })])}</div><small>Cell darkness reflects count of approved evidence-backed gaps.</small></div>;
}

function ReadinessTrend({ rows }) {
  const ordered = [...rows].sort((a, b) => String(a.week).localeCompare(String(b.week))).slice(-10);
  if (ordered.length < 2) return <div className="empty">Two or more weeks of approved student reports are needed to draw a trend.</div>;
  const values = ordered.map((row) => Number(row.avg_readiness || 0));
  const min = Math.min(...values, 0); const max = Math.max(...values, 100);
  const points = values.map((value, i) => `${i * 100 / (values.length - 1)},${90 - (value - min) / Math.max(1, max - min) * 72}`).join(" ");
  return <div className="trend-chart"><svg viewBox="0 0 100 100" role="img" aria-label="Average approved readiness by week"><path d="M0 90 H100 M0 54 H100 M0 18 H100" className="chart-grid" /><polyline points={points} className="chart-line" />{values.map((value, i) => <circle key={i} cx={i * 100 / (values.length - 1)} cy={90 - (value - min) / Math.max(1, max - min) * 72} r="2" className="chart-dot"><title>{ordered[i].week}: {value}%</title></circle>)}</svg><div className="chart-labels"><span>{new Date(ordered[0].week).toLocaleDateString()}</span><span>{new Date(ordered.at(-1).week).toLocaleDateString()}</span></div></div>;
}

function StaffDesk({ overview, onRefresh, setError }) {
  const data = overview.analytics || {}; const [selected, setSelected] = useState(null); const [report, setReport] = useState(null); const [busy, setBusy] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("student");
  const [seedMessage, setSeedMessage] = useState("");
  const [roleEmail, setRoleEmail] = useState(""); const [targetRole, setTargetRole] = useState("placement_officer"); const [roleMessage, setRoleMessage] = useState("");
  const seedDemo = async () => { setBusy(true); setError(""); setSeedMessage(""); try { const result = await api("/api/admin", { action: "seed_demo" }); await onRefresh(); setSeedMessage(`${result.inserted} clearly labeled synthetic student profiles are ready for cohort analytics.`); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const inspect = async (attempt) => { setSelected(attempt); setReport(null); try { const result = await api(`/api/admin?attempt=${encodeURIComponent(attempt.id)}`, undefined, "GET"); setReport(result); } catch (e) { setError(e.message); } };
  const approve = async () => { if (!selected) return; setBusy(true); try { await api("/api/admin", { attemptId: selected.id }); setSelected(null); setReport(null); await onRefresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <>
    <section className="hero"><div><span className="eyebrow">Placement cell · cohort notebook</span><h1>Readiness signals, with the evidence attached.</h1><p>Student progress and synthetic demo data are shown separately. Review each candidate report before approval.</p></div><div className="hero-art"><span className="doodle" style={{ fontSize: 45 }}>notice patterns<br />support people ♡</span></div></section>
    <div className="grid three"><Metric label="Reports awaiting review" value={data.pending?.length || 0} note="Human approval is required" /><Metric label="Cohort role tracks" value={new Set((data.progress || []).map((row) => row.track)).size} note="Across the current records" /><Metric label="Skill-gap signals" value={(data.gaps || []).length} note="Grouped by track and skill" /></div>
    {overview.user?.role === "admin" && <section className="card" style={{ marginTop: 20 }}><div className="card-head"><div><span className="eyebrow">Administrator controls</span><h2>Manage placement-cell access</h2></div><span className="sticker sun">Role changes are audited</span></div><p>Grant or remove placement-officer access for an existing account. Student data stays out of the public registration form.</p><div className="grid three"><div className="field"><label htmlFor="staff-email">Account email</label><input id="staff-email" type="email" value={roleEmail} onChange={(event) => setRoleEmail(event.target.value)} placeholder="officer@university.edu" /></div><div className="field"><label htmlFor="staff-role">Role</label><select id="staff-role" value={targetRole} onChange={(event) => setTargetRole(event.target.value)}><option value="placement_officer">Placement officer</option><option value="student">Student</option></select></div><div style={{ alignSelf: "end" }}><button className="button secondary" disabled={busy || !roleEmail.includes("@")} onClick={async () => { setBusy(true); setError(""); setRoleMessage(""); try { const result = await api("/api/admin", { action: "set_role", email: roleEmail, role: targetRole }); setRoleMessage(`${result.user.email} is now ${result.user.role.replaceAll("_", " ")}.`); setRoleEmail(""); await onRefresh(); } catch (error) { setError(error.message); } finally { setBusy(false); } }}>Save access change</button></div></div>{roleMessage && <div className="status success">{roleMessage}</div>}</section>}
    <section className="grid two" style={{ marginTop: 20 }}><article className="card"><div className="card-head"><div><span className="eyebrow">Skills × role track</span><h2>Cohort gap map</h2></div><select aria-label="Analytics data source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option value="student">Student records</option><option value="synthetic">Synthetic demo</option><option value="all">Both sources</option></select></div><GapHeatmap gaps={(data.gaps || []).filter((row) => sourceFilter === "all" || Boolean(row.is_synthetic) === (sourceFilter === "synthetic"))} /></article><article className="card"><span className="eyebrow">Approved reports · {sourceFilter === "synthetic" ? "synthetic" : sourceFilter === "all" ? "all sources" : "student records"}</span><h2>Readiness trend</h2><ReadinessTrend rows={(data.trend || []).filter((row) => sourceFilter === "all" || Boolean(row.is_synthetic) === (sourceFilter === "synthetic"))} /></article></section>
    <section className="card" style={{ marginTop: 20 }}><div className="card-head"><div><span className="eyebrow">Practice funnel</span><h2>Round completion</h2></div><span className="tiny-label">Student sessions · synthetic records excluded</span></div><div className="grid three">{[0,1,2,3,4,5].map((step) => { const count = Number(data.funnel?.find((item) => Number(item.step) === step)?.candidates || 0); const label = step === 0 ? "Started" : `Round ${step}`; const max = Math.max(1, ...((data.funnel || []).map((item) => Number(item.candidates || 0)))); return <div key={step} className="status"><div className="card-head"><strong>{label}</strong><span>{count}</span></div><div className="funnel-track"><span style={{ width: `${Math.round(count / max * 100)}%` }} /></div></div>; })}</div></section>
    {(data.integrity || []).length > 0 && <section className="card integrity-review" style={{ marginTop: 20 }}><div className="card-head"><div><span className="eyebrow">Placement staff review</span><h2>Integrity alerts</h2></div><span className="sticker coral">{data.integrity.length} flagged attempt{data.integrity.length === 1 ? "" : "s"}</span></div><p>These records are review notices, not automatic findings of misconduct.</p><div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Track</th><th>Flags</th><th>Status</th><th>Action</th></tr></thead><tbody>{data.integrity.map((row) => <tr key={row.id}><td>{row.full_name}<br /><small>{row.email}</small></td><td>{row.track?.replaceAll("_", " ")}</td><td>{row.integrity_flags}</td><td>{row.cancelled === "true" ? "Cancelled after tab change" : row.status}</td><td><button className="button quiet" onClick={() => inspect(row)}>Review replay</button></td></tr>)}</tbody></table></div></section>}
    <section><div className="section-head"><div><span className="eyebrow">Needs a human look</span><h2>Pending report approvals</h2></div>{overview.user?.role === "admin" && <button className="button quiet" disabled={busy} onClick={seedDemo}>{busy ? "Preparing sample…" : "Seed clearly labeled demo cohort"}</button>}</div>{seedMessage && <div className="status success">{seedMessage}</div>}{data.pending?.length ? <div className="table-wrap"><table><thead><tr><th>Candidate</th><th>Track</th><th>Score</th><th>Started</th><th>Action</th></tr></thead><tbody>{data.pending.map((row) => <tr key={row.id}><td>{row.full_name}<br /><small>{row.email}</small></td><td>{row.track?.replaceAll("_", " ")}</td><td>{Math.round(Number(row.readiness_score || 0))}%</td><td>{new Date(row.started_at).toLocaleDateString()}</td><td><button className="button quiet" onClick={() => inspect(row)}>Review report</button></td></tr>)}</tbody></table></div> : <div className="empty">No reports are waiting right now.</div>}</section>
    <section className="grid two" style={{ marginTop: 20 }}><article className="card"><span className="eyebrow">What the cohort is practicing</span><h2>Recurring skill gaps</h2>{(data.gaps || []).length ? <div className="table-wrap" style={{ marginTop: 14 }}><table><thead><tr><th>Track</th><th>Skill</th><th>Count</th><th>Source</th></tr></thead><tbody>{data.gaps.slice(0, 15).map((gap, i) => <tr key={`${gap.track}-${gap.skill}-${i}`}><td>{gap.track?.replaceAll("_", " ")}</td><td>{gap.skill}</td><td>{gap.gap_count}</td><td>{gap.is_synthetic ? "Synthetic demo" : "Student record"}</td></tr>)}</tbody></table></div> : <p>No approved gap evidence yet.</p>}</article><article className="card"><span className="eyebrow">Approved, evidence-backed follow-up</span><h2>At-risk students</h2>{(data.risk || []).length ? (data.risk || []).slice(0, 8).map((row) => <div key={row.id} className="status" style={{ marginTop: 10 }}><strong>{row.full_name}</strong> · {row.track?.replaceAll("_", " ")} · {Math.round(Number(row.readiness_score || 0))}%<br /><small>{row.risk_reason}</small></div>) : <p>No approved students currently meet the follow-up threshold.</p>}{(data.progress || []).map((row, i) => <div key={`${row.track}-${i}`} className="tiny-label" style={{ marginTop: 8 }}>{row.track?.replaceAll("_", " ")} · {Number(row.avg_readiness || 0).toFixed(1)}% average · {row.attempts} approved ({row.is_synthetic ? "synthetic" : "student"})</div>)}</article></section>
    {report && <div className="modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) { setReport(null); setSelected(null); } }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><span className="eyebrow">Human review checkpoint</span><h2 id="report-title">{selected?.full_name}'s report</h2><p>Readiness: {Math.round(Number(report.attempt.readiness_score || 0))}% · {report.attempt.track?.replaceAll("_", " ")}</p><div className="status" style={{ maxHeight: 330, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(report.attempt.interview_data?.resumeReport || report.scores, null, 2)}</div><p>The report remains pending until you approve it.</p><div className="grid two"><button className="button" disabled={busy} onClick={approve}>{busy ? "Saving…" : "Approve report"}</button><button className="button secondary" onClick={() => { setReport(null); setSelected(null); }}>Close</button></div></section></div>}
  </>;
}
