import { NextResponse } from "next/server";
import { query } from "../../../../lib/db";
import { hashPassword, setSession } from "../../../../lib/auth";
import { jsonError, readJson } from "../../../../lib/http";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await readJson(request);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const track = String(body.track || "sde");
    if (name.length < 2) throw Object.assign(new Error("Add your name to create the account."), { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
    if (password.length < 10) throw Object.assign(new Error("Choose a password with at least 10 characters."), { status: 400 });
    if (!Object.hasOwn({ machine_learning: 1, full_stack: 1, sde: 1, data_engineering: 1 }, track)) throw Object.assign(new Error("Choose one of the available tracks."), { status: 400 });
    const { rows } = await query(`INSERT INTO students(full_name,email,password_hash,role,track,is_synthetic)
      VALUES($1,$2,$3,'student',$4,FALSE) RETURNING id,full_name,email,role,track,is_synthetic`, [name, email, hashPassword(password), track]);
    const response = NextResponse.json({ user: rows[0] }, { status: 201 });
    setSession(response, rows[0]);
    return response;
  } catch (error) {
    if (error.code === "23505") return NextResponse.json({ error: "An account already uses that email. Sign in or use another address." }, { status: 409 });
    return jsonError(error);
  }
}
