import React from "react";
import App from "./App";

async function mountApp(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_REACT_DEVTOOLS === "1") {
    try {
      const [{ scan }] = await Promise.all([import("react-scan"), import("react-grab")]);
      scan({ enabled: true });
    } catch (error: unknown) {
      console.warn("Queuest development tools could not start", error);
    }
  }

  const root = document.getElementById("root");
  if (!root) throw new Error("Queuest root element is missing");
  const { createRoot } = await import("react-dom/client");
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void mountApp();
