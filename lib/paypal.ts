// Minimal PayPal REST client for the Invoicing v2 API (sandbox by default).
// Docs: https://developer.paypal.com/docs/api/invoicing/v2/

const BASE =
  process.env.PAYPAL_ENVIRONMENT === "PRODUCTION"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

let cachedToken: { token: string; expires: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET || process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID / PAYPAL_SECRET are not set");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function pp(path: string, init: RequestInit = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && (body.message || body.error_description)) +
      (body?.details ? " — " + JSON.stringify(body.details) : "");
    throw new Error(`PayPal ${init.method || "GET"} ${path} failed (${res.status}): ${msg || text}`);
  }
  return body;
}

export type DraftItem = { name: string; quantity: number; unit_price: number };
export type InvoiceDraft = {
  client_name: string;
  client_email: string;
  currency: string;
  due_date?: string; // YYYY-MM-DD
  note?: string;
  items: DraftItem[];
};

function splitName(full: string) {
  const parts = (full || "Client").trim().split(/\s+/);
  return { given_name: parts[0], surname: parts.slice(1).join(" ") || undefined };
}

export async function createAndSendInvoice(d: InvoiceDraft) {
  const currency = (d.currency || "USD").toUpperCase();
  const detail: any = { currency_code: currency };
  if (d.note) detail.note = d.note.slice(0, 4000);
  if (d.due_date && /^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) {
    detail.payment_term = { term_type: "DUE_ON_DATE_SPECIFIED", due_date: d.due_date };
  }
  const body = {
    detail,
    primary_recipients: [
      { billing_info: { name: splitName(d.client_name), email_address: d.client_email } },
    ],
    items: d.items.map((it) => ({
      name: String(it.name).slice(0, 200),
      quantity: String(it.quantity || 1),
      unit_amount: { currency_code: currency, value: Number(it.unit_price).toFixed(2) },
      unit_of_measure: "QUANTITY",
    })),
  };

  const created = await pp("/v2/invoicing/invoices", { method: "POST", body: JSON.stringify(body) });
  const id: string =
    created?.id || String(created?.href || "").split("/").pop() || "";
  if (!id) throw new Error("PayPal did not return an invoice id");

  const sent = await pp(`/v2/invoicing/invoices/${id}/send`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: true }),
  });
  let payerUrl: string | undefined =
    sent?.href && String(sent.href).includes("invoice") ? sent.href : undefined;
  if (!payerUrl) {
    const inv = await pp(`/v2/invoicing/invoices/${id}`);
    payerUrl = inv?.detail?.metadata?.recipient_view_url;
  }
  return { id, payerUrl };
}

export type InvoiceRow = {
  id: string;
  number: string;
  client: string;
  email: string;
  status: string;
  amount: number;
  due: number;
  currency: string;
  dueDate: string | null;
  daysOverdue: number;
  createdAt: string | null;
  payerUrl: string | null;
};

const UNPAID = new Set(["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"]);

export function isUnpaid(status: string) {
  return UNPAID.has(status);
}

function toRow(inv: any): InvoiceRow {
  const r = inv?.primary_recipients?.[0]?.billing_info || {};
  const name = [r?.name?.given_name, r?.name?.surname].filter(Boolean).join(" ") || r?.business_name || "";
  const dueDate = inv?.detail?.payment_term?.due_date || null;
  const amount = Number(inv?.amount?.value || 0);
  const dueAmt = inv?.due_amount ? Number(inv.due_amount.value) : isUnpaid(inv?.status) ? amount : 0;
  let daysOverdue = 0;
  if (dueDate && isUnpaid(inv?.status)) {
    const diff = Math.floor((Date.now() - new Date(dueDate + "T23:59:59Z").getTime()) / 86_400_000);
    daysOverdue = Math.max(0, diff);
  }
  return {
    id: inv.id,
    number: inv?.detail?.invoice_number || inv.id,
    client: name,
    email: r?.email_address || "",
    status: inv.status,
    amount,
    due: dueAmt,
    currency: inv?.amount?.currency_code || inv?.detail?.currency_code || "USD",
    dueDate,
    daysOverdue,
    createdAt: inv?.detail?.metadata?.create_time || inv?.detail?.invoice_date || null,
    payerUrl: inv?.detail?.metadata?.recipient_view_url || null,
  };
}

export async function listInvoices(): Promise<InvoiceRow[]> {
  const data = await pp("/v2/invoicing/invoices?page=1&page_size=100&total_required=true");
  return (data?.items || []).map(toRow);
}

export async function getInvoice(id: string): Promise<InvoiceRow> {
  return toRow(await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}`));
}

export async function sendReminder(id: string, note?: string) {
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/remind`, {
    method: "POST",
    body: JSON.stringify({
      subject: "Friendly reminder: your invoice is awaiting payment",
      note: (note || "Just a friendly reminder that this invoice is still open. Thank you!").slice(0, 4000),
      send_to_invoicer: false,
      send_to_recipient: true,
    }),
  });
  return { ok: true };
}

export async function cancelInvoice(id: string) {
  await pp(`/v2/invoicing/invoices/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: true, note: "This invoice has been cancelled." }),
  });
  return { ok: true };
}
