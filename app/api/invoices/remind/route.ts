import { NextResponse } from "next/server";
import { sendReminder } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { id, note } = await req.json();
    await sendReminder(id, note);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
