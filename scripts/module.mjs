import { initSettings } from "./settings.mjs"
import { initTray, readySaveTray } from "./tray/hooks.mjs";
import { readyTemplateTargeting } from "./canvas/template-targeting.mjs";

Hooks.once("init", () => {
  initSettings();
  initTray();
});

Hooks.once("ready", () => {
  readySaveTray();
  readyTemplateTargeting();
});
