import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route } from "../../src/routes/tv";
import { reset, complete, update, remove } from "./data";
import "../../src/styles.css";
Object.assign(window, { motionFixture: { reset, complete, update, remove } });
const Page = Route.component;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
