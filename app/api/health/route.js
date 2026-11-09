import { NextResponse } from "next/server";
import { query } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true, service: "prepmaxxing", database: "connected" });
  } catch {
    return NextResponse.json({ ok: false, service: "prepmaxxing", database: "unavailable" }, { status: 503 });
  }
}
