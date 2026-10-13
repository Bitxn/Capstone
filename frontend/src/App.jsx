
import { useState } from "react";
import Editor from "./Editor.jsx";
import Published from "./Published.jsx";
import "./styles.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const EXAMPLES = [
  {
    icon: "↗",
    title: "SaaS landing page",
    prompt:
      "Create a polished SaaS landing page for a project management platform. Include a hero section, features, testimonials, pricing, and a call to action. Use warm white, forest green, elegant typography, and a premium editorial design.",
  },
  {
    icon: "✳",
    title: "Creative portfolio",
    prompt:
      "Create an elegant portfolio for an independent brand designer. Include an introduction, selected projects, about section, services, and contact details. Use expressive typography, a refined color palette, and subtle animations.",
  },
  {
    icon: "⌂",
    title: "Restaurant website",
    prompt:
      "Create a premium neighbourhood restaurant website with a welcoming hero, seasonal menu, restaurant story, opening hours, location, and reservation call to action. Use warm colors, sophisticated typography, and beautiful spacing.",
  },
  {
    icon: "▥",
    title: "Analytics dashboard",
    prompt:
      "Create a responsive business analytics dashboard with a sidebar, KPI cards, revenue charts, recent transactions, date filters, and a task list. Make the controls interactive using React state.",
  },
];

function makeProjectName(prompt) {
  const clean = prompt.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 39)}…` : clean;
}

export default function App() {
  const [page, setPage] = useState("home");
  const [prompt, setPrompt] = useState("");
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate(value = prompt) {
    if (!value.trim()) {
      setError("Tell us a little about the website you want to create.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: value.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Website generation failed.");
      }

      if (!data.code || !data.id) {
        throw new Error(
          "The backend did not return React code. Make sure your updated JSX backend is running."
        );
      }

      setProject({
        id: data.id,
        name: makeProjectName(value),
        code: data.code,
        previewUrl: data.previewUrl
          ? data.previewUrl.startsWith("http")
            ? data.previewUrl
            : `${API_BASE}${data.previewUrl}`
          : "",
        publishedUrl: "",
        provider: data.provider || "ai",
      });

      setPrompt(value);
      setPage("editor");
    } catch (err) {
      setError(
        err.message ||
          "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setPage("home");
    setProject(null);
    setPrompt("");
    setError("");
  }

  if (page === "editor" && project) {
    return (
      <Editor
        project={project}
        setProject={setProject}
        prompt={prompt}
        apiBase={API_BASE}
        onBack={() => setPage("home")}
        onPublish={() => setPage("published")}
      />
    );
  }

  if (page === "published" && project) {
    return (
      <Published
        project={project}
        apiBase={API_BASE}
        onBack={() => setPage("editor")}
        onNew={startNew}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="site-nav">
        <a
          href="#home"
          className="wordmark"
          onClick={(event) => {
            event.preventDefault();
            startNew();
          }}
        >
          <span className="brand-mark">
            <span />
          </span>

          <span>PromptPilot</span>

          <span className="wordmark-divider" />

          <span className="wordmark-product">studio</span>
        </a>

        <nav className="nav-actions">
          <a className="nav-text-link" href="#how-it-works">
            How it works
          </a>

          <span className="nav-status">
            <span className="status-dot" />
            Workspace ready
          </span>
        </nav>
      </header>

      <main className="home-main" id="home">
        <section className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            YOUR IDEAS, WELL MADE
          </div>

          <h1>
            A good website
            <br />
            starts with <em>a thought.</em>
          </h1>

          <p className="hero-description">
            Describe what you have in mind. PromptPilot turns your
            brief into a working React experience you can
            refine, preview, and make your own.
          </p>

          <div className="trust-row">
            <span className="trust-icon">✳</span>
            <span>Powered by AI</span>
            <span className="trust-separator">·</span>
            <span>React components</span>
            <span className="trust-separator">·</span>
            <span>Made to be edited</span>
          </div>
        </section>

        <section className="builder-card">
          <div className="builder-card-top">
            <div>
              <div className="card-kicker">NEW PROJECT</div>

              <h2>What are we making today?</h2>

              <p>
                Start with a clear brief. You can change
                anything later.
              </p>
            </div>

            <div className="sparkle-art" aria-hidden="true">
              ✳
            </div>
          </div>

          <form
            className="prompt-form"
            onSubmit={(event) => {
              event.preventDefault();
              generate();
            }}
          >
            <label className="field-label" htmlFor="site-prompt">
              YOUR BRIEF
            </label>

            <textarea
              id="site-prompt"
              className="brief-input"
              placeholder="A thoughtful, modern website for a neighbourhood coffee shop. Warm colours, a seasonal menu, our story, and a simple way to find us…"
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setError("");
              }}
              rows={5}
              maxLength={12000}
            />

            <div className="input-meta">
              <span>
                Be specific about the pages, style, and features.
              </span>

              <span>{prompt.length.toLocaleString()} / 12,000</span>
            </div>

            <div className="form-bottom">
              <span className="keyboard-hint">
                <kbd>Ctrl</kbd>
                <kbd>Enter</kbd>
                to generate
              </span>

              <button
                className="button button-primary generate-button"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="button-spinner" />
                    Creating your site…
                  </>
                ) : (
                  <>
                    Create website <span>↗</span>
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="notice notice-error" role="alert">
                <span>!</span>
                {error}
              </div>
            )}
          </form>

          <div className="example-section">
            <div className="example-heading">
              <span>NEED A STARTING POINT?</span>
              <span>CHOOSE A BRIEF</span>
            </div>

            <div className="example-grid">
              {EXAMPLES.map((example) => (
                <button
                  key={example.title}
                  className="example-card"
                  type="button"
                  onClick={() => {
                    setPrompt(example.prompt);
                    setError("");
                  }}
                >
                  <span className="example-symbol">
                    {example.icon}
                  </span>

                  <span className="example-title">
                    {example.title}
                  </span>

                  <span className="example-arrow">↗</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="how-section" id="how-it-works">
          <div className="section-heading">
            <span className="section-eyebrow">
              A SIMPLE WAY FORWARD
            </span>

            <h2>From first thought to finished site.</h2>
          </div>

          <div className="steps-grid">
            <article className="step-card">
              <span className="step-number">01</span>
              <div className="step-icon">✎</div>
              <h3>Describe it</h3>
              <p>
                Share the idea, the feeling, and the features
                you need. No coding experience required.
              </p>
            </article>

            <article className="step-card">
              <span className="step-number">02</span>
              <div className="step-icon">✳</div>
              <h3>Shape it</h3>
              <p>
                Get a working React starting point, then refine
                the details with simple instructions.
              </p>
            </article>

            <article className="step-card">
              <span className="step-number">03</span>
              <div className="step-icon">↗</div>
              <h3>Make it yours</h3>
              <p>
                Preview different screen sizes, inspect your
                code, and publish to your local workspace.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a
          className="wordmark footer-wordmark"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            startNew();
          }}
        >
          <span className="brand-mark">
            <span />
          </span>
          <span>PromptPilot</span>
        </a>

        <span>
          A calmer way to get from idea to interface.
        </span>

        <span className="footer-note">
          AI-Powered Website Generation
        </span>
      </footer>
    </div>
  );
}

