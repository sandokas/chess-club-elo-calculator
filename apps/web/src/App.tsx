import { useEffect, useState } from "react";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; service: string }
  | { status: "error"; message: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiBaseUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`API responded with ${response.status}`);
        }
        return response.json() as Promise<{ status: string; service: string }>;
      })
      .then((payload) => {
        setHealth({ status: "ok", service: payload.service });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setHealth({
          status: "error",
          message: error instanceof Error ? error.message : "Unable to reach API"
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <section className="status-panel" aria-labelledby="app-title">
        <p className="eyebrow">Chess Club Manager</p>
        <h1 id="app-title">Admin foundation</h1>
        <p className="lede">
          The TypeScript web app shell is ready. This first milestone is focused on API health,
          PostgreSQL migrations, and verified import of the existing club data.
        </p>

        <div className={`health-card health-card--${health.status}`}>
          <span className="health-dot" aria-hidden="true" />
          <div>
            <p className="health-label">API status</p>
            {health.status === "loading" && <p>Checking {apiBaseUrl}</p>}
            {health.status === "ok" && <p>{health.service} is reachable.</p>}
            {health.status === "error" && <p>{health.message}</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
