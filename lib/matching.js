import { askAI } from "./ai";
import { exactEvidence, parseJsonObject } from "./evidence";

const terms = (text) => String(text || "").toLowerCase().match(/[a-z][a-z0-9+#.-]{1,}/g) || [];
function vector(text) {
  const counts = new Map();
  for (const token of terms(text)) counts.set(token, (counts.get(token) || 0) + 1);
  const norm = Math.sqrt([...counts.values()].reduce((sum, n) => sum + n * n, 0)) || 1;
  for (const [token, n] of counts) counts.set(token, n / norm);
  return counts;
}
function cosine(a, b) {
  let score = 0;
  for (const [token, weight] of a) score += weight * (b.get(token) || 0);
  return score;
}

function skillMentioned(resume, skill) {
  const escaped = String(skill || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  // Require word boundaries around simple skill names, so e.g. "C" does not
  // match the letter inside "machine". Punctuation inside names (C++, Node.js)
  // remains literal.
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(String(resume || ""));
}

function scoreSkills(resume, job) {
  const skills = [...new Set((job.skills || []).map((skill) => String(skill).trim()).filter(Boolean))];
  const matched = skills.filter((skill) => skillMentioned(resume, skill));
  const gaps = skills.filter((skill) => !matched.includes(skill));
  return {
    score: skills.length ? Math.round((matched.length / skills.length) * 100) : 0,
    matched_skills: matched,
    gaps,
  };
}

export async function matchJobs(resume, jobs) {
  const resumeVector = vector(resume);
  const ranked = jobs.map((job) => {
    const similarity = cosine(resumeVector, vector(`${job.title} ${job.jd_text} ${(job.skills || []).join(" ")}`));
    return { job, similarity, ...scoreSkills(resume, job) };
  });
  const shortlist = [...ranked].sort((a, b) => b.similarity - a.similarity).slice(0, 12);
  const byFit = (a, b) => b.score - a.score || b.similarity - a.similarity;
  const fallback = ranked.map(({ job, similarity, score, matched_skills, gaps }) => ({
    ...job, score, matched_skills, gaps,
    reasons: matched_skills.map((skill) => ({ requirement: skill, resumeEvidence: skill, evidenceVerified: true })),
    source: "synthetic catalogue", similarity,
  })).sort(byFit).slice(0, 8);
  try {
    const prompt = shortlist.map(({ job, similarity }, index) => `${index + 1}. id=${job.id}; title=${job.title}; track=${job.track}; skills=${(job.skills || []).join(", ")}; requirements=${job.jd_text}; shortlist_similarity=${similarity.toFixed(3)}`).join("\n");
    const answer = await askAI("Rank these candidate roles using only the provided resume and role text. Return JSON only: {matches:[{id,matched:[{requirement,resumeEvidence}],reason:string}]}. Each resumeEvidence must be a verbatim substring of the resume. Never assume a skill from a title or adjacent skill. Do not calculate scores; the application calculates them from directly mentioned listed skills. Return at most 8 matches.", `RESUME:\n${resume.slice(0, 18000)}\nROLE SHORTLIST:\n${prompt}`, { temperature: 0.1, maxTokens: 1400 });
    const parsed = parseJsonObject(answer);
    const byId = new Map(shortlist.map(({ job }) => [String(job.id), job]));
    const matches = (parsed.matches || []).map((item) => {
      const job = byId.get(String(item.id));
      if (!job) return null;
      const verified = (Array.isArray(item.matched) ? item.matched : []).filter((hit) =>
        exactEvidence(resume, hit.resumeEvidence) && (job.skills || []).some((skill) => skill.toLowerCase() === String(hit.requirement || "").toLowerCase() || job.jd_text.toLowerCase().includes(String(hit.requirement || "").toLowerCase())));
      const fit = scoreSkills(resume, job);
      return { ...job, ...fit, reasons: verified, explanation: String(item.reason || "Ranked against the provided role requirements."), source: "synthetic catalogue" };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return { matches: matches.length ? matches.slice(0, 8) : fallback, mode: matches.length ? "AI reranked with checked evidence" : "TF-IDF fallback", warning: "Match scores are calculated from directly mentioned listed skills: matched skills ÷ total listed skills. They are practice guidance, not hiring decisions." };
  } catch {
    return { matches: fallback, mode: "TF-IDF fallback", warning: "AI ranking is temporarily unavailable. Match scores use directly mentioned listed skills: matched skills ÷ total listed skills. They are practice guidance, not hiring decisions." };
  }
}
