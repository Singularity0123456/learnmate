// LearnMate AI — Backend Server
// Node/Express server that calls Google Gemini to generate real, structured lesson content.
// The frontend (learnmate-canvas.html) never sees the API key — it only talks to this server.

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (!GEMINI_API_KEY) {
  console.warn('\n⚠️  GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n');
}

// ---------- Shared JSON schema every lesson must follow ----------
// This is passed to Gemini as responseSchema so we ALWAYS get valid, parseable JSON back —
// no markdown fences, no missing fields, no guessing on the frontend.
const lessonSchema = {
  type: 'object',
  properties: {
    icon: { type: 'string', description: 'One single emoji that represents this topic' },
    steps: {
      type: 'array',
      minItems: 4,
      maxItems: 6,
      items: { type: 'string' },
      description: 'Numbered explanation steps building from definition to full understanding, in plain student-friendly language, HTML <b> tags allowed for emphasis'
    },
    visualCaption: { type: 'string', description: 'One sentence describing what a diagram/visual for this topic would show' },
    visualNotes: { type: 'string', description: 'A short HTML paragraph (wrapped in <p>) with an additional insight best understood visually' },
    story: { type: 'string', description: 'A short HTML paragraph (wrapped in <p>) explaining the topic through a relatable real-world analogy or story' },
    practice: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          a: { type: 'string' }
        },
        required: ['q', 'a']
      }
    },
    blanks: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          before: { type: 'string', description: 'Text before the blank' },
          answer: { type: 'string', description: 'The single missing word or short phrase' },
          after: { type: 'string', description: 'Text after the blank, including trailing period' }
        },
        required: ['before', 'answer', 'after']
      }
    },
    quiz: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          opts: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 4 },
          correct: { type: 'integer', description: 'Zero-based index of the correct option in opts' }
        },
        required: ['q', 'opts', 'correct']
      }
    }
  },
  required: ['icon', 'steps', 'visualCaption', 'visualNotes', 'story', 'practice', 'blanks', 'quiz']
};

async function callGemini(promptText, schema) {
  const body = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.8,
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {})
    }
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini returned an empty response');
  return JSON.parse(text);
}

// ---------- Shared JSON schema every adaptive quiz question must follow ----------
const questionSchema = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    correctIndex: { type: 'integer', description: 'Zero-based index of the correct option in options' },
    explanation: { type: 'string', description: 'One or two sentence explanation of why the correct answer is right' },
    difficulty: { type: 'string', enum: ['Foundational', 'Building Up', 'Advanced'] }
  },
  required: ['question', 'options', 'correctIndex', 'explanation', 'difficulty']
};

// ---------- POST /api/generate-lesson ----------
app.post('/api/generate-lesson', async (req, res) => {
  try {
    const { subject, topic, learningStyle, confidence, classLevel, board, language } = req.body;
    if (!subject || !topic) {
      return res.status(400).json({ error: 'subject and topic are required' });
    }

    const difficulty = (confidence ?? 0) >= 70 ? 'advanced' : (confidence ?? 0) >= 40 ? 'intermediate' : 'foundational';

    const prompt = `You are an expert ${subject} teacher creating a personalized micro-lesson for a Class ${classLevel || '10'} student following the ${board || 'CBSE'} curriculum in India.

Topic: "${topic}"
Subject: ${subject}
Student's learning style: ${learningStyle || 'balanced'}
Student's current confidence in ${subject}: ${confidence ?? 0}%  → target difficulty: ${difficulty}
Preferred language: ${language || 'English'}

Generate a complete lesson package as JSON matching the given schema:
- "steps": a clear step-by-step explanation (4-6 steps) that builds understanding from the ground up, appropriate for the ${difficulty} level. Use <b> tags to bold key terms.
- "visualCaption" + "visualNotes": describe what a diagram for this topic would show, and one extra insight that's easier to grasp visually.
- "story": explain the concept through a short, relatable real-world analogy a teenager would connect with.
- "practice": exactly 3 short-answer practice problems with model answers, matched to the ${difficulty} level.
- "blanks": 2-3 fill-in-the-blank sentences testing key vocabulary from the topic (single word or short phrase answers).
- "quiz": exactly 3 multiple-choice questions (3-4 options each) with the correct option index, testing understanding of the topic.

Keep language simple, encouraging, and exam-relevant for Indian school curricula. Do not include any text outside the JSON.`;

    const lesson = await callGemini(prompt, lessonSchema);
    lesson.subject = subject;
    lesson.topic = topic;
    res.json(lesson);
  } catch (err) {
    console.error('generate-lesson error:', err.message);
    res.status(500).json({ error: 'Failed to generate lesson', detail: err.message });
  }
});

// ---------- POST /api/ask-question ----------
app.post('/api/ask-question', async (req, res) => {
  try {
    const { topic, subject, question, learningStyle } = req.body;
    if (!topic || !question) {
      return res.status(400).json({ error: 'topic and question are required' });
    }

    const prompt = `You are a friendly, encouraging ${subject || ''} tutor helping a student who is currently studying "${topic}". Their learning style is ${learningStyle || 'balanced'}.

The student asks: "${question}"

Answer in 2-4 sentences, in plain, simple, encouraging language suitable for a school student. Stay focused on the topic "${topic}". Return ONLY the answer text, no JSON, no markdown formatting, no preamble.`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 }
    };

    const r = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Gemini API error ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    res.json({ answer: answer || "I couldn't come up with an answer for that — try rephrasing your question." });
  } catch (err) {
    console.error('ask-question error:', err.message);
    res.status(500).json({ error: 'Failed to get answer', detail: err.message });
  }
});

// ---------- POST /api/generate-question ----------
// Generates ONE fresh adaptive-quiz question at a time. The frontend decides the next
// difficulty level based on whether the previous answer was right or wrong, and sends
// the list of questions already asked so Gemini avoids repeating itself.
app.post('/api/generate-question', async (req, res) => {
  try {
    const { subject, topic, difficulty, classLevel, board, language, askedQuestions } = req.body;
    if (!subject || !difficulty) {
      return res.status(400).json({ error: 'subject and difficulty are required' });
    }

    const askedList = Array.isArray(askedQuestions) && askedQuestions.length
      ? `\n\nQuestions already asked in this session (do NOT repeat these or close variants of them):\n${askedQuestions.map(q => `- ${q}`).join('\n')}`
      : '';

    const topicLine = topic && topic.trim()
      ? `Focus specifically on the topic "${topic}" within ${subject}.`
      : `Draw from across the general ${subject} curriculum for this class (any topic a student at this level would have covered).`;

    const prompt = `You are an adaptive quiz engine inside LearnMate AI, generating ONE multiple-choice
question at a time for a Class ${classLevel || '10'} student following the ${board || 'CBSE'} curriculum in India.

Subject: ${subject}
${topicLine}
Required difficulty for this question: ${difficulty}
Preferred language: ${language || 'English'}
${askedList}

Generate exactly ONE fresh multiple-choice question as JSON matching the given schema:
- Exactly 4 options, only one correct.
- "correctIndex" is the zero-based index of the correct option.
- "explanation" briefly justifies the correct answer.
- "difficulty" must echo back "${difficulty}".
- The question must be original and not a repeat of anything in the "already asked" list above.

Do not include any text outside the JSON.`;

    const question = await callGemini(prompt, questionSchema);
    res.json(question);
  } catch (err) {
    console.error('generate-question error:', err.message);
    res.status(500).json({ error: 'Failed to generate quiz question', detail: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, model: GEMINI_MODEL, keyConfigured: !!GEMINI_API_KEY }));

app.listen(PORT, () => {
  console.log(`✅ LearnMate AI backend running on http://localhost:${PORT}`);
});