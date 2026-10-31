import "./styles.css";
import { hydrateRoot } from "react-dom/client";
import { App, type AppState } from "./app";

const root = document.getElementById("root");
const data = document.getElementById("__props");
if (root && data?.textContent) {
  const state = JSON.parse(data.textContent) as AppState;
  hydrateRoot(root, <App state={state} />);
}
