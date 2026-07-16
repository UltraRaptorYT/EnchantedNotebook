type Answer = {
  question?: string;
  answer?: string;
};

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

export async function GET() {
  return checkGemini();
}

export async function POST(request: Request) {
  let body: { text?: unknown; image?: unknown };
  try {
    body = (await request.json()) as { text?: unknown; image?: unknown };
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, 500) : "";
  const image = typeof body.image === "string" ? body.image : "";

  if (!text && !image) {
    return Response.json({ error: "Write or type a question first." }, { status: 400 });
  }
  if (image.length > 4_000_000) {
    return Response.json({ error: "The handwritten image is too large." }, { status: 413 });
  }

  try {
    const answer = await askGemini(text, image);

    return Response.json({
      question: answer.question || text || "Your handwritten question",
      answer: answer.answer,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The notebook could not answer.";
    return Response.json({ error: message }, { status: 503 });
  }
}

async function checkGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ available: true, installed: false, provider: "gemini", model: GEMINI_MODEL });
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}/models`, {
      headers: { "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("Gemini rejected the API key.");
    const data = (await response.json()) as { models?: Array<{ name?: string }> };
    const installed = data.models?.some((item) => item.name === `models/${GEMINI_MODEL}`);
    return Response.json({ available: true, installed: Boolean(installed), provider: "gemini", model: GEMINI_MODEL });
  } catch {
    return Response.json({ available: false, installed: false, provider: "gemini", model: GEMINI_MODEL });
  }
}

async function askGemini(text: string, image: string): Promise<Answer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Add GEMINI_API_KEY to .env.local, then restart the app.");

  const parsedImage = image ? parseImage(image) : null;
  if (image && !parsedImage) throw new Error("The handwritten image could not be read.");

  const parts: Array<Record<string, unknown>> = image
    ? [
        { inlineData: parsedImage },
        {
          text: [
            "This image contains one handwritten question in dark ink on pale paper.",
            "Read every word from left to right, preserve the intended punctuation, then answer it.",
            "Use the surrounding words to resolve unclear individual letters.",
          ].join(" "),
        },
      ]
    : [{ text: `Answer this notebook question: ${text}` }];

  const response = await fetch(`${GEMINI_API_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemMessage().content }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const result = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { code?: number; message?: string; status?: string };
  };
  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new Error("Gemini rejected the API key or request.");
    }
    if (response.status === 429) throw new Error("Gemini's free quota was reached. Try again later.");
    throw new Error(result.error?.message || "Gemini could not answer.");
  }

  const content = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  return parseModelJson(content);
}

function systemMessage() {
  return {
    role: "system",
    content: [
      "You are a private, helpful notebook that answers questions clearly and kindly.",
      "If an image is provided, carefully transcribe all of the handwritten question before answering.",
      "Keep the answer concise: one to three sentences and no more than 320 characters.",
      "Return valid JSON with exactly two string fields: question and answer.",
    ].join(" "),
  };
}

function parseImage(image: string) {
  const dataUrl = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (dataUrl) {
    return { mimeType: dataUrl[1], data: dataUrl[2].replace(/\s/g, "") };
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(image)) {
    return { mimeType: "image/png", data: image.replace(/\s/g, "") };
  }

  return null;
}

function parseModelJson(content: string): Answer {
  if (!content.trim()) throw new Error("The AI returned an empty answer.");
  try {
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")) as Answer;
    if (!parsed.answer) throw new Error("The AI returned an incomplete answer.");
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return { answer: content.trim() };
    throw error;
  }
}
