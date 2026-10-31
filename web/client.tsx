import "./styles.css";
import type { ComponentType } from "react";
import { hydrateRoot } from "react-dom/client";
import type { AppState } from "./app";

/**
 * Hydrates the server-rendered page. Each entry in web/entries passes only the
 * views it serves, so a page downloads just its own code.
 */
export function hydrate(views: Partial<Record<AppState["view"], ComponentType<any>>>) {
  const root = document.getElementById("root");
  const data = document.getElementById("__props");
  if (!root || !data?.textContent) return;
  const state = JSON.parse(data.textContent) as AppState;
  const Page = views[state.view];
  if (Page) hydrateRoot(root, <Page {...state.props} />);
}
