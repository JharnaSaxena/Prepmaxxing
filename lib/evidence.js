export function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

export function exactEvidence(text, quote) {
  const source = String(text || "");
  const cited = String(quote || "").trim();
  return Boolean(cited && source.toLocaleLowerCase().includes(cited.toLocaleLowerCase()));
}

export function validateResumeEvidence(report, resume, jd) {
  const requirements = String(jd || "").split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 8);
  const validate = (items = [], kind) => (Array.isArray(items) ? items : []).map((item) => {
    const requirement = String(item.requirement || "").trim();
    const quote = String(item.resumeEvidence || item.evidence || "").trim();
    const requirementSupported = requirements.some((line) => line.toLowerCase().includes(requirement.toLowerCase()) || requirement.toLowerCase().includes(line.toLowerCase()));
    const resumeSupported = exactEvidence(resume, quote);
    return { ...item, requirement, resumeEvidence: quote, evidenceVerified: requirementSupported && resumeSupported, status: requirementSupported && resumeSupported ? (kind === "match" ? "verified" : item.status || "unclear") : "unverified" };
  });
  const matches = validate(report.matches, "match").filter((item) => item.evidenceVerified);
  const weakPoints = validate(report.weak_points, "gap").filter((item) => item.evidenceVerified || item.status === "unverified");
  return { ...report, matches, weak_points: weakPoints, evidenceNote: "Quoted resume evidence and job requirements are checked against the text provided." };
}
