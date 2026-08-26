import React from "react";
import { ArrowDown, LockKeyhole, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

import type { AppSidebarProps } from "./types";

type Tooltip = { label: string; left: number; top: number };

export function AppSidebar({
  brand,
  collapsed,
  onCollapsedChange,
  groups,
  account,
  secondaryAction,
  status,
  mobileOpen,
  onRequestClose,
}: AppSidebarProps) {
  const [tooltip, setTooltip] = React.useState<Tooltip | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = React.useState(() => window.matchMedia("(max-width: 760px)").matches);
  const mobileNavigationUnavailable = isNarrowViewport && !mobileOpen;

  React.useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 760px)");
    const updateNarrowViewport = () => setIsNarrowViewport(narrowViewport.matches);
    narrowViewport.addEventListener("change", updateNarrowViewport);
    return () => narrowViewport.removeEventListener("change", updateNarrowViewport);
  }, []);

  React.useEffect(() => {
    setTooltip(null);
  }, [collapsed, mobileOpen]);

  const showTooltip = (element: HTMLElement, label: string) => {
    if (!collapsed) return;
    const bounds = element.getBoundingClientRect();
    setTooltip({ label, left: bounds.right + 8, top: bounds.top + bounds.height / 2 });
  };

  return (
    <>
      <aside
        id="mobile-navigation"
        aria-label="Mobile navigation"
        aria-hidden={mobileNavigationUnavailable ? true : undefined}
        inert={mobileNavigationUnavailable ? true : undefined}
        className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`}
      >
        <button type="button" className="mobile-navigation-close" aria-label="Close navigation" onClick={onRequestClose}>
          <X size={18} />
        </button>
        <div className="brand">
          <img
            src={brand.logoUrl}
            alt=""
            onError={brand.fallbackLogoUrl ? (event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = brand.fallbackLogoUrl!;
            } : undefined}
          />
          <div title={brand.titleAttribute ?? brand.title}>
            <h1>{brand.title}</h1>
            <span>{brand.subtitle}</span>
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={() => onCollapsedChange(!collapsed)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {account || secondaryAction ? <div className="sidebar-top-stack">{account}{secondaryAction}</div> : null}
        <nav aria-label="Main navigation" data-tour="sidebar-navigation">
          {groups.map((group) => {
            const hasActivePage = group.items.some((item) => item.active);
            return (
              <section className={`sidebar-section ${group.expanded ? "" : "is-collapsed"} ${hasActivePage ? "has-active" : ""}`} key={group.id}>
                <button
                  className="sidebar-section-title"
                  type="button"
                  aria-expanded={group.expanded}
                  onClick={() => group.onExpandedChange(!group.expanded)}
                >
                  <span>{group.label}</span>
                  <ArrowDown size={12} aria-hidden="true" />
                </button>
                <div className="sidebar-section-items">
                  {group.items.map((item) => {
                    const accessibleLabel = item.disabled
                      ? `${item.label} — ${item.disabledReason ?? "Unavailable"}`
                      : item.restricted ? `${item.label} — restricted` : item.label;
                    const Icon = item.icon;
                    return item.disabled ? (
                      <span
                        key={item.id}
                        className="nav-destination is-disabled"
                        role="link"
                        aria-disabled="true"
                        title={accessibleLabel}
                        onMouseEnter={(event) => showTooltip(event.currentTarget, accessibleLabel)}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <Icon size={16} />
                        <span className="nav-label">{item.label}</span>
                        {" "}
                        <small className="nav-status">{item.disabledReason}</small>
                      </span>
                    ) : (
                      <a
                        key={item.id}
                        className={["nav-destination", item.active ? "active" : "", item.restricted ? "is-restricted" : ""].filter(Boolean).join(" ")}
                        href={item.href}
                        aria-current={item.active ? "page" : undefined}
                        aria-label={accessibleLabel}
                        data-restricted={item.restricted || undefined}
                        title={accessibleLabel}
                        onMouseEnter={(event) => showTooltip(event.currentTarget, accessibleLabel)}
                        onMouseLeave={() => setTooltip(null)}
                        onFocus={(event) => showTooltip(event.currentTarget, accessibleLabel)}
                        onBlur={() => setTooltip(null)}
                        onClick={(event) => {
                          item.onActivate?.(event);
                          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onRequestClose();
                        }}
                      >
                        <Icon size={16} />
                        <span className="nav-label">{item.label}</span>
                        <span className="collapsed-nav-label" aria-hidden="true">{item.label}</span>
                        {item.restricted ? <LockKeyhole className="nav-access-lock" size={13} aria-hidden="true" /> : null}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
        {status}
      </aside>
      {tooltip ? <span className="collapsed-nav-tooltip" aria-hidden="true" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</span> : null}
    </>
  );
}
