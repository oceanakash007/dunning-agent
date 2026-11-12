import { NextResponse } from "next/server";
import { listInvoices } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ invoices: await listInvoices() });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, invoices: [] }, { status: 500 });
  }
}
