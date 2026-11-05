// Browser-only visual harness: the production route components and hooks are unchanged.
// Playwright fulfills data requests with synthetic fixtures; no production writes occur.
import React from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { Route as Terminal } from "../../src/routes/tv";
import { Route as Daily } from "../../src/routes/diaria";
import "../../src/styles.css";
const root = createRootRoute({ component: Outlet });
const router = createRouter({
  routeTree: root.addChildren([
    createRoute({ getParentRoute: () => root, path: "/tv", component: Terminal.options.component }),
    createRoute({
      getParentRoute: () => root,
      path: "/diaria",
      component: Daily.options.component,
    }),
  ]),
});
createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
