import { initQueries } from "./queries.mjs";
import { initSaveTray } from "./message-handler.mjs"

Hooks.once("init", () => {
  initQueries();
  initSaveTray();
});