import React from "react";
import { Menu } from "lucide-react";

import type { AppFrameProps } from "./types";

export function AppFrame({
  shellClassName,
  pageLabel,
  routeKey,
  sidebar,
  utilityBar,
  footer,
  refreshLineVisible,
  mainRef,
  overlays,
  children,
}: AppFrameProps) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const menuTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const previousMobileOpen = React.useRef(false);

  React.useEffect(() => {
    setMobileOpen(false);
  }, [routeKey]);

  React.useEffect(() => {
    if (previousMobileOpen.current && !mobileOpen) menuTriggerRef.current?.focus();
    previousMobileOpen.current = mobileOpen;
  }, [mobileOpen]);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (mobileOpen) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileOpen]);

  React.useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  const resolvedShellClassName = shellClassName ?? "app-shell";
  const onRequestClose = () => setMobileOpen(false);

  return (
    <div className={resolvedShellClassName}>
      {sidebar ? (
        <>
          <header className="mobile-shell-bar">
            <span><strong className="mobile-shell-brand">Claim Monitor</strong><small className="mobile-shell-route">{pageLabel}</small></span>
            <button ref={menuTriggerRef} type="button" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>
              <Menu size={18} />
            </button>
          </header>
          {mobileOpen ? <button type="button" className="mobile-navigation-backdrop" aria-label="Close navigation" onClick={onRequestClose} /> : null}
          {sidebar({ mobileOpen, onRequestClose })}
        </>
      ) : null}
      <main ref={mainRef} tabIndex={-1}>
        {utilityBar}
        {refreshLineVisible == null ? null : <div className={`page-refresh-line ${refreshLineVisible ? "is-visible" : ""}`} aria-hidden="true" />}
        {children}
        {footer}
      </main>
      {overlays}
    </div>
  );
}
