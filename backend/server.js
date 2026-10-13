const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Groq = require("groq-sdk");
const { GoogleGenAI } = require("@google/genai");
const esbuild = require("esbuild");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3001);

// ======================================================
// CONFIGURATION
// ======================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const GROQ_MODEL = "openai/gpt-oss-120b";

const LIMITS = {
  generationTokensSimple: 8192,
  generationTokensFull: 12288,
  editTokens: 10240,
  maxCodeCharacters: 40000,
  maxCodeLines: 600,
  maxUserPromptCharacters: 8000,
  maxEditPromptCharacters: 3000,
  maxRequestBody: "2mb",
  simplePromptThreshold: 120,
};

const ALLOWED_ORIGINS = new Set([
  "http://localhost:8057",
  "http://127.0.0.1:8057",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const OUTPUT_DIR = path.join(__dirname, "generated-sites");
const PROJECTS_DIR = path.join(__dirname, "projects-data");
const NODE_MODULES = path.join(__dirname, "node_modules");

// Project storage (in-memory + disk persistence).
const projects = new Map();
const publishedSites = new Map();

// Simple cache for example prompts (saves API tokens).
const generationCache = new Map();
const CACHE_MAX_SIZE = 20;

// ======================================================
// INITIALIZATION
// ======================================================

const hasGemini =
  GEMINI_API_KEY &&
  GEMINI_API_KEY !== "PASTE_YOUR_GEMINI_API_KEY_HERE";

const hasGroq =
  GROQ_API_KEY &&
  GROQ_API_KEY !== "PASTE_YOUR_GROQ_API_KEY_HERE";

if (!hasGemini && !hasGroq) {
  console.error(
    "ERROR: At least one API key is required.\n" +
      "  Set GEMINI_API_KEY or GROQ_API_KEY in backend/.env\n" +
      "  Get Gemini key: https://aistudio.google.com/app/apikey\n" +
      "  Get Groq key:   https://console.groq.com/keys"
  );
  process.exit(1);
}

let gemini = null;
let groq = null;

if (hasGemini) {
  gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

if (hasGroq) {
  groq = new Groq({ apiKey: GROQ_API_KEY });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        return callback(null, true);
      }

      console.warn("Blocked CORS origin:", origin);
      return callback(null, false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: LIMITS.maxRequestBody }));

app.use((req, res, next) => {
  console.log(
    `${new Date().toISOString()} ${req.method} ${req.url}`
  );
  next();
});

// ======================================================
// HELPERS
// ======================================================

function createId() {
  return crypto.randomBytes(12).toString("hex");
}

function cleanText(value, maxLength = 12000) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function sendError(res, status, message) {
  return res.status(status).json({
    error: message,
    message,
  });
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function saveProject(id, project) {
  projects.set(id, project);
  try {
    const safeId = path.basename(id);
    fs.writeFileSync(
      path.join(PROJECTS_DIR, `${safeId}.json`),
      JSON.stringify(project, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("Failed to persist project to disk:", err.message);
  }
}

function getProject(id) {
  if (projects.has(id)) {
    return projects.get(id);
  }
  // Disk fallback: survive server restarts
  try {
    const safeId = path.basename(id);
    const filePath = path.join(PROJECTS_DIR, `${safeId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      projects.set(id, data);
      return data;
    }
  } catch (err) {
    console.error("Failed to load project from disk:", err.message);
  }
  return null;
}

/**
 * Decide how many output tokens to use based on prompt complexity.
 * Short/simple prompts get fewer tokens to save budget.
 */
function getTokenLimit(prompt) {
  if (prompt.length < LIMITS.simplePromptThreshold) {
    return LIMITS.generationTokensSimple;
  }

  return LIMITS.generationTokensFull;
}

/**
 * Robustly extract React code from model output.
 * Handles: markdown fences, preamble text, trailing explanations,
 * multiple code blocks, and raw code without fences.
 */
function extractCode(text) {
  if (!text || typeof text !== "string") {
    throw new Error(
      "Model returned an empty response. Please try again."
    );
  }

  let cleaned = text.trim();

  // Strategy 1: Extract from code fences (```jsx ... ``` or similar).
  const fencePattern =
    /```(?:jsx|javascript|js|react|tsx|typescript)?\s*\n?([\s\S]*?)```/gi;
  const fenceMatches = [...cleaned.matchAll(fencePattern)];

  if (fenceMatches.length > 0) {
    // Pick the longest code block (most likely the full component).
    let bestBlock = "";

    for (const match of fenceMatches) {
      const block = match[1].trim();

      if (block.length > bestBlock.length) {
        bestBlock = block;
      }
    }

    if (bestBlock && bestBlock.includes("export default")) {
      return bestBlock;
    }

    // If no block has export default, try all blocks combined.
    if (bestBlock.length > 50) {
      return bestBlock;
    }
  }

  // Strategy 2: Strip leading/trailing fences if they wrap the whole thing.
  cleaned = cleaned
    .replace(/^```(?:jsx|javascript|js|react|tsx|typescript)?\s*\n?/i, "")
    .replace(/\n?\s*```\s*$/, "")
    .trim();

  // Strategy 3: Find where code starts (import or export statement).
  const codeStartPatterns = [
    /^import\s+/m,
    /^export\s+default\s+/m,
    /^(?:const|let|var|function)\s+/m,
  ];

  for (const pattern of codeStartPatterns) {
    const match = pattern.exec(cleaned);

    if (match && match.index > 0) {
      // There's preamble text before the code. Strip it.
      cleaned = cleaned.slice(match.index);
      break;
    }
  }

  // Strategy 4: Remove trailing explanation text after the component.
  // Look for the last closing brace/paren that ends the component.
  const lastExportDefault = cleaned.lastIndexOf("export default");

  if (lastExportDefault === -1 && cleaned.length > 100) {
    // No export default found — try wrapping it.
    // Check if it looks like a function body.
    if (cleaned.includes("return (") || cleaned.includes("return(")) {
      cleaned = `export default function Website() {\n${cleaned}\n}`;
    }
  }

  return cleaned;
}

function validateCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("Generated React code is empty.");
  }

  if (code.length > LIMITS.maxCodeCharacters) {
    throw new Error(
      `Generated code exceeds ${LIMITS.maxCodeCharacters} characters. Try a simpler request.`
    );
  }

  const lineCount = code.split(/\r?\n/).length;

  if (lineCount > LIMITS.maxCodeLines) {
    throw new Error(
      `Generated code contains ${lineCount} lines. The limit is ${LIMITS.maxCodeLines}.`
    );
  }

  if (!/\bexport\s+default\b/.test(code)) {
    throw new Error(
      "Generated code has no default export. Please try again."
    );
  }

  return code;
}

// ======================================================
// SYSTEM PROMPT (shared by both providers)
// ======================================================

const SYSTEM_PROMPT = `
You are an expert React website generator.

CRITICAL RULES — You MUST follow these exactly:

1. Return ONLY complete React JSX source code. No markdown, no code fences, no explanations.
2. Export exactly one default React component.
3. Use this exact structure:

export default function Website() {
  return (
    <main>
      {/* Your content here */}
    </main>
  );
}

4. Use inline styles or a <style> tag inside the component. No external CSS imports.
5. Do NOT import React or ReactDOM. Do NOT import react/jsx-runtime.
6. Do NOT import any external npm packages. No external dependencies.
7. Do NOT use require(), process.env, or Node.js APIs.
8. Use inline SVG for icons.
9. Use useState, useEffect, useRef from React (available globally, no import needed).
10. Include realistic content, not Lorem ipsum.
11. Make the design responsive (desktop, tablet, mobile).
12. Use CSS transitions for animations.
13. Do NOT return a complete HTML document — only the React component.
14. Ensure all JSX tags are correctly closed and all braces are balanced.
15. Keep code concise: 100–300 lines. Use arrays and map() for repeated content.
16. Return the COMPLETE component. Never stop mid-function.

RESPOND WITH CODE ONLY. NO TEXT BEFORE OR AFTER THE CODE.
`.trim();

// ======================================================
// GENERATION PROMPT
// ======================================================

function buildGenerationPrompt(userPrompt) {
  const safePrompt = cleanText(
    userPrompt,
    LIMITS.maxUserPromptCharacters
  );

  return `
Create a polished, responsive, functional React website for:

${safePrompt}

Remember: Return ONLY the complete React JSX component with export default. No markdown fences. No explanations. Code only.
`.trim();
}

// ======================================================
// EDIT PROMPT
// ======================================================

function buildEditPrompt(currentCode, editPrompt) {
  const safeCode = String(currentCode || "").slice(
    0,
    LIMITS.maxCodeCharacters
  );

  const safeEditPrompt = cleanText(
    editPrompt,
    LIMITS.maxEditPromptCharacters
  );

  return `
Modify this React website component based on the user's request.

USER CHANGE REQUEST:
${safeEditPrompt}

CURRENT CODE:
${safeCode}

RULES:
- Return the COMPLETE updated component (not a diff).
- Keep all existing functionality unless the user asked to change it.
- Return code only. No markdown fences. No explanations.
- Preserve the export default.
`.trim();
}

// ======================================================
// GEMINI API (Primary Provider)
// ======================================================

async function generateWithGemini(prompt, maxTokens) {
  if (!gemini) {
    throw new Error("GEMINI_NOT_CONFIGURED");
  }

  let response;

  try {
    response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.2,
        maxOutputTokens: maxTokens,
      },
    });
  } catch (error) {
    console.error("Gemini API error:", error.message);

    const message = error.message || "";

    if (/api.?key|unauthorized|authentication|invalid/i.test(message)) {
      throw new Error(
        "Gemini authentication failed. Check your GEMINI_API_KEY in .env"
      );
    }

    if (/rate.?limit|quota|resource.?exhausted|429/i.test(message)) {
      throw new Error("RATE_LIMITED");
    }

    throw new Error(`Gemini request failed: ${message}`);
  }

  const text = response?.text;

  if (!text || !text.trim()) {
    throw new Error(
      "Gemini returned no code. Try a simpler website brief."
    );
  }

  return extractCode(text);
}

// ======================================================
// GROQ API (Fallback Provider)
// ======================================================

async function generateWithGroq(prompt, maxTokens) {
  if (!groq) {
    throw new Error("GROQ_NOT_CONFIGURED");
  }

  let completion;

  try {
    completion = await groq.chat.completions.create({
      model: GROQ_MODEL,

      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: prompt,
        },
      ],

      temperature: 0.2,
      max_completion_tokens: maxTokens,
      stream: false,
    });
  } catch (error) {
    console.error("Groq API error:", error.message);

    const message = error.message || "";

    if (
      error.status === 401 ||
      /api.?key|unauthorized|authentication/i.test(message)
    ) {
      throw new Error(
        "Groq authentication failed. Check your GROQ_API_KEY in .env"
      );
    }

    if (
      error.status === 429 ||
      /rate.?limit|quota|resource exhausted/i.test(message)
    ) {
      throw new Error("RATE_LIMITED");
    }

    if (
      error.status === 404 ||
      /model.*not found|unknown model/i.test(message)
    ) {
      throw new Error(
        `Groq model "${GROQ_MODEL}" is unavailable. Check the model name.`
      );
    }

    throw new Error(`Groq request failed: ${message}`);
  }

  const choice = completion?.choices?.[0];
  const text = choice?.message?.content;

  if (!text || !text.trim()) {
    throw new Error(
      "Groq returned no code. Try a simpler website brief."
    );
  }

  if (choice.finish_reason === "length") {
    console.warn("Groq output was truncated (finish_reason=length).");
    // Don't throw — try to salvage what we got.
  }

  return extractCode(text);
}

// ======================================================
// DUAL-PROVIDER GENERATION (with retry & fallback)
// ======================================================

async function generateCode(prompt, maxTokens) {
  const providers = [];

  // Order: Gemini first (higher quota), Groq second (better code).
  if (gemini) providers.push({ name: "Gemini", fn: generateWithGemini });
  if (groq) providers.push({ name: "Groq", fn: generateWithGroq });

  let lastError = null;

  for (const provider of providers) {
    // Try each provider up to 2 times.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(
          `[${provider.name}] Attempt ${attempt} (${maxTokens} tokens)...`
        );

        const rawCode = await provider.fn(prompt, maxTokens);
        const code = validateCode(rawCode);

        console.log(
          `[${provider.name}] Success — ${code.split("\n").length} lines, ${code.length} chars`
        );

        return { code, provider: provider.name };
      } catch (error) {
        lastError = error;

        console.warn(
          `[${provider.name}] Attempt ${attempt} failed: ${error.message}`
        );

        // If rate limited, skip to next provider immediately.
        if (error.message === "RATE_LIMITED") {
          console.log(`[${provider.name}] Rate limited — trying next provider.`);
          break;
        }

        // If not configured, skip to next provider.
        if (error.message.includes("NOT_CONFIGURED")) {
          break;
        }

        // On first attempt failure, wait briefly then retry.
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  }

  // All providers failed.
  const message = lastError?.message || "Code generation failed.";

  if (message === "RATE_LIMITED") {
    throw new Error(
      "All AI providers are rate-limited right now. Please wait a minute and try again."
    );
  }

  throw new Error(message);
}

// ======================================================
// CACHE HELPERS
// ======================================================

function getCacheKey(prompt) {
  return prompt.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCachedCode(prompt) {
  const key = getCacheKey(prompt);
  return generationCache.get(key) || null;
}

function setCachedCode(prompt, code) {
  const key = getCacheKey(prompt);

  // Evict oldest if at capacity.
  if (generationCache.size >= CACHE_MAX_SIZE) {
    const firstKey = generationCache.keys().next().value;
    generationCache.delete(firstKey);
  }

  generationCache.set(key, code);
}

// ======================================================
// REACT BUNDLER
// ======================================================

async function bundleReactCode(code) {
  validateCode(code);

  const buildDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneport-build-")
  );

  const shimFile = path.join(buildDir, "react-shim.js");
  const componentFile = path.join(buildDir, "Website.jsx");
  const entryFile = path.join(buildDir, "entry.jsx");

  try {
    // 1. React shim for automatic injection of React & common hooks into all modules
    fs.writeFileSync(
      shimFile,
      `import * as React from "react";
export { React };
export const {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useReducer,
  useContext,
  createContext,
} = React;
`,
      "utf8"
    );

    // 2. Ensure Website.jsx imports React if not explicitly present
    let normalizedCode = code;
    if (!/from\s+['"]react['"]/i.test(normalizedCode)) {
      normalizedCode = `import React from "react";\n` + normalizedCode;
    }

    fs.writeFileSync(componentFile, normalizedCode, "utf8");

    // 3. Entry code with globals and React ErrorBoundary
    const entryCode = `
import React, * as ReactModule from "react";
import * as ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";

// Expose React and ReactDOM globally
window.React = React;
globalThis.React = React;
window.ReactDOM = ReactDOM;
globalThis.ReactDOM = ReactDOM;
Object.assign(window, ReactModule);
Object.assign(globalThis, ReactModule);

import Website from "./Website.jsx";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error("Preview render error:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return React.createElement(
        "div",
        {
          style: {
            padding: "20px",
            margin: "20px",
            background: "#fff1f2",
            border: "1px solid #ef4444",
            borderRadius: "8px",
            color: "#991b1b",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          },
        },
        React.createElement("strong", { style: { display: "block", marginBottom: "8px" } }, "Runtime Error in Website:"),
        String(this.state.error?.message || this.state.error)
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Preview root element was not found.");
}

createRoot(rootElement).render(
  React.createElement(ErrorBoundary, null, React.createElement(Website))
);
`;

    fs.writeFileSync(entryFile, entryCode, "utf8");

    const result = await esbuild.build({
      entryPoints: [entryFile],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      target: ["es2020"],
      jsx: "automatic",
      inject: [shimFile],
      nodePaths: [NODE_MODULES],
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      sourcemap: false,
      minify: true,
      logLevel: "silent",
    });

    if (!result.outputFiles?.[0]) {
      throw new Error(
        "esbuild did not produce a browser bundle."
      );
    }

    return result.outputFiles[0].text;
  } catch (error) {
    console.error(
      "React compilation failed:",
      error.message
    );

    const detail =
      error.errors
        ?.map((item) => {
          const location = item.location
            ? `${item.location.file}:${item.location.line}:${item.location.column}`
            : "";

          return `${location} ${item.text}`;
        })
        .join("\n") || error.message;

    throw new Error(
      `React compilation failed: ${detail}`
    );
  } finally {
    fs.rmSync(buildDir, {
      recursive: true,
      force: true,
    });
  }
}

// ======================================================
// PREVIEW HTML
// ======================================================

function createPreviewHtml(
  bundle,
  title = "PromptPilot"
) {
  const safeBundle = JSON.stringify(bundle)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  const safeTitle = String(title)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
html, body, #root {
  margin: 0;
  min-height: 100%;
}
body {
  font-family: Arial, sans-serif;
}
#preview-error {
  display: none;
  margin: 20px;
  padding: 16px;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #ef4444;
  border-radius: 8px;
  white-space: pre-wrap;
  font: 14px/1.5 monospace;
}
</style>
<script>
window.onerror = function(message, source, lineno, colno, error) {
  var box = document.getElementById("preview-error");
  if (box) {
    box.style.display = "block";
    box.textContent = "Script Error: " + message + (error && error.stack ? "\\n\\n" + error.stack : "");
  }
};
window.onunhandledrejection = function(event) {
  var box = document.getElementById("preview-error");
  if (box) {
    box.style.display = "block";
    box.textContent = "Unhandled Promise Rejection: " + (event.reason ? (event.reason.stack || event.reason) : event);
  }
};
</script>
</head>
<body>
<div id="root"></div>
<pre id="preview-error"></pre>

<script>
window.__ONEPORT_BUNDLE__ = ${safeBundle};
</script>

<script>
(function() {
  try {
    const script = document.createElement("script");
    script.textContent = window.__ONEPORT_BUNDLE__;
    document.body.appendChild(script);
  } catch (error) {
    const box = document.getElementById("preview-error");
    if (box) {
      box.style.display = "block";
      box.textContent = error.stack || String(error);
    }
  }
})();
</script>
</body>
</html>`;
}

// ======================================================
// SYNC PROJECT (re-register after server restart)
// ======================================================

app.post("/api/sync", (req, res) => {
  try {
    const projectId = cleanText(req.body?.projectId, 200);
    const code = cleanText(req.body?.code, LIMITS.maxCodeCharacters);
    const name = cleanText(req.body?.name, 100) || "Synced project";

    if (!projectId || !code) {
      return sendError(res, 400, "projectId and code are required.");
    }

    const existing = getProject(projectId);

    saveProject(projectId, {
      ...(existing || {}),
      id: projectId,
      projectId,
      name: existing?.name || name,
      code,
      framework: "react",
      language: "jsx",
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    console.log(`Synced project ${projectId} (${code.length} chars)`);

    return res.json({ ok: true, projectId });
  } catch (error) {
    console.error("Sync error:", error.message);
    return sendError(res, 500, error.message);
  }
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    message: "PromptPilot backend is running.",
    providers: {
      gemini: hasGemini
        ? { configured: true, model: GEMINI_MODEL }
        : { configured: false },
      groq: hasGroq
        ? { configured: true, model: GROQ_MODEL }
        : { configured: false },
    },
    port: PORT,
    limits: {
      generationTokensSimple: LIMITS.generationTokensSimple,
      generationTokensFull: LIMITS.generationTokensFull,
      editTokens: LIMITS.editTokens,
      maxCodeCharacters: LIMITS.maxCodeCharacters,
      maxCodeLines: LIMITS.maxCodeLines,
    },
  });
});

// ======================================================
// GENERATE WEBSITE
// ======================================================

app.post("/api/generate", async (req, res) => {
  try {
    const prompt = cleanText(
      req.body?.prompt,
      LIMITS.maxUserPromptCharacters
    );

    if (!prompt) {
      return sendError(
        res,
        400,
        "Please enter a website description."
      );
    }

    // Check cache first (saves tokens!).
    const cached = getCachedCode(prompt);

    if (cached) {
      console.log("Cache hit — returning cached code.");

      const id = createId();

      const project = {
        id,
        projectId: id,
        name: prompt.slice(0, 60),
        prompt,
        code: cached,
        framework: "react",
        language: "jsx",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      saveProject(id, project);

      return res.status(201).json({
        id,
        projectId: id,
        name: project.name,
        code: cached,
        framework: "react",
        language: "jsx",
        previewUrl: `/preview/${id}`,
        provider: "cache",
      });
    }

    const tokenLimit = getTokenLimit(prompt);

    console.log(
      `Generating website (${tokenLimit} tokens): ${prompt.slice(0, 120)}`
    );

    const { code, provider } = await generateCode(
      buildGenerationPrompt(prompt),
      tokenLimit
    );

    // Compile before saving the project.
    await bundleReactCode(code);

    // Cache the successful result.
    setCachedCode(prompt, code);

    const id = createId();

    const project = {
      id,
      projectId: id,
      name: prompt.slice(0, 60),
      prompt,
      code,
      framework: "react",
      language: "jsx",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveProject(id, project);

    return res.status(201).json({
      id,
      projectId: id,
      name: project.name,
      code,
      framework: "react",
      language: "jsx",
      previewUrl: `/preview/${id}`,
      provider,
    });
  } catch (error) {
    console.error("Generate error:", error.message);

    return sendError(
      res,
      500,
      error.message || "Failed to generate website."
    );
  }
});

// ======================================================
// EDIT WEBSITE
// ======================================================

app.post("/api/edit", async (req, res) => {
  try {
    const projectId = cleanText(
      req.body?.projectId,
      200
    );

    const currentCode = cleanText(
      req.body?.currentCode,
      LIMITS.maxCodeCharacters
    );

    const editPrompt = cleanText(
      req.body?.editPrompt,
      LIMITS.maxEditPromptCharacters
    );

    if (!projectId) {
      return sendError(
        res,
        400,
        "projectId is required."
      );
    }

    if (!currentCode) {
      return sendError(
        res,
        400,
        "currentCode is required."
      );
    }

    if (!editPrompt) {
      return sendError(
        res,
        400,
        "Describe the change you want."
      );
    }

    const { code, provider } = await generateCode(
      buildEditPrompt(currentCode, editPrompt),
      LIMITS.editTokens
    );

    await bundleReactCode(code);

    const previous = getProject(projectId);

    saveProject(projectId, {
      ...(previous || {}),
      id: projectId,
      projectId,
      name: previous?.name || "Edited website",
      code,
      framework: "react",
      language: "jsx",
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      id: projectId,
      projectId,
      code,
      framework: "react",
      language: "jsx",
      previewUrl: `/preview/${projectId}`,
      provider,
    });
  } catch (error) {
    console.error("Edit error:", error.message);

    return sendError(
      res,
      500,
      error.message || "Failed to edit website."
    );
  }
});

// ======================================================
// PUBLISH WEBSITE
// ======================================================

app.post("/api/publish", async (req, res) => {
  try {
    const projectId = cleanText(
      req.body?.projectId,
      200
    );

    const code = cleanText(
      req.body?.code,
      LIMITS.maxCodeCharacters
    );

    const name =
      cleanText(req.body?.name, 100) ||
      "My PromptPilot Website";

    if (!projectId || !code) {
      return sendError(
        res,
        400,
        "projectId and code are required."
      );
    }

    // Do not publish code that fails compilation.
    await bundleReactCode(code);

    const siteId = createId();

    const site = {
      id: siteId,
      projectId,
      name,
      code,
      publishedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${siteId}.json`),
      JSON.stringify(site, null, 2),
      "utf8"
    );

    publishedSites.set(siteId, site);

    const previous = getProject(projectId);

    saveProject(projectId, {
      ...(previous || {}),
      id: projectId,
      projectId,
      name,
      code,
      framework: "react",
      language: "jsx",
      updatedAt: new Date().toISOString(),
    });

    return res.status(201).json({
      id: siteId,
      projectId,
      name,
      url: `/published/${siteId}`,
      previewUrl: `/preview/${projectId}`,
      publishedAt: site.publishedAt,
    });
  } catch (error) {
    console.error("Publish error:", error.message);

    return sendError(
      res,
      500,
      error.message || "Failed to publish website."
    );
  }
});

// ======================================================
// PREVIEW ROUTE
// ======================================================

app.get("/preview/:id", async (req, res) => {
  try {
    let project = getProject(req.params.id);

    // If not found in projects, check publishedSites
    if (!project) {
      project = publishedSites.get(req.params.id);
      if (!project) {
        const safeId = path.basename(req.params.id);
        const filePath = path.join(OUTPUT_DIR, `${safeId}.json`);
        if (fs.existsSync(filePath)) {
          project = JSON.parse(fs.readFileSync(filePath, "utf8"));
          publishedSites.set(project.id, project);
        }
      }
    }

    if (!project) {
      return res
        .status(404)
        .type("text")
        .send(
          "Preview not found. Generate the website again."
        );
    }

    const bundle = await bundleReactCode(project.code);

    return res
      .status(200)
      .type("html")
      .send(createPreviewHtml(bundle, project.name));
  } catch (error) {
    console.error("Preview error:", error.message);

    return res
      .status(500)
      .type("text")
      .send(error.message || "Preview compilation failed.");
  }
});

// ======================================================
// PUBLISHED WEBSITE ROUTE
// ======================================================

app.get("/published/:id", async (req, res) => {
  try {
    let site = publishedSites.get(req.params.id);

    if (!site) {
      const safeId = path.basename(req.params.id);
      const filePath = path.join(
        OUTPUT_DIR,
        `${safeId}.json`
      );

      if (fs.existsSync(filePath)) {
        site = JSON.parse(
          fs.readFileSync(filePath, "utf8")
        );

        publishedSites.set(site.id, site);
      }
    }

    // If not found in publishedSites, check projects
    if (!site) {
      site = getProject(req.params.id);
    }

    if (!site) {
      return res
        .status(404)
        .type("text")
        .send("Published website not found.");
    }

    const bundle = await bundleReactCode(site.code);

    return res
      .status(200)
      .type("html")
      .send(createPreviewHtml(bundle, site.name));
  } catch (error) {
    console.error(
      "Published website error:",
      error.message
    );

    return res
      .status(500)
      .type("text")
      .send(
        error.message ||
          "Published website compilation failed."
      );
  }
});

// ======================================================
// DOWNLOAD STANDALONE HTML
// ======================================================

app.post("/api/download-html", async (req, res) => {
  try {
    const code = cleanText(req.body?.code, LIMITS.maxCodeCharacters);
    const name = cleanText(req.body?.name, 100) || "PromptPilot Website";

    if (!code) {
      return sendError(res, 400, "Code is required to export HTML.");
    }

    const bundle = await bundleReactCode(code);
    const html = createPreviewHtml(bundle, name);

    const safeFilename = (name || "website")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeFilename || "website"}.html"`
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    console.error("HTML Export error:", error.message);
    return sendError(res, 500, error.message || "Failed to generate HTML.");
  }
});

// ======================================================
// UNKNOWN API ROUTES
// ======================================================

app.use("/api", (req, res) => {
  return sendError(
    res,
    404,
    `API route not found: ${req.method} ${req.path}`
  );
});

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use((error, req, res, next) => {
  console.error("Server error:", error.message);

  if (res.headersSent) {
    return next(error);
  }

  if (
    error instanceof SyntaxError &&
    "body" in error
  ) {
    return sendError(
      res,
      400,
      "Invalid JSON request body."
    );
  }

  if (error.type === "entity.too.large") {
    return sendError(
      res,
      413,
      "Request is too large. Reduce the prompt or code size."
    );
  }

  return sendError(
    res,
    500,
    "Internal server error."
  );
});

// ======================================================
// START SERVER
// ======================================================

app.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("======================================");
  console.log("       PROMPTPILOT BACKEND");
  console.log("======================================");
  console.log(`Backend:  http://localhost:${PORT}`);
  console.log(`Health:   http://localhost:${PORT}/api/health`);
  console.log("");
  console.log("Providers:");

  if (hasGemini) {
    console.log(`  ✓ Gemini  ${GEMINI_MODEL} (primary)`);
  } else {
    console.log("  ✗ Gemini  not configured");
  }

  if (hasGroq) {
    console.log(`  ✓ Groq    ${GROQ_MODEL} (fallback)`);
  } else {
    console.log("  ✗ Groq    not configured");
  }

  console.log("");
  console.log(`Tokens:   ${LIMITS.generationTokensSimple} (simple) / ${LIMITS.generationTokensFull} (full)`);
  console.log(`Cache:    up to ${CACHE_MAX_SIZE} prompts`);
  console.log("======================================");
  console.log("");
});