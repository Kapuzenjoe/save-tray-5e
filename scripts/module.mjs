import { initSettings } from "./settings.mjs"
import { initQueries } from "./queries.mjs";
import { initSaveTray, readySaveTray } from "./message-handler.mjs"

Hooks.once("init", () => {
  initSettings();
  initQueries();
  initSaveTray();
});

Hooks.once("ready", () => {
  readySaveTray();
});