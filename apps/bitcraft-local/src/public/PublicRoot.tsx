import React from "react";
import type { FrontendProfile } from "../api/profile";
import { PublicAppShell } from "./PublicAppShell";
import { resolvePublicRoute } from "./routes.mjs";

export default function PublicRoot({ profile }: { profile: FrontendProfile }) {
  const [route, setRoute] = React.useState(() => resolvePublicRoute(window.location.pathname));
  React.useEffect(() => {
    const update = () => setRoute(resolvePublicRoute(window.location.pathname));
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  React.useEffect(() => {
    if (!route.canonicalPath) return;
    const canonicalUrl = `${route.canonicalPath}${window.location.search}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", canonicalUrl);
    setRoute(resolvePublicRoute(route.canonicalPath));
  }, [route.canonicalPath]);
  if (route.id === "not-found") {
    return <main className="public-not-found" data-public-route="not-found"><h1>Page not found</h1><p>This public claim-monitor page is not available.</p><a className="toolbar-button primary" href="/">Open claim monitor</a></main>;
  }
  return <PublicAppShell route={route} features={profile.features} />;
}
