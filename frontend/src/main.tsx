import { App } from "@/App";
import "@/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento raiz #root não encontrado.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
