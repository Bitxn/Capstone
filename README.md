# PromptPilot — Prompt to Website Builder

An AI-powered tool that converts natural language descriptions into fully functional React websites. Built for non-technical users who want to create professional websites without coding.

## Architecture

```
prompt-to-website/
├── backend/
│   ├── server.js          # Express server with dual AI provider support
│   ├── .env               # API keys (not committed to Git)
│   ├── .gitignore
│   └── package.json
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx        # Home page with prompt input
        ├── Editor.jsx     # Live preview + code editor + AI refinement
        ├── Published.jsx  # Published site view
        └── styles.css
```

## AI Providers

| Provider | Model | Role | Free Quota |
|----------|-------|------|------------|
| **Google Gemini** | `gemini-3.5-flash-lite` | Primary | ~1,500 req/day |
| **Groq** | `openai/gpt-oss-120b` | Fallback | ~1,000 req/day |

The server automatically falls back to the next provider if one is rate-limited or unavailable.

## Setup

### Step 1 — Get Free API Keys

- **Gemini**: https://aistudio.google.com/app/apikey (recommended)
- **Groq**: https://console.groq.com/keys (optional fallback)

At least one key is required. Both are free, no credit card needed.

### Step 2 — Configure API Keys

Edit `backend/.env` and paste your keys:

```
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
```

### Step 3 — Start the Backend (port 3001)

```bash
cd backend
npm install
node server.js
```

### Step 4 — Start the Frontend (port 8057)

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

### Step 5 — Open in Browser

Visit: http://localhost:8057

## Features

- **Natural language to React**: Describe a website in plain English, get a working React component
- **Live preview**: See the generated website rendered in real-time
- **AI refinement**: Edit the website with follow-up instructions
- **Responsive preview**: Test desktop, tablet, and mobile layouts
- **Code editor**: View and manually edit the generated React source
- **Version history**: Restore previous versions of your website
- **Publish**: Save to local server with a shareable URL
- **Export**: Download the React component as a `.jsx` file
- **Smart caching**: Repeated prompts are served from cache (0 tokens used)
- **Dual AI provider**: Automatic fallback ensures reliability

## How It Works

1. User types a website description
2. Backend sends the prompt to Gemini (primary) or Groq (fallback)
3. AI generates a complete React component with inline styles
4. Backend compiles the React code with esbuild into a browser bundle
5. Frontend displays the live preview in an iframe
6. User can refine with follow-up instructions or edit code directly
