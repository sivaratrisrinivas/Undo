import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createFakeAdapters } from "./adapters/fake-adapters";
import { App } from "./App";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App adapters={createFakeAdapters()} />
  </StrictMode>,
);
