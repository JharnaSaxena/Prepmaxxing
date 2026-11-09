import { NextResponse } from "next/server";

export function jsonError(error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("PrepMaxxing API error:", error?.message || error);
  const message = String(error?.message || "");
  if (/DATABASE_URL is not configured/i.test(message)) {
    return NextResponse.json({ error: "The local database is not configured yet. Add DATABASE_URL to .env.local and apply migrations 001–003 before creating an account." }, { status: 503 });
  }
  if (/ECONNREFUSED|ENOTFOUND|connection timeout|timeout expired/i.test(message)) {
    return NextResponse.json({ error: "The database could not be reached. Check your DATABASE_URL and confirm the database is running." }, { status: 503 });
  }
  return NextResponse.json({ error: status >= 500 ? "Something went wrong. Please try again shortly." : error.message }, { status });
}

export async function readJson(request) {
  try { return await request.json(); }
  catch { throw Object.assign(new Error("Please send a valid JSON request."), { status: 400 }); }
}
