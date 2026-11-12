# 💸 Dunning Agent — AI collections for freelancers, powered by PayPal

> Paste a messy message → get a real PayPal invoice. Then let an AI agent chase the money for you.

**Live demo:** `<YOUR-RENDER-URL>` · **Video:** `<YOUR-YOUTUBE-URL>`

Freelancers and micro-businesses lose hours every month writing invoices and awkwardly chasing late payments — and many simply never get paid. **Dunning Agent** is an AI accounts-receivable assistant that:

1. **Turns anything into an invoice.** Paste a WhatsApp message, an email, a note — or upload a photo of a job sheet. The AI extracts the client, line items, currency and due date (resolving things like "by Friday").
2. **Sends it through PayPal.** After you confirm, it creates and sends a real **PayPal invoice** and shows a pay link + QR code your client can scan.
3. **Tracks every invoice live.** An **AG Grid** receivables dashboard pulls status straight from PayPal (Sent, Paid, Overdue) with sorting, filtering and one-click reminders.
4. **Chases payments for you.** Type *"Remind everyone who hasn't paid, politely"* — the agent reads your PayPal invoices, decides who to chase, writes a personalised note for each, and **actually sends PayPal reminders**. It never touches paid or cancelled invoices.

## 🧑‍⚖️ For judges — test it in 2 minutes

1. Open the live demo: `<YOUR-RENDER-URL>` (free hosting: the first load may take ~30–50 s to wake up).
2. Click **Example 1** → **Draft invoice with AI** → check the draft → **Confirm & send via PayPal**.
3. Click **Open payment page** and pay with this **PayPal sandbox buyer** account (fake money):
   - Email: `<SANDBOX-PERSONAL-EMAIL>`
   - Password: `<SANDBOX-PERSONAL-PASSWORD>`
4. Watch the invoice turn **PAID** in the grid (auto-refresh, 15 s).
5. Create another invoice, leave it unpaid, then click the agent chip **"Remind every client with an unpaid invoice, politely"** and watch the action log.

## 🔌 How PayPal is used

All money movement uses the **PayPal Invoicing v2 REST API** (sandbox), via OAuth 2.0 client credentials (`lib/paypal.ts`):

| Feature | PayPal endpoint |
|---|---|
| Create invoice from AI draft | `POST /v2/invoicing/invoices` |
| Send to client (email + pay link) | `POST /v2/invoicing/invoices/{id}/send` |
| Live receivables dashboard | `GET /v2/invoicing/invoices` |
| Invoice details / pay link | `GET /v2/invoicing/invoices/{id}` |
| AI & one-click payment reminders | `POST /v2/invoicing/invoices/{id}/remind` |
| Cancel (agent, on explicit request) | `POST /v2/invoicing/invoices/{id}/cancel` |

Clients pay through PayPal's hosted invoice page (PayPal balance, card, etc.).

## 🤖 How AI is used

- **Model:** MiniMax M3.1 Flash served by **NVIDIA NIM** (build.nvidia.com), called through the OpenAI-compatible Chat Completions API (`lib/llm.ts`). The client is provider-agnostic: it also works with Gemini, OpenAI or OpenRouter, with automatic retries and fallback models.
- **Multimodal extraction** (`/api/extract`): text or a photo → structured invoice JSON, with relative-date resolution, a thank-you note, and a list of fields the AI had to guess (shown to the user for review — human-in-the-loop before money moves).
- **Agentic tool calling** (`/api/agent`): the agent has PayPal tools — `list_invoices`, `get_invoice`, `send_reminder`, `create_invoice`, `cancel_invoice` — and runs a multi-step loop (up to 8 steps). It grounds itself in real PayPal data, selects targets (e.g. "more than 3 days overdue"), writes tone-appropriate reminders, executes them, and reports back. Guardrails stop it reminding paid/cancelled invoices, and it only cancels on explicit request.

## 🧰 Built with

PayPal Invoicing API v2 (sandbox) · NVIDIA NIM (MiniMax M3.1 Flash) · **AG Grid** (Community, React) · Next.js 16 + React 19 + TypeScript · **Render** (hosting) · `qrcode`

## 🏃 Run it locally

Requirements: Node.js 20+ and a free PayPal Developer account.

```bash
git clone <THIS-REPO-URL>
cd dunning-agent
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
# fill in PAYPAL_CLIENT_ID, PAYPAL_SECRET, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL (see below)
npm run dev
```

Open http://localhost:3000.

**Getting keys**
- PayPal: [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard/applications/sandbox) → *Apps & Credentials* (Sandbox) → Default Application → Client ID + Secret. Sandbox buyer/merchant logins are under *Testing Tools → Sandbox Accounts*.
- AI (free): [build.nvidia.com](https://build.nvidia.com) → open a model → *Get API Key*. Then set:
  ```
  LLM_API_KEY=nvapi-...
  LLM_BASE_URL=https://integrate.api.nvidia.com/v1
  LLM_MODEL=<model id from the model page>
  ```
  (Alternatively set `GEMINI_API_KEY` or `OPENAI_API_KEY` alone.)
- **Note for India-based PayPal accounts:** PayPal blocks invoices between two Indian accounts, so invoice a sandbox buyer created with country **United States**.

## ☁️ Deploy on Render

New → **Web Service** → connect this repo → Build `npm install && npm run build` → Start `npm start` → add the environment variables from `.env.example`. (`render.yaml` is included for Blueprint deploys.)

## 🗺️ What's next

Scheduled autonomous follow-ups (daily dunning runs), WhatsApp/Gmail ingestion, multi-currency insights, partial-payment plans with PayPal Pay Later, and cash-flow forecasting from invoice history.

## 📄 License

MIT — see [LICENSE](LICENSE).
