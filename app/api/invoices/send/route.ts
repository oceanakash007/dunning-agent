import { NextResponse } from "next/server";
import { createAndSendInvoice } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { draft } = await req.json();
    if (!draft?.client_email) return NextResponse.json({ error: "Client email is required." }, { status: 400 });
    if (!draft?.items?.length) return NextResponse.json({ error: "Add at least one line item." }, { status: 400 });
    const result = await createAndSendInvoice(draft);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
