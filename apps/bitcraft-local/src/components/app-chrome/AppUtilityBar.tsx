import React from "react";

import type { AppUtilityBarProps } from "./types";

export function AppUtilityBar({ contextLabel, pageLabel, command, actions }: AppUtilityBarProps) {
  const CommandIcon = command.icon;
  return (
    <div className="app-utility-bar" aria-label="Application tools" data-tour="floating-actions">
      <div className="app-utility-context">
        <span>{contextLabel}</span>
        <strong>{pageLabel}</strong>
      </div>
      <button className="app-utility-command" type="button" onClick={command.onActivate} aria-label={command.ariaLabel} title={command.ariaLabel}>
        <CommandIcon size={15} />
        <span>{command.label}</span>
        {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
      </button>
      <div className="app-utility-actions">
        {actions.map((action) => {
          const Icon = action.icon;
          const className = [action.className, action.active ? "active" : ""].filter(Boolean).join(" ");
          const contents = <>{action.content ? <span className="refresh-cooldown-countdown" aria-hidden="true">{action.content}</span> : <Icon size={16} />}{action.badge ? <b>{action.badge}</b> : null}</>;
          return action.href ? (
            <a key={action.id} className={className || undefined} href={action.href} aria-label={action.label} title={action.label} aria-disabled={action.disabled || undefined} onClick={action.onActivate as React.MouseEventHandler<HTMLAnchorElement> | undefined}>{contents}</a>
          ) : (
            <button key={action.id} className={className || undefined} type="button" aria-label={action.label} title={action.label} aria-busy={action.busy || undefined} aria-disabled={action.disabled || undefined} disabled={action.disabled} onClick={action.onActivate as React.MouseEventHandler<HTMLButtonElement> | undefined}>{contents}</button>
          );
        })}
      </div>
    </div>
  );
}
