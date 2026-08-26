import type React from "react";

export function AppFooter({ primary, secondary }: { primary: React.ReactNode; secondary: React.ReactNode }) {
  return <footer className="app-footer"><div className="footer-links"><div className="footer-primary">{primary}</div><div className="footer-secondary">{secondary}</div></div></footer>;
}
