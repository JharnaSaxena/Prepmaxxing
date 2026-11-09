const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

async function askGemini(system, user, { temperature, maxTokens } = {}) {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  let response;
  try {
    response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] },], generationConfig: { temperature, maxOutputTokens: maxTokens } }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (error) { throw Object.assign(new Error("Gemini is temporarily unavailable. Please retry in a moment."), { status: 503, cause: error }); }
  if (response.status === 429) throw Object.assign(new Error("Gemini is rate limited right now. Please try again shortly."), { status: 429 });
  if (!response.ok) throw Object.assign(new Error("Gemini could not complete this request. Check the Gemini deployment key and try again."), { status: 502 });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "I couldn't form a response. Please try again.";
}

export async function askAI(system, user, { temperature = 0.2, maxTokens = 700 } = {}) {
  const preferGemini = process.env.AI_PROVIDER === "gemini" || (!process.env.AI_PROVIDER && Boolean(process.env.GEMINI_API_KEY));
  if (preferGemini && process.env.GEMINI_API_KEY) {
    try { return await askGemini(system, user, { temperature, maxTokens }); }
    catch (error) {
      if (!process.env.GROQ_API_KEY) throw error;
      console.warn("Gemini request failed; falling back to Groq.", error?.status || "network error");
    }
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    if (process.env.GEMINI_API_KEY) return askGemini(system, user, { temperature, maxTokens });
    throw Object.assign(new Error("AI is not configured yet. Add GEMINI_API_KEY or GROQ_API_KEY to the deployment environment."), { status: 503 });
  }
  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", temperature, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (error) {
    throw Object.assign(new Error("The AI service is temporarily unavailable. Please retry in a moment."), { status: 503, cause: error });
  }
  if (response.status === 429) throw Object.assign(new Error("The AI service is rate limited right now. Please try again shortly."), { status: 429 });
  if (!response.ok) throw Object.assign(new Error("The AI service could not complete this request. Please try again."), { status: 502 });
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "I couldn't form a response. Please try again.";
}

export async function extractPdfTextWithGemini(bytes) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "";
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  let response;
  try {
    response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Extract only text that is visibly present in the supplied resume PDF. Preserve section headings and bullet content. Do not infer, correct, summarize, or invent text. If a region is unreadable, mark it [unreadable]." }] },
        contents: [{ role: "user", parts: [
          { text: "Transcribe the readable resume text in page order. Return plain text only." },
          { inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
        ] }],
        generationConfig: { temperature: 0, maxOutputTokens: 5000 },
      }), signal: AbortSignal.timeout(45_000),
    });
  } catch (error) { throw Object.assign(new Error("Resume OCR is temporarily unavailable. You can paste the resume text instead."), { status: 503, cause: error }); }
  if (response.status === 429) throw Object.assign(new Error("Resume OCR is rate limited right now. Please try again shortly."), { status: 429 });
  if (!response.ok) throw Object.assign(new Error("Gemini could not read this PDF. Try a clearer scan or paste the resume text."), { status: 502 });
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || "";
}

export async function extractPdfTextWithOcrSpace(bytes) {
  const key = process.env.OCR_SPACE_API_KEY;
  if (!key) return "";
  const form = new FormData();
  form.set("base64Image", `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`);
  form.set("filetype", "PDF");
  form.set("language", "eng");
  form.set("OCREngine", "2");
  form.set("isOverlayRequired", "false");
  let response;
  try {
    response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST", headers: { apikey: key }, body: form, signal: AbortSignal.timeout(45_000),
    });
  } catch (error) { throw Object.assign(new Error("OCR.space is temporarily unavailable. You can paste the resume text instead."), { status: 503, cause: error }); }
  if (response.status === 429) throw Object.assign(new Error("OCR.space is rate limited right now. Please try again shortly."), { status: 429 });
  if (!response.ok) throw Object.assign(new Error("OCR.space could not read this PDF. Try a clearer scan or paste the resume text."), { status: 502 });
  const data = await response.json();
  if (data.IsErroredOnProcessing) throw Object.assign(new Error("OCR.space could not extract this scan. Try a clearer PDF or paste the resume text."), { status: 422 });
  return (data.ParsedResults || []).map((item) => item.ParsedText || "").join("\n").trim();
}

export const NOVA_PROMPT = `You are Nova, an original, sharp-minded placement interviewer with the energy of a playful garage inventor. Be curious, quick-witted, encouraging, precise, and warm. Speak in natural concise English, one question at a time, with light dry humor used sparingly. Keep this character original; never imitate a real person, actor, or existing fictional character. Never invent candidate facts, code behavior, test results, or repository details. If evidence is missing, say so and ask a grounded question. Never accuse or shame the candidate.`;
