# LearnMate AI — Backend

A small Node/Express server that holds your Gemini API key and generates real,
personalized lesson content for the AI Learning Canvas page. The frontend never
sees the key — it only calls this server.

## Setup

```bash
cd learnmate-server
npm install
cp .env.example .env
```

Open `.env` and paste your key:

```
GEMINI_API_KEY=your_actual_key_here
```

Get a free key at **https://aistudio.google.com/apikey**.

## Run

```bash
npm start
```

You should see:

```
✅ LearnMate AI backend running on http://localhost:3001
```

Check it's alive: open http://localhost:3001/api/health in a browser — it should
show `{"ok":true,...}`.

## Using it with the frontend

Keep `learnmate-canvas.html` (and the other three pages) in the same folder as
before and open them normally in the browser (double-click, or a simple static
server like `npx serve`). The Canvas page calls `http://localhost:3001` for
lesson generation and Q&A, so **the backend must be running** whenever you use
that page.

If you deploy the backend somewhere other than `localhost:3001`, update the
`API_BASE` constant near the top of the `<script>` block in
`learnmate-canvas.html`.

## Endpoints

- `POST /api/generate-lesson` — body: `{ subject, topic, learningStyle, confidence, classLevel, board, language }` → returns a full structured lesson (steps, visual notes, story, practice, fill-in-the-blanks, quiz).
- `POST /api/ask-question` — body: `{ topic, subject, question, learningStyle }` → returns `{ answer }`.
- `POST /api/generate-question` — body: `{ subject, topic, difficulty, classLevel, board, language, askedQuestions }` → returns ONE fresh multiple-choice question `{ question, options, correctIndex, explanation, difficulty }`. Used by the Adaptive Quiz page, which calls this once per question and raises/lowers `difficulty` live based on whether the previous answer was right or wrong.
- `GET /api/health` — quick check that the server + key are configured.

## Notes

- Uses `gemini-2.5-flash` by default (fast + cheap). Override with `GEMINI_MODEL` in `.env` if you want a different model.
- Lesson generation uses Gemini's structured output (`responseSchema`), so the JSON shape is enforced server-side — the frontend never has to guess at parsing.
- This is a local-dev setup (no auth, no rate limiting). Before deploying publicly, add request throttling and don't expose `.env`.
