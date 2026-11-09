import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { hashPassword, setSession, verifyPassword } from "../../../../lib/auth";
import { jsonError, readJson } from "../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { email = "", password = "" } = await readJson(request);
    if (!String(email).trim() || !String(password)) throw Object.assign(new Error("Enter your email and password to continue."), { status: 400 });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (process.env.INITIAL_ADMIN_EMAIL && process.env.INITIAL_ADMIN_PASSWORD && normalizedEmail === process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase()) {
      const { rows: bootstrap } = await query(`INSERT INTO students(full_name,email,password_hash,role,is_synthetic)
        VALUES($1,$2,$3,'admin',FALSE) ON CONFLICT(email) DO UPDATE
        SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,role='admin',is_synthetic=FALSE
        RETURNING id`,
      [process.env.INITIAL_ADMIN_NAME || "Placement Admin", normalizedEmail, hashPassword(process.env.INITIAL_ADMIN_PASSWORD)]);
      void bootstrap;
    }
    const { rows } = await query("SELECT id,full_name,email,password_hash,role,track,is_synthetic FROM students WHERE lower(email)=lower($1) LIMIT 1", [normalizedEmail]);
    const user = rows[0];
    if (!user || !verifyPassword(String(password), user.password_hash)) throw Object.assign(new Error("Those sign-in details don't match an account."), { status: 401 });
    delete user.password_hash;
    const response = NextResponse.json({ user });
    setSession(response, user);
    return response;
  } catch (error) { return jsonError(error); }
}
