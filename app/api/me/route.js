import { NextResponse } from "next/server";
import { currentUser } from "../../../lib/auth";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ user: await currentUser() }); }
