import { NextResponse } from "next/server";
import { currentUser, requireUser } from "../../../../lib/auth";
import { jsonError, readJson } from "../../../../lib/http";
import { matchJobs } from "../../../../lib/matching";
import { searchZipRecruiter } from "../../../../lib/jobs/ziprecruiter";
import { listJobs } from "../../../../lib/catalogue";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request) {
  try {
    requireUser(await currentUser());
    const body = await readJson(request);
    const query = String(body.query || "").trim().slice(0, 100);
    const location = String(body.location || "").trim().slice(0, 120);
    const remote = Boolean(body.remote);
    const country = ["US", "CA"].includes(String(body.country || "US").toUpperCase()) ? String(body.country || "US").toUpperCase() : "US";
    if (query.length < 2) throw Object.assign(new Error("Enter a role title or a few skills to search live jobs."), { status: 400 });
    if (process.env.DEMO_MODE === "true") {
      const text = query.toLowerCase();
      const jobs = (await listJobs()).filter((job) => `${job.title} ${job.track} ${(job.skills || []).join(" ")} ${job.jd_text}`.toLowerCase().includes(text));
      const resume = String(body.resume || "").slice(0, 18000);
      const result = resume.trim().length >= 30 && jobs.length ? await matchJobs(resume, jobs) : { matches: jobs.slice(0, 8), mode: "Synthetic demo catalogue" };
      return NextResponse.json({ matches: result.matches, source: "Synthetic demo job catalogue", attribution: "Demo mode is on; live job search is disabled.", matchMode: result.mode });
    }
    if (!remote && location.length < 2) throw Object.assign(new Error("Add a U.S. or Canadian city, or choose remote roles."), { status: 400 });
    const result = await searchZipRecruiter({ query, location, remote, country, offset: Math.max(0, Math.min(5, Number(body.offset) || 0)) });
    const resume = String(body.resume || "").slice(0, 18000);
    if (resume.trim().length >= 30 && result.jobs.length) {
      const ranked = await matchJobs(resume, result.jobs);
      return NextResponse.json({ ...result, matches: ranked.matches, matchMode: ranked.mode, warning: ranked.warning });
    }
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
