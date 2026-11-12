import { NextResponse } from "next/server";
import { chat, rateLimit } from "@/lib/llm";
import { listInvoices, sendReminder, getInvoice, cancelInvoice, createAndSendInvoice, isUnpaid } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You are Dunning Agent, an AI accounts-receivable assistant for a freelancer.
You act on the freelancer's PayPal account through tools. Today is {TODAY}.
Rules:
- Always call list_invoices first to ground yourself in real data before answering questions about money owed.
- When asked to remind clients, actually call send_reminder for each matching unpaid invoice, writing a short personalised note
  whose tone matches the request (polite, firm, final notice). Escalate tone with days overdue if no tone is given.
- Never remind or cancel invoices that are PAID, MARKED_AS_PAID, CANCELLED or DRAFT.
- Only call cancel_invoice when the user explicitly asks to cancel a specific invoice.
- Only call create_invoice when the user gives a client, an email and an amount.
- Finish with a short, friendly summary (max 5 lines) of what you did and what is still owed, with amounts and currency.`;

const tools = [
  {
    type: "function",
    function: {
      name: "list_invoices",
      description: "List all PayPal invoices with client, status, amount, amount due, due date and days overdue.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_reminder",
      description: "Send a PayPal payment reminder email for an unpaid invoice.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string" },
          note: { type: "string", description: "Personalised reminder message to the client" },
        },
        required: ["invoice_id", "note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoice",
      description: "Get a single invoice by id.",
      parameters: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_invoice",
      description: "Cancel a sent invoice. Only when the user explicitly asks.",
      parameters: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "create_invoice",
      description: "Create and send a new PayPal invoice.",
      parameters: {
        type: "object",
        properties: {
          client_name: { type: "string" },
          client_email: { type: "string" },
          currency: { type: "string" },
          due_date: { type: "string", description: "YYYY-MM-DD" },
          item_name: { type: "string" },
          amount: { type: "number" },
        },
        required: ["client_name", "client_email", "item_name", "amount"],
      },
    },
  },
];

async function runTool(name: string, args: any) {
  switch (name) {
    case "list_invoices": {
      const rows = await listInvoices();
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        client: r.client,
        status: r.status,
        amount: r.amount,
        amount_due: r.due,
        currency: r.currency,
        due_date: r.dueDate,
        days_overdue: r.daysOverdue,
      }));
    }
    case "send_reminder": {
      const inv = await getInvoice(args.invoice_id);
      if (!isUnpaid(inv.status)) return { skipped: true, reason: `Invoice is ${inv.status}` };
      await sendReminder(args.invoice_id, args.note);
      return { ok: true, client: inv.client, amount_due: inv.due, currency: inv.currency };
    }
    case "get_invoice":
      return await getInvoice(args.invoice_id);
    case "cancel_invoice":
      return await cancelInvoice(args.invoice_id);
    case "create_invoice":
      return await createAndSendInvoice({
        client_name: args.client_name,
        client_email: args.client_email,
        currency: args.currency || "USD",
        due_date: args.due_date,
        items: [{ name: args.item_name, quantity: 1, unit_price: Number(args.amount) }],
      });
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export async function POST(req: Request) {
  const actions: { tool: string; args: any; ok: boolean; detail: string }[] = [];
  try {
    rateLimit();
    const { message } = await req.json();
    if (!message) return NextResponse.json({ error: "Type a command." }, { status: 400 });
    const messages: any[] = [
      { role: "system", content: SYSTEM.replace("{TODAY}", new Date().toISOString().slice(0, 10)) },
      { role: "user", content: String(message).slice(0, 2000) },
    ];
    for (let step = 0; step < 8; step++) {
      const reply: any = await chat(messages, tools);
      if (!reply) break;
      const calls = reply.tool_calls || [];
      if (!calls.length) {
        return NextResponse.json({ reply: reply.content || "Done.", actions });
      }
      messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const name = call.function?.name;
        let args: any = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {}
        let result: any;
        try {
          result = await runTool(name, args);
          if (name !== "list_invoices" && name !== "get_invoice") {
            actions.push({
              tool: name,
              args,
              ok: !result?.skipped,
              detail: result?.skipped ? result.reason : name === "send_reminder" ? `Reminder sent to ${result.client}` : "Done",
            });
          } else {
            actions.push({ tool: name, args, ok: true, detail: Array.isArray(result) ? `${result.length} invoices read` : "Read" });
          }
        } catch (e: any) {
          result = { error: e.message };
          actions.push({ tool: name, args, ok: false, detail: e.message.slice(0, 200) });
        }
        messages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 20000) });
      }
    }
    return NextResponse.json({ reply: "I ran out of steps, but here is what I did.", actions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, actions }, { status: 500 });
  }
}
