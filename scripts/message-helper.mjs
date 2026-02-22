import { MODULE_ID, SAVE_TRAY_FLAG } from "./constants.mjs";
import { setFlagViaGM } from "./queries.mjs";

/**
 * Attach (or merge) save participants onto a chat message.
 *
 * @param {ChatMessage5e} message
 * @param {Array<Token5e|TokenDocument>} targets
 * @param {object} [meta={}]
 * @param {number|null} [meta.dc=null]
 * @param {string|null} [meta.ability=null]
 * @param {number|null} [meta.total=null]
 * @param {boolean|null} [meta.success=null]
 */
export async function attachSaveParticipantsToMessage(message, targets, meta = {}) {
    if (!message || !Array.isArray(targets) || targets.length === 0) return null;

    const existing = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) ?? { version: 1, participants: [] };

    const participants = existing.participants ?? [];
    const participantsByUuid = new Map(participants.map(p => [p.uuid, p]));

    for (const target of targets) {
        const tokenDoc = target?.document ?? target;
        const actor = tokenDoc?.actor
        const uuid = actor?.uuid;
        if (!uuid) continue;

        const name = tokenDoc.name ?? actor.name;
        const prior = participantsByUuid.get(uuid);

        const total = Number.isFinite(meta.total)
            ? meta.total
            : Number.isFinite(prior?.total)
                ? prior.total
                : null;

        const success = typeof meta.success === "boolean"
            ? meta.success
            : typeof prior?.success === "boolean"
                ? prior.success
                : null;

        if (prior) {
            prior.name = name;
            prior.total = total;
            prior.success = success;
            continue;
        }

        participantsByUuid.set(uuid, { uuid, name, total, success });
    }

    const next = {
        version: 1,
        dc: meta.dc ?? existing.dc ?? null,
        ability: meta.ability ?? existing.ability ?? null,
        participants: Array.from(participantsByUuid.values())
    };

    await setFlagViaGM(message.uuid, MODULE_ID, SAVE_TRAY_FLAG, next);
}

/**
 * Attach dnd5e-style target interactions (click to control/pan, hover highlight) to tray entries.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
export function activateInteractions(message, html) {
    if (!message || !html) return;

    const hasHandlers =
        typeof message._onTargetMouseDown === "function" &&
        typeof message._onTargetHoverIn === "function" &&
        typeof message._onTargetHoverOut === "function";

    if (!hasHandlers) return;

    html.querySelectorAll("li.target[data-save-uuid]").forEach(li => {
        const withUuid = (handler) => (ev) => {
            const uuid = li.dataset.saveUuid;
            if (!uuid) return;

            li.dataset.uuid = uuid;
            handler(ev);
            delete li.dataset.uuid;
        };

        li.addEventListener("click", withUuid(message._onTargetMouseDown.bind(message)));
        li.addEventListener("pointerover", withUuid(message._onTargetHoverIn.bind(message)));
        li.addEventListener("pointerout", withUuid(message._onTargetHoverOut.bind(message)));
    });
}

/**
 * Activate roll buttons in the save tray.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
export function activateSaveRollButtons(message, html) {
    html.querySelectorAll("button.save-tray-5e-roll").forEach(btn => {
        btn.addEventListener("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();

            const uuid = btn.dataset.saveUuid;
            if (!uuid) return;
            void rollSaveFromTray(message, uuid, ev).catch(err => console.warn(`[${MODULE_ID}] rollSaveFromTray failed`, err));
        });
    });
}

/**
 * Trigger a configured saving throw roll from the tray.
 *
 * @param {ChatMessage5e} message
 * @param {string} actorUuid
 * @param {Event} event
 * @returns {Promise<void>}
 */
async function rollSaveFromTray(message, actorUuid, event) {
    const data = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
    const ability = data?.ability;
    if (!ability) return;

    const actor = await fromUuid(actorUuid);
    if (!actor?.rollSavingThrow) return;

    const config = {
        ability,
        target: Number.isFinite(data?.dc) ? data.dc : undefined,
        event,
    };

    const dialog = {};

    const messageData = {
        flags: {
            dnd5e: {
                originatingMessage: message.id,
            },
        },
    };

    await actor.rollSavingThrow(config, dialog, messageData);
}

/**
 * Ensure damage buttons on the originating chat message use save tray participants as user targets.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
export function activateDamageTargetSync(message, html) {
    if (!game.settings.get(MODULE_ID, "damageChat")) return;

    const buttons = html.querySelectorAll("button[data-action]");

    for (const btn of buttons) {
        const action = btn.dataset.action;
        if (action !== "rollDamage" && action !== "rollDamageCritical") continue;

        if (btn.dataset.saveTrayTargets === "1") continue;
        btn.dataset.saveTrayTargets = "1";

        btn.addEventListener(
            "click",
            () => {
                const data = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
                const participants = data?.participants ?? [];
                if (!participants.length) return;

                const actorUuids = new Set(participants.map(p => p.uuid));
                if (!actorUuids.size) return;

                const tokenIds = [];
                for (const token of canvas.tokens.placeables) {
                    const uuid = token.actor?.uuid;
                    if (uuid && actorUuids.has(uuid)) tokenIds.push(token.id);
                }
                if (tokenIds.length) canvas.tokens.setTargets(tokenIds, { mode: "replace" });
            },
            { capture: true }
        );
    }
}

/**
 * Preset damage multipliers for save successes in the damage application UI.
 * Resolves save data from the originating message (if present).
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
export function activateDamageMultiplierPreset(message, html) {
    if (!game.settings.get(MODULE_ID, "damageChat")) return;

    const app = html.querySelector("damage-application");
    if (!app) return;

    const originId = message.getFlag?.("dnd5e", "originatingMessage");
    const sourceMessage = originId ? game.messages?.get?.(originId) : message;

    const data = sourceMessage?.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
    if (!data?.participants?.length) return;

    const roll = message.getFlag?.("dnd5e", "roll") ?? {};
    const { damageOnSave } = roll;

    const multiplierValue = damageOnSave === "none" ? "0" : damageOnSave === "half" ? "0.5" : null;
    if (!multiplierValue) return;

    const successUuids = data.participants.filter(p => p.success === true).map(p => p.uuid);
    if (!successUuids.length) return;

    const applyPreset = () => {
        const rows = app.querySelectorAll('li.target[data-target-uuid]');
        if (!rows.length) return false;

        for (const row of rows) {
            const actorUuid = row.dataset.targetUuid;
            if (!actorUuid) continue;

            if (!actorUuid || !successUuids.includes(actorUuid)) continue;

            const button = row.querySelector(`button.multiplier-button[value="${multiplierValue}"]`);
            if (!button) continue;
            if (button.getAttribute("aria-pressed") === "true") continue;

            button.click();
        }

        return true;
    };

    if (applyPreset()) return;

    const observer = new MutationObserver(() => {
        if (applyPreset()) observer.disconnect();
    });

    observer.observe(app, { childList: true, subtree: true });
}

/**
 * Activate delete buttons in the save tray.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
export async function activateDeleteParticipantFromMessage(message, html) {
    html.querySelectorAll("button.save-tray-5e-delete").forEach(btn => {
        btn.addEventListener("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const existing = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
            if (!existing?.participants?.length) return;

            const uuid = btn.dataset.saveUuid;
            if (!uuid) return;

            const nextParticipants = existing.participants.filter(p => p.uuid !== uuid);
            const next = { ...existing, participants: nextParticipants };

            void setFlagViaGM(message.uuid, MODULE_ID, SAVE_TRAY_FLAG, next).catch(err => console.warn(`[${MODULE_ID}] delete participant failed`, err));
        });
    });
}

/**
 * Clear all participants from message
 * 
 * @param {ChatMessage5e} message 
 * @returns 
 */
export async function clearParticipantsFromMessage(message) {
    if (!message) return;

    const existing = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
    if (!existing?.participants?.length) return;

    const next = { ...existing, participants: [] };
    await setFlagViaGM(message.uuid, MODULE_ID, SAVE_TRAY_FLAG, next);
}