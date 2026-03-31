import { initSettings } from "./settings.mjs"
import { initQueries } from "./queries.mjs";
import { readySaveTray } from "./message-handler.mjs"

Hooks.once("init", () => {
  initSettings();
  initQueries();
});

Hooks.once("ready", () => {
  readySaveTray();
});