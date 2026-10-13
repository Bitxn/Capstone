import { useEffect, useState } from "react";
import "./styles.css";

const VIEWPORTS = [
  { id: "desktop", label: "Desktop", width: "100%", icon: "▱" },
  { id: "tablet", label: "Tablet", width: "768px", icon: "▯" },
  { id: "mobile", label: "Mobile", width: "390px", icon: "▯" },
];

const QUICK_EDITS = [
  "Make the design feel more premium and considered",
  "Improve the mobile layout and spacing",
  "Add a working dark mode toggle",
  "Add subtle entrance animations",
  "Improve accessibility and keyboard navigation",
  "Add a contact form with inline validation",
];

export default function Editor({
  project,
  setProject,
  prompt,
  apiBase,
  onBack,
  onPublish,
}) {
  const [editPrompt, setEditPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("preview");
  const [panelTab, setPanelTab] = useState("ai");
  const [viewport, setViewport] = useState("desktop");
  const [copied, setCopied] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const [history, setHistory] = useState([
    {
      label: "First version",
      code: project.code,
    },
  ]);

  const currentViewport =
    VIEWPORTS.find((item) => item.id === viewport) ||
    VIEWPORTS[0];

  const previewUrl = project.id
    ? `${apiBase}/preview/${project.id}?v=${previewKey}`
    : "";

  async function refreshPreview(customCode) {
    const codeToSync = customCode || project.code;
    if (project.id && codeToSync) {
      try {
        await fetch(`${apiBase}/api/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: project.id,
            code: codeToSync,
            name: project.name,
          }),
        });
      } catch (err) {
        // Silent
      }
    }
    setPreviewKey((key) => key + 1);
  }

  // Sync project to backend on mount (survives server restarts).
  useEffect(() => {
    if (project.id && project.code) {
      refreshPreview(project.code);
    }
  }, [project.id]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        tab === "preview"
      ) {
        event.preventDefault();

        if (editPrompt.trim() && !loading) {
          applyEdit();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () =>
      window.removeEventListener("keydown", handleKeyDown);
  }, [editPrompt, loading, tab]);

  async function applyEdit() {
    if (!editPrompt.trim() || loading) return;

    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${apiBase}/api/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          currentCode: project.code,
          editPrompt: editPrompt.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to edit website.");
      }

      if (!data.code) {
        throw new Error("The server returned no updated React code.");
      }

      setHistory((items) => [
        ...items,
        {
          label: editPrompt.trim().slice(0, 52),
          code: data.code,
        },
      ]);

      setProject((current) => ({
        ...current,
        id: data.id || current.id,
        code: data.code,
        previewUrl: data.previewUrl
          ? data.previewUrl.startsWith("http")
            ? data.previewUrl
            : `${apiBase}${data.previewUrl}`
          : "",
      }));

      setEditPrompt("");
      setPreviewKey((key) => key + 1);
      setTab("preview");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function restoreVersion(version) {
    setProject((current) => ({
      ...current,
      code: version.code,
    }));

    refreshPreview(version.code);
    setTab("preview");
    setPanelTab("ai");
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(project.code);
      setCopied(true);

      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
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


  async function publish() {
    setError("");
    setPublishing(true);

    try {
      const response = await fetch(`${apiBase}/api/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: project.id,
          code: project.code,
          name: project.name,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to publish website.");
      }

      setProject((current) => ({
        ...current,
        publishedId: data.id,
        publishedUrl: data.url
          ? data.url.startsWith("http")
            ? data.url
            : `${apiBase}${data.url}`
          : `${apiBase}/published/${data.id}`,
      }));

      onPublish();
    } catch (err) {
      setError(err.message || "Publishing failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="studio-header-left">
          <button className="back-link" onClick={onBack}>
            ← <span>Workspace</span>
          </button>

          <span className="header-divider" />

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

          <span className="project-crumb" title={prompt}>
            {project.name || "Untitled project"}
          </span>
        </div>

        <div className="studio-header-center">
          <div className="segmented-control">
            <button
              className={
                tab === "preview" ? "segment active" : "segment"
              }
              onClick={() => {
                setTab("preview");
                refreshPreview();
              }}
            >
              Preview
            </button>

            <button
              className={
                tab === "code" ? "segment active" : "segment"
              }
              onClick={() => setTab("code")}
            >
              Code
            </button>
          </div>

          {tab === "preview" && (
            <div className="viewport-control">
              {VIEWPORTS.map((item) => (
                <button
                  key={item.id}
                  className={
                    viewport === item.id
                      ? "viewport-button active"
                      : "viewport-button"
                  }
                  onClick={() => setViewport(item.id)}
                  title={item.label}
                  aria-label={`${item.label} preview`}
                >
                  {item.icon}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="studio-header-right">
          <button
            className="button button-secondary compact-button"
            onClick={downloadHtml}
            title="Download full standalone HTML website"
          >
            ↓ <span>Download HTML</span>
          </button>

          <button
            className="button button-primary compact-button"
            onClick={publish}
            disabled={publishing}
          >
            {publishing ? (
              <>
                <span className="button-spinner" />
                Publishing
              </>
            ) : (
              <>
                Publish <span>↗</span>
              </>
            )}
          </button>
        </div>
      </header>

      <div className="studio-workspace">
        <aside className="assistant-panel">
          <div className="panel-project-label">
            <span className="live-indicator" />
            WORKING DRAFT
          </div>

          <div className="panel-tabs">
            <button
              className={
                panelTab === "ai" ? "panel-tab active" : "panel-tab"
              }
              onClick={() => setPanelTab("ai")}
            >
              Refine
            </button>

            <button
              className={
                panelTab === "history"
                  ? "panel-tab active"
                  : "panel-tab"
              }
              onClick={() => setPanelTab("history")}
            >
              Versions{" "}
              <span className="version-count">{history.length}</span>
            </button>
          </div>

          {panelTab === "ai" ? (
            <div className="assistant-content">
              <div className="assistant-intro">
                <span className="assistant-avatar">✳</span>

                <div>
                  <h2>Let's make it better.</h2>
                  <p>
                    Tell me what you'd like to change. I'll keep
                    the parts that are already working.
                  </p>
                </div>
              </div>

              <div className="mini-label">GOOD NEXT STEPS</div>

              <div className="quick-edit-list">
                {QUICK_EDITS.map((item, index) => (
                  <button
                    key={item}
                    className="quick-edit"
                    onClick={() => setEditPrompt(item)}
                  >
                    <span className="quick-edit-index">
                      0{index + 1}
                    </span>

                    <span>{item}</span>

                    <span className="quick-edit-arrow">↗</span>
                  </button>
                ))}
              </div>

              <div className="mini-label custom-label">
                YOUR INSTRUCTIONS
              </div>

              <textarea
                className="edit-prompt-input"
                value={editPrompt}
                onChange={(event) =>
                  setEditPrompt(event.target.value)
                }
                placeholder="For example, make the header sticky and add a clear call to action…"
                rows={5}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    applyEdit();
                  }
                }}
              />

              {error && (
                <div className="notice notice-error" role="alert">
                  <span>!</span>
                  {error}
                </div>
              )}

              <button
                className="button button-primary apply-button"
                onClick={applyEdit}
                disabled={loading || !editPrompt.trim()}
              >
                {loading ? (
                  <>
                    <span className="button-spinner" />
                    Working on it…
                  </>
                ) : (
                  <>
                    Apply changes <span>↗</span>
                  </>
                )}
              </button>

              <p className="panel-footnote">
                Tip: <kbd>Ctrl</kbd> <kbd>Enter</kbd> applies your
                instructions.
              </p>
            </div>
          ) : (
            <div className="assistant-content history-content">
              <div className="mini-label">PROJECT HISTORY</div>

              <p className="history-description">
                Return to an earlier version whenever you need to.
              </p>

              {[...history].reverse().map((item, index) => (
                <div
                  className="history-item"
                  key={`${item.label}-${index}`}
                >
                  <span className="history-timeline-dot" />

                  <div className="history-item-copy">
                    <strong>
                      {index === 0 ? "Latest version" : item.label}
                    </strong>
                    <span>{item.label}</span>
                  </div>

                  <button
                    className="text-button"
                    onClick={() => restoreVersion(item)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="panel-bottom-note">
            <span>✳</span>
            A good first draft is just the beginning.
          </div>
        </aside>

        <main className="work-area">
          <div className="canvas-topbar">
            <div className="browser-controls">
              <span />
              <span />
              <span />
            </div>

            <div className="preview-address">
              <span className="address-lock">⌑</span>
              <span>
                {tab === "code" ? "src / App.jsx" : "Your live preview"}
              </span>
            </div>

            <button
              className="refresh-button"
              title="Refresh preview"
              onClick={() => refreshPreview()}
            >
              ↻
            </button>
          </div>

          {tab === "preview" ? (
            <div className="preview-canvas">
              <div
                className="preview-frame"
                style={{ width: currentViewport.width }}
              >
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  title="React website preview"
                  className="site-preview-iframe"
                  sandbox="allow-scripts allow-forms allow-modals allow-popups"
                />
              </div>
            </div>
          ) : (
            <div className="code-editor-wrap">
              <div className="code-toolbar">
                <div>
                  <span className="file-icon">JS</span>
                  <strong>App.jsx</strong>
                  <span className="code-badge">React</span>
                </div>

                <button className="text-button" onClick={copyCode}>
                  {copied ? "✓ Copied" : "Copy code"}
                </button>
              </div>

              <textarea
                className="source-editor"
                spellCheck={false}
                value={project.code}
                onChange={(event) =>
                  setProject((current) => ({
                    ...current,
                    code: event.target.value,
                  }))
                }
                aria-label="React source code"
              />

              <div className="code-statusbar">
                <span>
                  JSX · {project.code.length.toLocaleString()}{" "}
                  characters · {project.code.split("\n").length} lines
                </span>

                <span>Changes are included when you publish.</span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

