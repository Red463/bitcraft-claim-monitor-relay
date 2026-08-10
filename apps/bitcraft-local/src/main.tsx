import React from "react";
import { createRoot } from "react-dom/client";
import { FeaturebaseProvider } from "featurebase-js/react";
import { RouteLoadingState } from "./components/main/RouteLoadingState";
import "./styles.css";

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

function Root() {
  const [featurebaseJwt, setFeaturebaseJwt] = React.useState<string | undefined>();

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/local/auth/me", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((auth) => {
        if (typeof auth?.featurebaseJwt === "string") setFeaturebaseJwt(auth.featurebaseJwt);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return (
    <FeaturebaseProvider
      appId="6a78ff10ace030d1aa7582f2"
      featurebaseJwt={featurebaseJwt}
      theme="dark"
      language="en"
      alignment="right"
    >
      <RouteErrorBoundary>
        <React.Suspense fallback={<main className="route-entry-state"><RouteLoadingState /></main>}>
          <App />
        </React.Suspense>
      </RouteErrorBoundary>
    </FeaturebaseProvider>
  );
}

// Keep this file as the React bootstrapping boundary only. App-level routing,
// settings, and data coordination live in AppShell so future maintainers do not
// have to trace startup behaviour through multiple entrypoints.
createRoot(document.getElementById("root")!).render(<Root />);
