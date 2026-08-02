import React from "react";
import { AlertTriangle, Clock3, Inbox, LoaderCircle, LockKeyhole, SearchX } from "lucide-react";

export type AsyncStateKind = "loading" | "empty" | "no-match" | "restricted" | "stale" | "warning" | "error";

export type AsyncStateProps = {
  kind: AsyncStateKind;
  title: string;
  detail?: string;
  action?: React.ReactNode;
  compact?: boolean;
};

const ICONS: Record<AsyncStateKind, React.ReactNode> = {
  loading: <LoaderCircle className="spin" aria-hidden="true" />,
  empty: <Inbox aria-hidden="true" />,
  "no-match": <SearchX aria-hidden="true" />,
  restricted: <LockKeyhole aria-hidden="true" />,
  stale: <Clock3 aria-hidden="true" />,
  warning: <AlertTriangle aria-hidden="true" />,
  error: <AlertTriangle aria-hidden="true" />,
};

export function AsyncState({ kind, title, detail, action, compact = false }: AsyncStateProps) {
  const role = kind === "error" ? "alert" : "status";
  return (
    <section
      className={`async-state empty-state ${kind === "error" ? "error-card" : ""} async-state-${kind}${compact ? " compact" : ""}`}
      role={role}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={kind === "loading" || undefined}
    >
      <span className="async-state-icon">{ICONS[kind]}</span>
      <span className="async-state-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {action ? <span className="async-state-action">{action}</span> : null}
    </section>
  );
}
