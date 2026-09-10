import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

if (import.meta.env.DEV && import.meta.env.VITE_DISABLE_REACT_DEVTOOLS !== "1") {
  void import("react-grab");
  void import("react-scan");
}

const root = document.getElementById("root");
if (!root) throw new Error("Queuest root element is missing");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
