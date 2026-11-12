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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Calls the model, retrying on rate limits (429) / provider hiccups and falling back to
// LLM_FALLBACK_MODELS (comma-separated) — important for shared free tiers like OpenRouter ":free".
export async function chat(messages: Msg[], tools?: any[]) {
  const { apiKey, baseUrl, model } = config();
  const models = [model, ...(process.env.LLM_FALLBACK_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean)];
  let lastErr = "";
  for (const m of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/dunning-agent",
          "X-Title": "Dunning Agent",
        },
        body: JSON.stringify({
          model: m,
          messages,
          temperature: 0.2,
          ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
        }),
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.choices?.[0]?.message;
        if (msg) {
          // Reasoning models (e.g. MiniMax, DeepSeek) may include <think>…</think> blocks — strip them.
          if (typeof msg.content === "string") msg.content = msg.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          delete msg.reasoning_content;
          delete msg.reasoning;
          return msg as Msg;
        }
        lastErr = `Empty response from ${m}: ${JSON.stringify(data).slice(0, 300)}`;
        break;
      }
      const body = (await res.text()).slice(0, 400);
      lastErr = `AI request failed (${res.status}) on ${m}: ${body}`;
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (attempt + 1));
        continue; // retry same model
      }
      break; // 4xx other than 429 (e.g. model not found / no tool support) -> try next model
    }
  }
  throw new Error(lastErr || "AI request failed");
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
