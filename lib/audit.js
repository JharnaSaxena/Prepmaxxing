import { createHash } from "node:crypto";
import { query } from "./db";

export async function appendAuditEvent(event, studentId, attemptId) {
  const scope = attemptId || `student:${studentId || "system"}`;
  const canonicalize = (value) => Array.isArray(value) ? `[${value.map(canonicalize).join(",")}]`
    : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
      : JSON.stringify(value);
  const canonical = canonicalize(event);
  const client = await (await import("./db")).getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [scope]);
    const { rows } = await client.query("SELECT hash FROM audit_log WHERE attempt_id IS NOT DISTINCT FROM $1 AND student_id IS NOT DISTINCT FROM $2 ORDER BY id DESC LIMIT 1", [attemptId || null, studentId || null]);
    const previous = rows[0]?.hash || "0".repeat(64);
    const hash = createHash("sha256").update(scope + previous + canonical).digest("hex");
    await client.query("INSERT INTO audit_log(student_id,attempt_id,event_json,prev_hash,hash) VALUES($1,$2,$3::jsonb,$4,$5)", [studentId || null, attemptId || null, JSON.stringify(event), previous, hash]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
