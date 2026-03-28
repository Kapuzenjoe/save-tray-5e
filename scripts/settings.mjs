import { MODULE_ID } from "./constants.mjs";

const { BooleanField } = foundry.data.fields;

/**
 * Register all module settings.
 *
 * @returns {void}
 */
export function initSettings() {
    game.settings.register(MODULE_ID, "damageChat", {
        name: "SAVE_TRAY_5E.Settings.damageChat.name",
        hint: "SAVE_TRAY_5E.Settings.damageChat.hint",
        requiresReload: true,
        scope: "world",
        config: true,
        type: new BooleanField({ initial: false }),
    });
}
