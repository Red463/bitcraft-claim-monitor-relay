import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { mapToolNeedsInitialFocus, nextMapTool, type MapToolId } from "./mapToolDockState.mjs";

export type MapToolDescriptor = {
  id: MapToolId;
  label: string;
  count?: number;
  icon: React.ReactNode;
  panel: React.ReactNode;
  panelClassName?: string;
  primaryFocusSelector?: string;
};

export function MapToolDock({ tools, trailingControl }: { tools: MapToolDescriptor[]; trailingControl?: React.ReactNode }) {
  const [activeTool, setActiveTool] = React.useState<MapToolId | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRefs = React.useRef(new Map<MapToolId, HTMLButtonElement>());
  const focusedToolRef = React.useRef<MapToolId | null>(null);
  const [panelAnchor, setPanelAnchor] = React.useState({ left: 0, top: 0 });
  const activeDescriptor = tools.find((tool) => tool.id === activeTool) ?? null;

  const close = React.useCallback((restoreFocus: boolean) => {
    setActiveTool((closingTool) => {
      if (restoreFocus && closingTool) {
        window.requestAnimationFrame(() => triggerRefs.current.get(closingTool)?.focus());
      }
      return null;
    });
  }, []);

  React.useEffect(() => {
    const needsInitialFocus = mapToolNeedsInitialFocus(focusedToolRef.current, activeTool);
    focusedToolRef.current = activeTool;
    if (!activeDescriptor || !needsInitialFocus) return;
    const frame = window.requestAnimationFrame(() => {
      const requested = activeDescriptor.primaryFocusSelector
        ? panelRef.current?.querySelector<HTMLElement>(activeDescriptor.primaryFocusSelector)
        : null;
      (requested ?? panelRef.current?.querySelector<HTMLElement>("[data-map-tool-heading]"))?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeDescriptor, activeTool]);

  React.useEffect(() => {
    if (!activeTool) return;
    const updatePanelAnchor = () => {
      const rect = triggerRefs.current.get(activeTool)?.getBoundingClientRect();
      if (rect) setPanelAnchor({ left: rect.left, top: rect.bottom + 7 });
    };
    updatePanelAnchor();
    window.addEventListener("resize", updatePanelAnchor);
    window.addEventListener("scroll", updatePanelAnchor, true);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-map-tool-panel]")) return;
      if (rootRef.current?.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updatePanelAnchor);
      window.removeEventListener("scroll", updatePanelAnchor, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeTool, close]);

  return (
    <div ref={rootRef} className="native-map-tool-dock" role="toolbar" aria-label="Map tools">
      <div className="native-map-tool-triggers">
        {tools.map((tool) => {
          const panelId = `native-map-tool-panel-${tool.id}`;
          return (
            <button
              key={tool.id}
              ref={(element) => {
                if (element) triggerRefs.current.set(tool.id, element);
                else triggerRefs.current.delete(tool.id);
              }}
              type="button"
              className={`native-map-tool-trigger${activeTool === tool.id ? " is-active" : ""}`}
              aria-expanded={activeTool === tool.id}
              aria-controls={panelId}
              onClick={() => setActiveTool((current) => nextMapTool(current, tool.id))}
              title={tool.count == null ? tool.label : `${tool.label} (${tool.count})`}
            >
              {tool.icon}
              <span className="native-map-tool-label">{tool.label}</span>
              {tool.count == null ? null : <span className="native-map-tool-count" aria-label={`${tool.count} selected`}>{tool.count}</span>}
            </button>
          );
        })}
        {trailingControl}
      </div>
      {activeDescriptor ? createPortal((
        <div
          ref={panelRef}
          id={`native-map-tool-panel-${activeDescriptor.id}`}
          className={`native-map-tool-panel native-map-tool-panel--${activeDescriptor.id}${activeDescriptor.panelClassName ? ` ${activeDescriptor.panelClassName}` : ""}`}
          data-map-tool-panel
          role="group"
          aria-labelledby={`native-map-tool-heading-${activeDescriptor.id}`}
          style={{
            "--map-tool-anchor-left": `${panelAnchor.left}px`,
            "--map-tool-anchor-top": `${panelAnchor.top}px`,
          } as React.CSSProperties}
        >
          <div className="native-map-tool-panel-header">
            <h2 id={`native-map-tool-heading-${activeDescriptor.id}`} data-map-tool-heading tabIndex={-1}>{activeDescriptor.label}</h2>
            <button type="button" className="icon-button" aria-label={`Close ${activeDescriptor.label}`} onClick={() => close(true)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {activeDescriptor.panel}
        </div>
      ), document.body) : null}
    </div>
  );
}
