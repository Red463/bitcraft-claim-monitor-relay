import React from "react";
import { loadBootstrap, type BootstrapPayload } from "./api/bootstrap";
import { RouteLoadingState } from "./components/main/RouteLoadingState";

const App = React.lazy(() => import("./AppShell"));

class RouteErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="route-entry-state">
        <section className="empty-state panel" role="alert">
          <strong>This page could not be loaded.</strong>
          <span>Check your connection, then try again.</span>
          <button className="toolbar-button primary" onClick={() => window.location.reload()}>Try again</button>
        </section>
      </main>
    );
  }
}

export default function TimbersteelRoot() {
  const [bootstrap, setBootstrap] = React.useState<BootstrapPayload | null>(null);
  const [bootstrapError, setBootstrapError] = React.useState("");
  const [bootstrapAttempt, setBootstrapAttempt] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setBootstrap(null);
    setBootstrapError("");
    loadBootstrap(fetch, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setBootstrap(payload);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setBootstrapError(error instanceof Error ? error.message : "Unable to start the app.");
      });
    return () => controller.abort();
  }, [bootstrapAttempt]);

  const entry = bootstrap ? (
    <React.Suspense fallback={<main className="route-entry-state"><RouteLoadingState /></main>}>
      <App initialBootstrap={bootstrap} />
    </React.Suspense>
  ) : bootstrapError ? (
    <main className="route-entry-state">
      <section className="empty-state panel" role="alert">
        <strong>The application could not be started.</strong>
        <span>{bootstrapError}</span>
        <button className="toolbar-button primary" onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}>Try again</button>
      </section>
    </main>
  ) : <main className="route-entry-state"><RouteLoadingState label="Starting application" /></main>;

  return <RouteErrorBoundary>{entry}</RouteErrorBoundary>;
}
