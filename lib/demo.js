import { getPool } from "./db";
import { ensureCatalogues, listJobs, listResources } from "./catalogue";

export async function seedDemoCohort() {
  await ensureCatalogues();
  const [jobs, resources] = await Promise.all([listJobs(), listResources()]);
  const tracks = ["machine_learning", "full_stack", "sde", "data_engineering"];
  const names = ["Aarav", "Mira", "Ishaan", "Anaya", "Kabir", "Diya", "Arjun", "Nisha", "Rohan", "Tara"];
  const surnames = ["Demo", "Sample", "Synthetic", "Practice", "Cohort"];
  const allSkills = [...new Set(jobs.flatMap((job) => job.skills || []))].sort();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (let index = 1; index <= 50; index++) {
      const track = tracks[(index - 1) % tracks.length];
      const email = `synthetic.student.${String(index).padStart(3, "0")}@example.test`;
      const student = await client.query(`INSERT INTO students(full_name,email,password_hash,role,track,is_synthetic)
        VALUES($1,$2,NULL,'student',$3,TRUE) ON CONFLICT(email) DO UPDATE SET is_synthetic=TRUE,track=EXCLUDED.track RETURNING id`,
      [`${names[(index - 1) % names.length]} ${surnames[(index - 1) % surnames.length]} ${String(index).padStart(2, "0")}`, email, track]);
      for (let history = 1; history <= 3; history++) {
        const attemptId = `synthetic-${String(index).padStart(3, "0")}-${history}`;
        const score = Math.max(35, Math.min(96, 40 + index % 35 + history * 6 + ((index * 11 + history * 7) % 17 - 8)));
        const skill = allSkills[(index * history) % allSkills.length];
        const resource = resources.find((item) => item.skill.toLowerCase() === skill.toLowerCase()) || resources[(index + history) % resources.length];
        const startedAt = new Date(Date.now() - ((4 - history) * 14 + index % 9) * 86_400_000);
        await client.query(`INSERT INTO attempts(id,student_id,track,started_at,completed_at,readiness_score,status,is_synthetic)
          VALUES($1,$2,$3,$4,$4,$5,'completed',TRUE) ON CONFLICT(id) DO UPDATE SET readiness_score=EXCLUDED.readiness_score`, [attemptId, student.rows[0].id, track, startedAt, score]);
        for (let round = 1; round <= 5; round++) {
          const roundScore = Math.max(0, Math.min(100, score + [3, -8, -3, 1, 5][round - 1]));
          await client.query(`INSERT INTO round_scores(attempt_id,round_num,score,detail_json,is_synthetic)
            VALUES($1,$2,$3,$4::jsonb,TRUE) ON CONFLICT(attempt_id,round_num) DO UPDATE SET score=EXCLUDED.score`,
          [attemptId, round, roundScore, JSON.stringify({ source: "synthetic demo data", round })]);
        }
        await client.query(`INSERT INTO skill_gaps(attempt_id,skill,severity,evidence_json,resource_id,is_synthetic)
          VALUES($1,$2,$3,$4::jsonb,$5,TRUE) ON CONFLICT(attempt_id,skill) DO UPDATE SET severity=EXCLUDED.severity`,
        [attemptId, skill, score < 60 ? "high" : "medium", JSON.stringify([{ type: "synthetic_demo", text: `Representative ${skill} practice gap.` }]), resource.id]);
      }
    }
    await client.query("COMMIT");
    return 50;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
