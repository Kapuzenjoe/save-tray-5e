import { initSettings } from "./settings.mjs"
import { initQueries } from "./queries.mjs";
import { initSaveTray } from "./message-handler.mjs"

Hooks.once("init", () => {
  initSettings();
  initQueries();
  initSaveTray();
});