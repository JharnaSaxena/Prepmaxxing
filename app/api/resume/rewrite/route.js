import { NextResponse } from "next/server";
import { currentUser, requireUser } from "../../../../lib/auth";
import { askAI } from "../../../../lib/ai";
import { jsonError, readJson } from "../../../../lib/http";
import { exactEvidence, parseJsonObject } from "../../../../lib/evidence";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(request) {
  try {
    requireUser(await currentUser());
    const body = await readJson(request);
    const resume = String(body.resume || "").slice(0, 18000);
    const jd = String(body.jobDescription || "").slice(0, 14000);
    if (resume.trim().length < 30 || jd.trim().length < 30) throw Object.assign(new Error("Add resume and role text before drafting a rewrite."), { status: 400 });
    const raw = await askAI("You are an evidence-only resume editor. Do not add skills, outcomes, numbers, responsibilities, titles, or facts not stated in the original resume. Reorder or clarify only provided facts to better surface requirements in the job description. Return JSON only: {edits:[{section,sourceEvidence,originalText,proposedText,reason}]}. sourceEvidence must be a verbatim substring of the original resume. Keep proposedText truthful and conservative. If a useful edit cannot be grounded in an exact source quote, omit it. Do not draft missing qualifications.", `JOB DESCRIPTION:\n${jd}\nORIGINAL RESUME:\n${resume}`, { temperature: 0.1, maxTokens: 1600 });
    const parsed = parseJsonObject(raw);
    const edits = (Array.isArray(parsed.edits) ? parsed.edits : []).slice(0, 12).map((edit) => ({
      section: String(edit.section || "Resume section").slice(0, 100),
      sourceEvidence: String(edit.sourceEvidence || "").trim(),
      originalText: String(edit.originalText || "").slice(0, 1200),
      proposedText: String(edit.proposedText || "").slice(0, 1200),
      reason: String(edit.reason || "").slice(0, 400),
      verified: exactEvidence(resume, edit.sourceEvidence),
    })).filter((edit) => edit.verified && edit.proposedText);
    return NextResponse.json({ edits, note: "Suggestions quote the source resume. Review every change and keep only facts you can personally verify; nothing was saved or replaced." });
  } catch (error) { return jsonError(error); }
}
