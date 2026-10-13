import { useState } from "react";
import "./styles.css";

export default function Published({
  project,
  apiBase,
  onBack,
  onNew,
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const publishedUrl =
    project.publishedUrl ||
    `${apiBase}/published/${project.id}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publishedUrl);
      setCopied(true);

      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(
        "Clipboard access is unavailable. You can copy the address manually."
      );
    }
  }

  async function downloadHtml() {
    try {
      const response = await fetch(`${apiBase}/api/download-html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: project.code,
          name: project.name || "PromptPilot Website",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to export standalone HTML.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${(project.name || "website")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}.html`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || "Failed to download HTML.");
    }
  }


  return (
    <div className="published-shell">
      <header className="studio-header published-header">
        <div className="studio-header-left">
          <a
            className="wordmark studio-wordmark"
            href="#"
            onClick={(event) => event.preventDefault()}
          >
            <span className="brand-mark">
              <span />
            </span>
            <span>PromptPilot</span>
          </a>

          <span className="header-divider" />

          <span className="project-crumb">Publish project</span>
        </div>

        <div className="studio-header-right">
          <button
            className="button button-secondary compact-button"
            onClick={downloadHtml}
            title="Download full standalone HTML website"
          >
            ↓ Download HTML
          </button>

          <button
            className="button button-secondary compact-button"
            onClick={onBack}
          >
            ← Back to editor
          </button>

          <button
            className="button button-primary compact-button"
            onClick={onNew}
          >
            New project <span>＋</span>
          </button>
        </div>
      </header>

      <main className="published-layout">
        <section className="publish-details">
          <div className="success-icon">✓</div>

          <div className="eyebrow">
            <span className="eyebrow-line" />
            READY FOR THE NEXT STEP
          </div>

          <h1>
            Your work,
            <br />
            <em>ready to share.</em>
          </h1>

          <p className="publish-lede">
            Your React website is published and active on your local
            server. Open it in a new tab, copy the address, or
            download the complete HTML file to run anywhere offline.
          </p>

          <div className="published-project-card">
            <div className="published-project-top">
              <span className="project-file-icon">JS</span>

              <div>
                <strong>
                  {project.name || "Untitled project"}
                </strong>

                <span>React website · Live</span>
              </div>

              <span className="published-status">
                <i />
                Published
              </span>
            </div>

            <label className="field-label" htmlFor="published-url">
              PROJECT ADDRESS
            </label>

            <div className="published-url-field">
              <input
                id="published-url"
                value={publishedUrl}
                readOnly
                onFocus={(event) => event.target.select()}
              />

              <button
                className="button button-secondary"
                onClick={copyUrl}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>

            {error && (
              <div className="notice notice-error" role="alert">
                <span>!</span>
                {error}
              </div>
            )}

            <a
              className="button button-primary open-published"
              href={publishedUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open published site <span>↗</span>
            </a>

            <div className="published-secondary-actions">
              <button className="text-button" onClick={downloadHtml}>
                Download HTML (Standalone) ↓
              </button>

              <button className="text-button" onClick={onBack}>
                Continue editing
              </button>
            </div>
          </div>

          <div className="local-note">
            <span>ⓘ</span>

            <p>
              <strong>Offline-ready standalone export</strong>
              <br />
              Click <strong>Download HTML</strong> to get a self-contained
              website file. You can double-click it on any computer to run
              it directly in any browser without needing Node or internet!
            </p>
          </div>
        </section>

        <section className="published-preview-section">
          <div className="preview-section-heading">
            <div>
              <span className="section-eyebrow">
                THE FINISHED VIEW
              </span>

              <h2>{project.name || "Your website"}</h2>
            </div>

            <span className="preview-live-pill">
              <i />
              Live preview
            </span>
          </div>

          <div className="published-browser">
            <div className="canvas-topbar">
              <div className="browser-controls">
                <span />
                <span />
                <span />
              </div>

              <div className="preview-address">
                <span className="address-lock">⌑</span>
                <span>{publishedUrl}</span>
              </div>

              <span className="browser-topbar-spacer" />
            </div>

            <iframe
              className="site-preview-iframe published-iframe"
              title="Published React website"
              src={publishedUrl}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
            />
          </div>

          <div className="preview-caption">
            <span>✳</span>
            Good work deserves a little room to grow.
          </div>
        </section>
      </main>
    </div>
  );
}

