import { NextResponse } from "next/server";
import { chat, parseJson, rateLimit } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You turn messy freelancer notes, chat messages, emails or photos of job sheets into a clean invoice draft.
Today's date is {TODAY}.
Return ONLY a JSON object with this exact shape:
{
  "client_name": string,            // person or company to bill
  "client_email": string,           // "" if not present
  "currency": string,               // ISO 4217 code, default "USD" if unclear
  "due_date": string,               // YYYY-MM-DD; resolve relative dates like "Friday" or "in 2 weeks"; default 7 days from today; never before today
  "items": [ { "name": string, "quantity": number, "unit_price": number } ],
  "note": string,                   // a short, warm thank-you note to the client (1 sentence)
  "summary": string,                // one line describing what you understood
  "missing": string[]               // fields you could not find and guessed
}
Prices must be numbers without currency symbols. If only a total is given, use one line item with quantity 1.`;

export async function POST(req: Request) {
  try {
    rateLimit();
    const { text, image } = await req.json();
    if (!text && !image) return NextResponse.json({ error: "Paste some text or upload an image." }, { status: 400 });
    const today = new Date().toISOString().slice(0, 10);
    const content: any[] = [{ type: "text", text: text || "Extract the invoice from this image." }];
    if (image) content.push({ type: "image_url", image_url: { url: image } });
    const msg = await chat([
      { role: "system", content: SYSTEM.replace("{TODAY}", today) },
      { role: "user", content },
    ]);
    const draft = parseJson(typeof msg?.content === "string" ? msg.content : "");
    if (!draft) return NextResponse.json({ error: "The AI could not read that. Try adding more detail." }, { status: 422 });
    if (!draft.client_email && process.env.DEMO_CLIENT_EMAIL) draft.client_email = process.env.DEMO_CLIENT_EMAIL;
    if (!draft.due_date || draft.due_date < today) {
      const d = new Date(Date.now() + 7 * 86_400_000);
      draft.due_date = d.toISOString().slice(0, 10);
    }
    draft.items = (draft.items || []).map((i: any) => ({
      name: String(i.name || "Service"),
      quantity: Number(i.quantity) || 1,
      unit_price: Number(String(i.unit_price).replace(/[^0-9.]/g, "")) || 0,
    }));
    return NextResponse.json({ draft });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
