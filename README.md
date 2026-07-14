# Enchanted Diary

A full-screen magical diary canvas for handwriting with a touchscreen, stylus,
or mouse. Questions are answered through the Gemini API.

## Configure Gemini

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey).
Copy `.env.example` to `.env.local`, then set:

```env
GEMINI_API_KEY=AIza_your_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

Remove any old `GROQ_*`, `OLLAMA_*`, or `AI_PROVIDER` entries from `.env.local`.
Restart the development server after changing environment variables.

The Gemini key is used only inside the server-side Route Handler and is never
sent to browser code. `gemini-3.1-flash-lite` accepts image input, allowing it to
read handwriting from the canvas and answer the recognized question. Google
currently lists free input and output tokens for this model on the Gemini API
free tier. Free-tier content may be used by Google to improve its products, so
review Google's current terms before entering sensitive diary content.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

There are no submit, clear, or mode buttons. Pointer Events provide pressure-aware
stylus, touch, and mouse drawing across the whole viewport. When writing pauses
for 3.2 seconds, the ink bounds are padded, enlarged, and sent to Gemini automatically.
Gemini's response is revealed continuously letter by letter with a natural cursive ink-tracing effect.
Writing another stroke before the timer finishes cancels submission and continues
the current question. After an answer appears, the next stroke automatically turns
to a fresh page.

## Checks

```bash
npm run lint
npm run build
```
