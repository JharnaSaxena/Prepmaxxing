import { NextResponse } from "next/server";
import { currentUser, requireAdmin, requireStaff } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { appendAuditEvent } from "../../../lib/audit";
import { jsonError, readJson } from "../../../lib/http";
import { seedDemoCohort } from "../../../lib/demo";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const user = requireStaff(await currentUser());
    const id = new URL(request.url).searchParams.get("attempt");
    if (!id) return NextResponse.json({ error: "Attempt ID is required." }, { status: 400 });
    const { rows } = await query(`SELECT a.id,a.track,a.started_at,a.completed_at,a.readiness_score,a.status,s.full_name,s.email,
      ri.phase,ri.integrity_flags,ri.events,ri.submissions,ri.interview_data,ap.approved_at
      FROM attempts a JOIN students s ON s.id=a.student_id LEFT JOIN approvals ap ON ap.attempt_id=a.id
      LEFT JOIN LATERAL (SELECT * FROM repoready_interviews WHERE attempt_id=a.id ORDER BY updated_at DESC LIMIT 1) ri ON TRUE
      WHERE a.id=$1`, [id]);
    if (!rows[0]) throw Object.assign(new Error("Attempt not found."), { status: 404 });
    const scoreRows = await query("SELECT round_num,score,detail_json FROM round_scores WHERE attempt_id=$1 ORDER BY round_num", [id]);
    return NextResponse.json({ attempt: rows[0], scores: scoreRows.rows, viewer: user.role });
  } catch (error) { return jsonError(error); }
}

export async function POST(request) {
  try {
    const user = requireStaff(await currentUser());
    const body = await readJson(request);
    if (body.action === "set_role") {
      requireAdmin(user);
      const email = String(body.email || "").trim().toLowerCase();
      const role = String(body.role || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["student", "placement_officer"].includes(role)) throw Object.assign(new Error("Choose an existing account email and one of the allowed staff roles."), { status: 400 });
      const { rows } = await query("UPDATE students SET role=$1 WHERE lower(email)=lower($2) RETURNING id,email,role", [role, email]);
      if (!rows[0]) throw Object.assign(new Error("No account exists with that email."), { status: 404 });
      await appendAuditEvent({ type: "staff_role_updated", target: rows[0].email, role }, user.id, null);
      return NextResponse.json({ user: rows[0] });
    }
    if (body.action === "seed_demo") {
      requireAdmin(user);
      const inserted = await seedDemoCohort();
      await appendAuditEvent({ type: "synthetic_cohort_seeded", inserted }, user.id, null);
      return NextResponse.json({ inserted });
    }
    const { attemptId } = body;
    if (!attemptId) throw Object.assign(new Error("Attempt ID is required."), { status: 400 });
    const attempt = await query("SELECT status,is_synthetic FROM attempts WHERE id=$1", [attemptId]);
    if (!attempt.rows[0] || attempt.rows[0].status !== "completed" || attempt.rows[0].is_synthetic) throw Object.assign(new Error("Only completed student reports can be approved."), { status: 400 });
    await query("INSERT INTO approvals(attempt_id,approved_by) VALUES($1,$2) ON CONFLICT(attempt_id) DO NOTHING", [attemptId, user.id]);
    await query("UPDATE repoready_interviews SET report_approved=TRUE,updated_at=NOW() WHERE attempt_id=$1", [attemptId]);
    await appendAuditEvent({ type: "placement_officer_approved_report", reviewer: user.id }, user.id, attemptId);
    return NextResponse.json({ approved: true });
  } catch (error) { return jsonError(error); }
}
