import React from "react";
import { createRoot } from "react-dom/client";
import TimbersteelRoot from "./TimbersteelRoot";
import "./styles.css";
import "./styles/app-chrome.css";

createRoot(document.getElementById("root")!).render(<TimbersteelRoot />);
