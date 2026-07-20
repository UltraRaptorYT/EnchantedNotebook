# Enchanted Notebook

A full-screen magical notebook canvas for handwriting with a touchscreen, stylus,
or mouse. Questions are answered through the Gemini API.

## Configure Gemini

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey).
Copy `.env.example` to `.env.local`, then set:

```env
GEMINI_API_KEY=AIza_your_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
```

The Gemini key is used only inside the server-side Route Handler and is never
sent to browser code. `gemini-3.1-flash-lite` accepts image input, allowing it to
read handwriting from the canvas and answer the recognized question. Google
currently lists free input and output tokens for this model on the Gemini API
free tier. Free-tier content may be used by Google to improve its products, so
review Google's current terms before entering sensitive notebook content.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

There are no submit or mode buttons. Pointer Events provide pressure-aware
stylus, touch, and mouse drawing across the whole viewport. When writing pauses
for 3.2 seconds, the ink bounds are padded, enlarged, and sent to Gemini automatically.
Gemini's response is revealed continuously letter by letter with a natural cursive ink-tracing effect.
Writing another stroke before the timer finishes cancels submission and continues
the current question. After an answer appears, the next stroke automatically turns
to a fresh page.

## History

The History button keeps the latest 12 answered pages, including a compact image
of the handwriting, Gemini's transcription, and its reply in the current browser.
Individual pages or all local history can be deleted in the drawer.

### Optional online owner archive

To privately archive successful pages for the notebook owner, create a Supabase
project and run
[`supabase/migrations/20260720113250_create_notebook_history.sql`](supabase/migrations/20260720113250_create_notebook_history.sql)
in its SQL Editor. Then add these server-only variables locally and to the Vercel
project:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key_here
```

Use the secret key from Supabase's Connect dialog. Never prefix it with
`NEXT_PUBLIC_` or expose it to browser code. Successful drawings are placed in
the private `notebook-drawings` Storage bucket, while questions, replies, model,
anonymous notebook ID, timestamps, and drawing paths appear in the
`notebook_history` table. The table has RLS enabled and grants no access to public
browser roles.

Online archiving runs after the answer response, so a temporary logging problem
does not prevent the visitor from receiving an answer. When online archiving is
configured, the History drawer discloses that answered pages are also stored by
the notebook owner.

## Analytics

The app includes Vercel Web Analytics for anonymous page-view and visitor metrics.
After deploying to Vercel, open the project's **Analytics** tab and enable Web
Analytics. The integration intentionally does not send handwriting, transcriptions,
or AI replies as analytics data.

## Checks

```bash
npm run lint
npm run build
```
