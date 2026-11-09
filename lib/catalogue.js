import { query } from "./db";
import seeds from "../app/data/seed.json";
import bugHunts from "../app/data/bughunt.json";
import resources from "../data/resource_catalogue.json";

let seeded;

export async function ensureCatalogues() {
  if (seeded) return;
  if (!seeded) seeded = (async () => {
    const insertMany = async (table, columns, rows, values) => {
      if (!rows.length) return;
      const width = columns.length;
      const groups = rows.map((_, row) => `(${Array.from({ length: width }, (_v, col) => `$${row * width + col + 1}`).join(",")},TRUE)`);
      await query(`INSERT INTO ${table}(${columns.join(",")},is_synthetic) VALUES ${groups.join(",")} ON CONFLICT(id) DO NOTHING`, rows.flatMap(values));
    };
    await insertMany("jobs", ["id", "title", "track", "level", "skills", "jd_text"], seeds.JOB_CATALOGUE, (job) => [job.id, job.title, job.track, job.level, job.skills, job.jd_text]);
    await insertMany("resources", ["id", "title", "skill", "url", "hours", "description"], resources, (resource) => [resource.id, resource.title, resource.skill, resource.url, resource.hours, resource.description || ""]);
  })().catch((error) => { seeded = null; throw error; });
  await seeded;
}

export async function listJobs() {
  await ensureCatalogues();
  const { rows } = await query("SELECT id,title,track,level,skills,jd_text,is_synthetic FROM jobs ORDER BY title");
  return rows;
}

export async function listResources() {
  await ensureCatalogues();
  const { rows } = await query("SELECT id,title,skill,url,hours,description,is_synthetic FROM resources ORDER BY title");
  return rows;
}

export { seeds, bugHunts };
