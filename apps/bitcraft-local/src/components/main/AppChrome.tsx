import React from "react";
import { TriangleAlert } from "lucide-react";
import { parseDateValue, toNumber, type AnyRecord } from "../../main-app-data";
import { unique } from "../../utils/array";
import { DataTable } from "./DataTable";
import { AsyncState } from "./AsyncState";

/*
 * Shared chrome for the public app: page headers, loading/error states, the
 * live-data warning banner, and the sidebar refresh status widget.
 */

export function Header({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function ToolbarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button className="toolbar-button" onClick={onClick}>{children}</button>;
}

export function ShutdownNotice() {
  return (
    <section className="shutdown-notice" aria-label="App shutdown notice">
      <TriangleAlert size={20} aria-hidden="true" />
      <div>
        <strong>Timbersteel Claim Monitor will be shutting down soon</strong>
        <p>As I’m no longer playing BitCraft, I’ll be shutting down app.timbersteeltrade.com soon. Thank you for using and supporting the app.</p>
      </div>
    </section>
  );
}

export function TablePanel({ title, subtitle, rows, columns }: { title: string; subtitle: string; rows: AnyRecord[]; columns: Array<[string, (row: AnyRecord, index: number) => React.ReactNode]> }) {
  return <div className="panel"><Header title={title}>{subtitle}</Header><DataTable rows={rows} columns={columns} scrollLabel={`${title} table`} emptyState={`No ${title.toLowerCase()} records were returned.`} /></div>;
}

export function AppSkeleton() {
  return <div className="panel app-skeleton" role="status" aria-live="polite" aria-busy="true" aria-label="Loading page data"><div className="skeleton-line title" /><div className="skeleton-grid">{[0, 1, 2, 3].map((id) => <div key={id} />)}</div><div className="skeleton-block" /><div className="skeleton-block short" /></div>;
}

export type ApiStatusDiagnostics = {
  appVersion: string;
  page: string;
  claimId: string;
  url: string;
  loading: boolean;
  lastSuccessfulRefresh: string | null;
  warningCount: number;
  dataCounts: Record<string, number>;
  warnings: string[];
};

function collectorTimeLabel(value: unknown): string {
  const date = parseDateValue(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting";
}

export function RefreshStatus({
  loading,
  lastUpdated,
  collectorStatus,
  intervalSeconds,
  warnings,
  diagnostics,
}: {
  loading: boolean;
  lastUpdated: Date | null;
  collectorStatus: AnyRecord | null | undefined;
  intervalSeconds: number;
  warnings: string[];
  diagnostics: ApiStatusDiagnostics;
}) {
  const collectors = Object.entries((collectorStatus?.collectors ?? {}) as Record<string, AnyRecord>);
  const warningDetails = unique(warnings).slice(0, 6);
  const diagnosticLog = JSON.stringify({ ...diagnostics, warnings: warningDetails }, null, 2);
  const [warningOpen, setWarningOpen] = React.useState(false);
  const warningRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!warningOpen) return undefined;
    const closeOnOutside = (event: PointerEvent) => {
      if (!warningRef.current?.contains(event.target as Node)) setWarningOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWarningOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [warningOpen]);
  const collectorDetail = (collector: AnyRecord) => {
    if (collector.running) {
      const hasProgress = collector.progressCurrent != null && collector.progressTotal != null;
      const progress = hasProgress ? ` (${toNumber(collector.progressCurrent)} / ${toNumber(collector.progressTotal)})` : "";
      return `${collector.currentStep ?? "Running"}${progress}`;
    }
    return collector.lastError ? `Error: ${collector.lastError}` : `Updated ${collectorTimeLabel(collector.lastSuccessAt)}`;
  };
  return (
    <div className="refresh-status" aria-label={`Live updates apply immediately; local fallback refreshes every ${intervalSeconds} seconds`} tabIndex={0}>
      <span className={`refresh-dot ${loading ? "refreshing" : ""}`} />
      <span className="refresh-copy">
        <small>{loading ? "Refreshing" : "Last refresh"}</small>
        <time>{lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting..."}</time>
      </span>
      {warningDetails.length ? (
        <div className="refresh-warning" ref={warningRef} onMouseEnter={() => setWarningOpen(true)} onMouseLeave={() => {
          if (!warningRef.current?.contains(document.activeElement)) setWarningOpen(false);
        }}>
          <button type="button" aria-expanded={warningOpen} aria-controls="refresh-warning-details" aria-label={`${warningDetails.length} refresh warning${warningDetails.length === 1 ? "" : "s"}. Technical warning details.`} onFocus={() => setWarningOpen(true)} onClick={() => setWarningOpen(true)}>
            <TriangleAlert size={16} />
          </button>
          {warningOpen ? <div className="refresh-warning-panel" id="refresh-warning-details" role="dialog" aria-label="Refresh warning details">
            <strong>Technical warning details</strong>
            <ul>{warningDetails.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            <span>Copyable diagnostic context</span>
            <code>{diagnosticLog}</code>
          </div> : null}
        </div>
      ) : null}
      {collectors.length ? (
        <div className="refresh-breakdown" role="tooltip">
          {/* This hover panel reports background reconciliation. It is
              diagnostic only; page data can also come directly from a current
              provider generation. */}
          <header>
            <strong>Reconciliation status</strong>
            <span>{collectorStatus?.intervalMs ? `Reconciliation every ${Math.round(toNumber(collectorStatus.intervalMs) / 1000)}s` : "Reconciliation schedule"}</span>
          </header>
          <div className="refresh-breakdown-list">
            {collectors.map(([key, collector]) => (
              <div className="refresh-breakdown-row" key={key}>
                <span className={`collector-dot ${collector.running ? "is-running" : collector.lastError ? "is-error" : collector.lastSuccessAt ? "is-ok" : ""}`} />
                <span>
                  <strong>{collector.label ?? key}</strong>
                  <small>{collectorDetail(collector)}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ApiErrorState({ message }: { message: string }) {
  return (
    <section className="api-error-state">
      <AsyncState
        kind="error"
        title="Unable to refresh live game data"
        detail="The data provider may be having a temporary issue. The app will recover automatically when the next refresh succeeds."
        action={<details>
          <summary>Technical detail</summary>
          <code>{message}</code>
        </details>}
      />
    </section>
  );
}
