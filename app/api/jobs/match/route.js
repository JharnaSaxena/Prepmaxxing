import { NextResponse } from "next/server";
import { currentUser, requireUser } from "../../../../lib/auth";
import { jsonError, readJson } from "../../../../lib/http";
import { listJobs } from "../../../../lib/catalogue";
import { matchJobs } from "../../../../lib/matching";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    requireUser(await currentUser());
    const body = await readJson(request);
    const resume = `${body.resume || ""}\n${body.skills || ""}`.trim().slice(0, 18000);
    if (resume.trim().length < 30) throw Object.assign(new Error("Add a little more resume or skills detail to find useful matches."), { status: 400 });
    const jobs = await listJobs();
    const result = await matchJobs(resume, jobs);
    return NextResponse.json(result);
  } catch (error) { return jsonError(error); }
}
