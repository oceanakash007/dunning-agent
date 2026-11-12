"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";
import QRCode from "qrcode";

ModuleRegistry.registerModules([AllCommunityModule]);

type Item = { name: string; quantity: number; unit_price: number };
type Draft = {
  client_name: string;
  client_email: string;
  currency: string;
  due_date: string;
  note?: string;
  items: Item[];
  summary?: string;
  missing?: string[];
};
type Row = {
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
type Action = { tool: string; args: any; ok: boolean; detail: string };

const EXAMPLES = [
  "Hey! Finished the logo + brand kit for Priya Sharma (Bloom Bakery). 3 revisions done. That's $450, plus $80 for the business card design. Needs to be paid by Friday.",
  "Website maintenance for Oak & Iron Gym – 6 hours at $40/hr, and hosting renewal $120. Due in 2 weeks. Contact: Marcus Lee",
  "Wedding photo edit for Ana & Rahul: 200 photos at $1.50 each, rush delivery fee $60",
];

const COMMANDS = [
  "Remind every client with an unpaid invoice, politely",
  "Who owes me the most, and how much is outstanding in total?",
  "Send a firm reminder to anyone more than 3 days overdue",
  "Summarize my receivables this month",
];

const money = (n: number, c = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: c }).format(n || 0);
  } catch {
    return `${c} ${(n || 0).toFixed(2)}`;
  }
};

const gridTheme = themeQuartz.withParams({
  accentColor: "#1f6feb",
  headerBackgroundColor: "#f8faff",
  borderColor: "#e5e7ef",
  rowHoverColor: "#f5f8ff",
  fontSize: 13,
  wrapperBorderRadius: 12,
});

export default function Home() {
  // ---------- Invoice data ----------
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsError, setRowsError] = useState("");

  const loadRows = useCallback(async () => {
    try {
      const r = await fetch("/api/invoices", { cache: "no-store" });
      const j = await r.json();
      if (j.error) setRowsError(j.error);
      else setRowsError("");
      setRows(j.invoices || []);
    } catch (e: any) {
      setRowsError(e.message);
    } finally {
      setLoadingRows(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
    const t = setInterval(loadRows, 15000);
    return () => clearInterval(t);
  }, [loadRows]);

  // ---------- Create from anything ----------
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [sent, setSent] = useState<{ id: string; payerUrl?: string; qr?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = (f?: File) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result));
    reader.readAsDataURL(f);
  };

  const extract = async () => {
    setExtracting(true);
    setCreateError("");
    setDraft(null);
    setSent(null);
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, image }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setDraft(j.draft);
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const total = useMemo(
    () => (draft?.items || []).reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0),
    [draft]
  );

  const updateItem = (idx: number, patch: Partial<Item>) =>
    setDraft((d) => (d ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) } : d));

  const sendInvoice = async () => {
    if (!draft) return;
    setSending(true);
    setCreateError("");
    try {
      const r = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      let qr: string | undefined;
      if (j.payerUrl) qr = await QRCode.toDataURL(j.payerUrl, { margin: 1, width: 220 });
      setSent({ id: j.id, payerUrl: j.payerUrl, qr });
      setDraft(null);
      setText("");
      setImage(null);
      loadRows();
    } catch (e: any) {
      setCreateError(e.message);
    } finally {
      setSending(false);
    }
  };

  // ---------- Agent ----------
  const [command, setCommand] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentReply, setAgentReply] = useState("");
  const [agentActions, setAgentActions] = useState<Action[]>([]);
  const [agentError, setAgentError] = useState("");

  const runAgent = async (msg?: string) => {
    const message = msg ?? command;
    if (!message.trim()) return;
    setCommand(message);
    setAgentBusy(true);
    setAgentError("");
    setAgentReply("");
    setAgentActions([]);
    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const j = await r.json();
      setAgentActions(j.actions || []);
      if (j.error) throw new Error(j.error);
      setAgentReply(j.reply);
      loadRows();
    } catch (e: any) {
      setAgentError(e.message);
    } finally {
      setAgentBusy(false);
    }
  };

  // ---------- KPIs ----------
  const kpi = useMemo(() => {
    const unpaid = rows.filter((r) => ["SENT", "UNPAID", "PARTIALLY_PAID", "PAYMENT_PENDING"].includes(r.status));
    const paid = rows.filter((r) => ["PAID", "MARKED_AS_PAID"].includes(r.status));
    const cur = rows[0]?.currency || "USD";
    return {
      outstanding: unpaid.reduce((s, r) => s + r.due, 0),
      unpaidCount: unpaid.length,
      collected: paid.reduce((s, r) => s + r.amount, 0),
      paidCount: paid.length,
      overdue: unpaid.filter((r) => r.daysOverdue > 0).length,
      total: rows.length,
      cur,
    };
  }, [rows]);

  // ---------- Grid ----------
  const remindOne = async (row: Row) => {
    await fetch("/api/invoices/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id }),
    });
    alertOnce(`Reminder sent to ${row.client || row.email}`);
  };
  const [toast, setToast] = useState("");
  const alertOnce = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 3000);
  };

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { field: "number", headerName: "Invoice #", width: 120 },
      { field: "client", headerName: "Client", flex: 1, minWidth: 140 },
      {
        field: "status",
        headerName: "Status",
        width: 140,
        cellRenderer: (p: any) => {
          const r: Row = p.data;
          const s = r.daysOverdue > 0 ? "OVERDUE" : r.status;
          return <span className={`pill ${s}`}>{s.replace(/_/g, " ")}</span>;
        },
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 120,
        type: "rightAligned",
        valueFormatter: (p) => money(p.value, p.data?.currency),
      },
      {
        field: "due",
        headerName: "Due",
        width: 120,
        type: "rightAligned",
        valueFormatter: (p) => money(p.value, p.data?.currency),
      },
      { field: "dueDate", headerName: "Due date", width: 120 },
      {
        field: "daysOverdue",
        headerName: "Days late",
        width: 110,
        type: "rightAligned",
        cellStyle: (p) => (p.value > 0 ? { color: "#b91c1c", fontWeight: 700 } : null),
      },
      {
        headerName: "",
        width: 170,
        sortable: false,
        filter: false,
        cellRenderer: (p: any) => {
          const r: Row = p.data;
          const unpaid = ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(r.status);
          return (
            <div style={{ display: "flex", gap: 6, alignItems: "center", height: "100%" }}>
              {unpaid && (
                <button className="btn small secondary" onClick={() => remindOne(r)}>
                  Remind
                </button>
              )}
              {r.payerUrl && (
                <a className="btn small ghost" href={r.payerUrl} target="_blank" rel="noreferrer">
                  Pay link ↗
                </a>
              )}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <div className="logo-mark">💸</div>
            <div>
              <h1>Dunning Agent</h1>
              <p>Your AI collections assistant — it invoices and chases payments for you on PayPal.</p>
            </div>
          </div>
          <div className="badges">
            <span className="badge">PayPal Invoicing API · Sandbox</span>
            <span className="badge">AI agent with tool calling</span>
            <span className="badge">AG Grid</span>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="kpis">
          <div className="kpi">
            <div className="label">Outstanding</div>
            <div className="value">{money(kpi.outstanding, kpi.cur)}</div>
            <div className="sub">{kpi.unpaidCount} unpaid invoices</div>
          </div>
          <div className="kpi">
            <div className="label">Collected</div>
            <div className="value" style={{ color: "#059669" }}>{money(kpi.collected, kpi.cur)}</div>
            <div className="sub">{kpi.paidCount} paid</div>
          </div>
          <div className="kpi">
            <div className="label">Overdue</div>
            <div className="value" style={{ color: kpi.overdue ? "#dc2626" : undefined }}>{kpi.overdue}</div>
            <div className="sub">need chasing</div>
          </div>
          <div className="kpi">
            <div className="label">Invoices</div>
            <div className="value">{kpi.total}</div>
            <div className="sub">live from PayPal</div>
          </div>
        </section>

        <section className="row">
          {/* Create */}
          <div className="card">
            <h2>✍️ Invoice from anything</h2>
            <p className="hint">
              Paste a WhatsApp message, email or note — or upload a photo of a job sheet. AI drafts the invoice, you
              confirm, PayPal sends it.
            </p>
            <textarea
              placeholder="e.g. Finished the logo for Priya, $450, due Friday…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="chips">
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="chip" onClick={() => setText(ex)}>
                  Example {i + 1}
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="btn" onClick={extract} disabled={extracting || (!text && !image)}>
                {extracting ? <span className="spinner" /> : "✨"} {extracting ? "Reading…" : "Draft invoice with AI"}
              </button>
              <button className="btn secondary" onClick={() => fileRef.current?.click()}>
                📷 {image ? "Image attached" : "Upload photo"}
              </button>
              {image && (
                <button className="btn ghost" onClick={() => setImage(null)}>
                  Remove image
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>

            {draft && (
              <div className="preview">
                {draft.summary && <div className="summary">🤖 {draft.summary}</div>}
                <div className="grid2">
                  <div className="field">
                    <label>Client name</label>
                    <input value={draft.client_name} onChange={(e) => setDraft({ ...draft, client_name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Client email (PayPal)</label>
                    <input value={draft.client_email} onChange={(e) => setDraft({ ...draft, client_email: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Currency</label>
                    <input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="field">
                    <label>Due date</label>
                    <input type="date" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
                  </div>
                </div>
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Line items</label>
                </div>
                {draft.items.map((it, i) => (
                  <div className="grid3" key={i}>
                    <input value={it.name} onChange={(e) => updateItem(i, { name: e.target.value })} />
                    <input type="number" value={it.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                    <input type="number" value={it.unit_price} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })} />
                    <button
                      className="btn ghost"
                      onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className="btn ghost"
                  style={{ marginTop: 6 }}
                  onClick={() => setDraft({ ...draft, items: [...draft.items, { name: "", quantity: 1, unit_price: 0 }] })}
                >
                  + Add item
                </button>
                <div className="total">Total: {money(total, draft.currency)}</div>
                {!!draft.missing?.length && (
                  <div className="warn">AI guessed: {draft.missing.join(", ")} — please check before sending.</div>
                )}
                <div className="actions">
                  <button className="btn paypal" onClick={sendInvoice} disabled={sending || !draft.client_email}>
                    {sending ? <span className="spinner dark" /> : "🅿️"} {sending ? "Sending…" : "Confirm & send via PayPal"}
                  </button>
                  <button className="btn ghost" onClick={() => setDraft(null)}>
                    Discard
                  </button>
                </div>
              </div>
            )}

            {sent && (
              <div className="success">
                {sent.qr && <img src={sent.qr} alt="QR code to pay invoice" />}
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>✅ Invoice sent through PayPal</div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>Your client can scan the QR code or open the link to pay.</div>
                  {sent.payerUrl ? (
                    <a href={sent.payerUrl} target="_blank" rel="noreferrer">
                      Open payment page ↗
                    </a>
                  ) : (
                    <span className="mono">{sent.id}</span>
                  )}
                </div>
              </div>
            )}
            {createError && <div className="error">{createError}</div>}
          </div>

          {/* Agent */}
          <div className="card">
            <h2>🤖 Ask your collections agent</h2>
            <p className="hint">
              Give an instruction in plain English. The agent reads your PayPal invoices and takes action — like sending
              personalised reminders.
            </p>
            <textarea
              style={{ minHeight: 70 }}
              placeholder="e.g. Remind everyone who hasn't paid yet, keep it friendly"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runAgent();
                }
              }}
            />
            <div className="chips">
              {COMMANDS.map((c, i) => (
                <button key={i} className="chip" onClick={() => runAgent(c)} disabled={agentBusy}>
                  {c}
                </button>
              ))}
            </div>
            <div className="actions">
              <button className="btn" onClick={() => runAgent()} disabled={agentBusy || !command.trim()}>
                {agentBusy ? <span className="spinner" /> : "▶"} {agentBusy ? "Working…" : "Run agent"}
              </button>
            </div>
            {!!agentActions.length && (
              <div className="log">
                {agentActions.map((a, i) => (
                  <div className="log-item" key={i}>
                    <span className={`dot ${a.ok ? "" : "bad"}`} />
                    <span className="mono">{a.tool}</span>
                    <span>{a.detail}</span>
                  </div>
                ))}
              </div>
            )}
            {agentReply && <div className="agent-reply">{agentReply}</div>}
            {agentError && <div className="error">{agentError}</div>}
          </div>
        </section>

        <section className="card">
          <div className="table-head">
            <div>
              <h2>📊 Receivables — live from PayPal</h2>
              <p className="hint" style={{ margin: 0 }}>
                Sort, filter and act on every invoice. Auto-refreshes every 15 seconds.
              </p>
            </div>
            <button className="btn secondary" onClick={loadRows}>
              {loadingRows ? <span className="spinner dark" /> : "↻"} Refresh
            </button>
          </div>
          {rowsError && <div className="error">{rowsError}</div>}
          <div style={{ height: 420 }}>
            <AgGridReact<Row>
              theme={gridTheme}
              rowData={rows}
              columnDefs={columnDefs}
              defaultColDef={{ sortable: true, filter: true, resizable: true }}
              getRowId={(p) => p.data.id}
              loading={loadingRows}
              overlayNoRowsTemplate="No invoices yet — create your first one above."
            />
          </div>
        </section>
        <div className="footer">
          Built for the PayPal AI Hackathon · PayPal Invoicing v2 (sandbox) · LLM tool calling · AG Grid
        </div>
      </main>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#0f172a",
            color: "white",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
