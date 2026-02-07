import { MODULE_ID } from "./constants.mjs";

const SETTINGS = [
    {
        key: "damageChat",
        name: "SAVE_TRAY_5E.Settings.damageChat.name",
        hint: "SAVE_TRAY_5E.Settings.damageChat.hint",
        requiresReload: true,
    },
];

const { BooleanField, NumberField } = foundry.data.fields;

/**
 * Registers all settings defined in SETTINGS array.
 */
export function initSettings() {
    SETTINGS.forEach(({ key, name, hint, requiresReload }) => {
        game.settings.register(MODULE_ID, key, {
            name,
            hint,
            requiresReload,
            scope: "world",
            config: true,
            type: new BooleanField({ initial: false }),
        });
    });
}

