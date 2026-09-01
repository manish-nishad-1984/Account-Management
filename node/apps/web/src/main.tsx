import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "./index.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
