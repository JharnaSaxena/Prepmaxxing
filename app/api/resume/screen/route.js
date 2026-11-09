import { NextResponse } from "next/server";
import { currentUser, requireUser } from "../../../../lib/auth";
import { askAI } from "../../../../lib/ai";
import { jsonError, readJson } from "../../../../lib/http";
import { parseJsonObject, validateResumeEvidence } from "../../../../lib/evidence";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request) {
  try {
    requireUser(await currentUser());
    const body = await readJson(request);
    const resume = String(body.resume || "").slice(0, 18000);
    const jd = String(body.jobDescription || "").slice(0, 14000);
    if (resume.trim().length < 30 || jd.trim().length < 30) throw Object.assign(new Error("Paste a resume and a job description so the review can compare both."), { status: 400 });
    const raw = await askAI(`Compare only the supplied resume and job description. Do not infer years, skills, degrees, employers or results. Return JSON only: {summary:string,matches:[{requirement,resumeEvidence}],weak_points:[{requirement,resumeEvidence,status:'absent|unclear',improvement}]}. Cite a verbatim resume substring for every match and every weak point that is unclear. For an absent requirement, set resumeEvidence to an empty string. Never invent facts.`, `TARGET ROLE: ${body.role || ""}\nJOB DESCRIPTION:\n${jd}\nRESUME:\n${resume}`, { temperature: 0.1, maxTokens: 1400 });
    const report = validateResumeEvidence(parseJsonObject(raw), resume, jd);
    return NextResponse.json({ report, evidenceChecked: true });
  } catch (error) { return jsonError(error); }
}
