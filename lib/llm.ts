// Provider-agnostic LLM client using the OpenAI-compatible Chat Completions API.
// Works with OpenAI (default) and Google Gemini (via its OpenAI-compatible endpoint).

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: any; tool_calls?: any; tool_call_id?: string; name?: string };

function config() {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = process.env.LLM_API_KEY || openaiKey || geminiKey;
  const useGemini = !process.env.LLM_API_KEY && !openaiKey && !!geminiKey;
  const baseUrl =
    process.env.LLM_BASE_URL ||
    (useGemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://api.openai.com/v1");
  const model = process.env.LLM_MODEL || (useGemini ? "gemini-3.8-flash" : "gpt-4o-mini");
  if (!apiKey) throw new Error("No AI key set. Add OPENAI_API_KEY or GEMINI_API_KEY to your environment.");
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ""), model };
}

export function modelName() {
  try {
    return config().model;
  } catch {
    return "not configured";
  }
}

export async function chat(messages: Msg[], tools?: any[]) {
  const { apiKey, baseUrl, model } = config();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  return data.choices?.[0]?.message as Msg;
}

export function parseJson(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Very small in-memory rate limiter so a public demo can't drain the AI budget.
const hits: number[] = [];
export function rateLimit() {
  const max = Number(process.env.DEMO_MAX_AI_CALLS_PER_HOUR || 120);
  const now = Date.now();
  while (hits.length && hits[0] < now - 3_600_000) hits.shift();
  if (hits.length >= max) throw new Error("Demo AI limit reached for this hour. Please try again later.");
  hits.push(now);
}
