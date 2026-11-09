import { NextResponse } from "next/server";
import { currentUser, requireStaff } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { jsonError } from "../../../lib/http";
import { listJobs, listResources } from "../../../lib/catalogue";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw Object.assign(new Error("Please sign in to continue."), { status: 401 });
    const [jobs, resources] = await Promise.all([listJobs(), listResources()]);
    if (user.role === "student") {
      const [attempts, gaps] = await Promise.all([
        query(`SELECT a.id,a.track,a.started_at,a.completed_at,CASE WHEN EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id) THEN a.readiness_score ELSE NULL END AS readiness_score,a.status,a.is_synthetic,
          COALESCE(j.title,'Role assessment') AS job_title, EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id) AS approved,
          CASE WHEN EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id) THEN
            COALESCE((SELECT jsonb_agg(jsonb_build_object('round_num',rs.round_num,'score',rs.score) ORDER BY rs.round_num)
              FROM round_scores rs WHERE rs.attempt_id=a.id), '[]'::jsonb) ELSE '[]'::jsonb END AS round_scores
          FROM attempts a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.student_id=$1 ORDER BY a.started_at DESC`, [user.id]),
        query(`SELECT g.skill,g.severity,g.evidence_json,g.resource_id,r.title AS resource_title,r.url,r.hours,a.id AS attempt_id
          FROM skill_gaps g JOIN attempts a ON a.id=g.attempt_id LEFT JOIN resources r ON r.id=g.resource_id
          WHERE a.student_id=$1 AND EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id) ORDER BY a.started_at DESC`, [user.id]),
      ]);
      const score = attempts.rows.find((item) => item.readiness_score != null)?.readiness_score ?? null;
      return NextResponse.json({ user, jobs, resources, attempts: attempts.rows, gaps: gaps.rows, readiness: score, demoMode: process.env.DEMO_MODE === "true" });
    }
    requireStaff(user);
    const [gaps, risk, progress, trend, funnel, integrity, pending] = await Promise.all([
      query(`SELECT s.track,g.skill,a.is_synthetic,COUNT(DISTINCT a.id)::int AS gap_count FROM skill_gaps g
        JOIN attempts a ON a.id=g.attempt_id JOIN students s ON s.id=a.student_id
        WHERE a.is_synthetic OR EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id)
        GROUP BY s.track,g.skill,a.is_synthetic ORDER BY s.track,g.skill,a.is_synthetic`),
      query(`SELECT a.id,a.started_at,a.readiness_score,a.track,s.full_name,s.email,s.is_synthetic,
        CASE WHEN EXISTS(SELECT 1 FROM skill_gaps g WHERE g.attempt_id=a.id AND g.severity='high') THEN 'multiple high-priority evidence gaps'
             WHEN a.readiness_score<40 THEN 'readiness below 40%' ELSE 'needs follow-up review' END AS risk_reason FROM attempts a
        JOIN students s ON s.id=a.student_id WHERE a.status='completed' AND a.readiness_score<60 AND (a.is_synthetic OR EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id))
        ORDER BY a.readiness_score ASC LIMIT 25`),
      query(`SELECT s.track,a.is_synthetic,AVG(a.readiness_score)::numeric(5,1) AS avg_readiness,COUNT(*)::int AS attempts
        FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.readiness_score IS NOT NULL AND (a.is_synthetic OR EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id))
        GROUP BY s.track,a.is_synthetic ORDER BY s.track,a.is_synthetic`),
      query(`SELECT DATE_TRUNC('week',a.completed_at)::date AS week,s.track,a.is_synthetic,AVG(a.readiness_score)::numeric(5,1) AS avg_readiness,COUNT(*)::int AS attempts
        FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.readiness_score IS NOT NULL AND (a.is_synthetic OR EXISTS(SELECT 1 FROM approvals ap WHERE ap.attempt_id=a.id))
        GROUP BY DATE_TRUNC('week',a.completed_at),s.track,a.is_synthetic ORDER BY week`),
      query(`SELECT step,COUNT(*)::int AS candidates FROM (
        SELECT a.id,CASE WHEN COALESCE(ri.interview_data->'completedRounds' @> '[5]'::jsonb,FALSE) THEN 5
          WHEN COALESCE(ri.interview_data->'completedRounds' @> '[4]'::jsonb,FALSE) THEN 4
          WHEN COALESCE(ri.interview_data->'completedRounds' @> '[3]'::jsonb,FALSE) THEN 3
          WHEN COALESCE(ri.interview_data->'completedRounds' @> '[2]'::jsonb,FALSE) THEN 2
          WHEN COALESCE(ri.interview_data->'completedRounds' @> '[1]'::jsonb,FALSE) THEN 1 ELSE 0 END AS step
        FROM attempts a LEFT JOIN LATERAL (SELECT interview_data FROM repoready_interviews WHERE attempt_id=a.id ORDER BY updated_at DESC LIMIT 1) ri ON TRUE
        WHERE NOT a.is_synthetic) t GROUP BY step ORDER BY step`),
      query(`SELECT a.id,a.track,a.started_at,s.full_name,s.email,ri.integrity_flags,a.status,
        ri.interview_data->>'cancelled' AS cancelled FROM attempts a JOIN students s ON s.id=a.student_id
        JOIN LATERAL (SELECT integrity_flags,interview_data FROM repoready_interviews WHERE attempt_id=a.id ORDER BY updated_at DESC LIMIT 1) ri ON TRUE
        WHERE ri.integrity_flags>0 AND NOT a.is_synthetic ORDER BY a.started_at DESC LIMIT 50`),
      query(`SELECT a.id,a.started_at,a.readiness_score,a.track,s.full_name,s.email FROM attempts a JOIN students s ON s.id=a.student_id
        LEFT JOIN approvals ap ON ap.attempt_id=a.id WHERE a.status='completed' AND ap.id IS NULL AND NOT a.is_synthetic
        ORDER BY a.completed_at DESC`),
    ]);
    return NextResponse.json({ user, jobs, resources, demoMode: process.env.DEMO_MODE === "true", analytics: { gaps: gaps.rows, risk: risk.rows, progress: progress.rows, trend: trend.rows, funnel: funnel.rows, integrity: integrity.rows, pending: pending.rows } });
  } catch (error) { return jsonError(error); }
}
