import { MODULE_ID } from "./constants.mjs";

/**
 * Register all module settings.
 *
 * @returns {void}
 */
export function initSettings() {
    game.settings.register(MODULE_ID, "damageChat", {
        name: "SAVE_TRAY_5E.Settings.damageChat.name",
        hint: "SAVE_TRAY_5E.Settings.damageChat.hint",
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
    });

    game.settings.register(MODULE_ID, "autoTemplateTargeting", {
        name: "SAVE_TRAY_5E.Settings.autoTemplateTargeting.name",
        hint: "SAVE_TRAY_5E.Settings.autoTemplateTargeting.hint",
        scope: "world",
        config: (game.release?.generation ?? 0) === 14,
        type: Boolean,
        default: false,
    });
}
