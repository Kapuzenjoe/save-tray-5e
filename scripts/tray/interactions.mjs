import { MODULE_ID } from "../config.mjs";
import { getSaveTrayData } from "./flag.mjs";

const DAMAGE_PRESET_STATES = new WeakMap();

/**
 * Attach dnd5e target interactions to save tray entries.
 *
 * @param {ChatMessage5e} message The chat message whose handlers should be reused.
 * @param {HTMLElement} html The tray container element.
 * @returns {void}
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
 * @param {ChatMessage5e} message The chat message that owns the tray.
 * @param {HTMLElement} html The tray container element.
 * @returns {void}
 */
export function activateSaveRollButtons(message, html) {
    html.querySelectorAll("button.save-tray-5e-roll").forEach(btn => {
        btn.addEventListener("click", ev => {
            ev.preventDefault();
            ev.stopPropagation();

            const uuid = btn.dataset.saveUuid;
            const ability = btn.dataset.saveAbility;
            if (!uuid) return;
            if (!ability) return;
            void rollSaveFromTray(message, uuid, ability, ev)
                .catch(err => console.warn(`[${MODULE_ID}] rollSaveFromTray failed`, err));
        });
    });
}

/**
 * Trigger a configured saving throw roll from the tray.
 *
 * @param {ChatMessage5e} message The source chat message.
 * @param {string} actorUuid The actor UUID to roll for.
 * @param {string} ability The save ability to roll.
 * @param {Event} event The triggering UI event.
 * @returns {Promise<void>}
 */
async function rollSaveFromTray(message, actorUuid, ability, event) {
    const data = getSaveTrayData(message);
    if (!data.save.abilities.includes(ability)) return;

    const actor = await fromUuid(actorUuid);
    if (typeof actor?.rollSavingThrow !== "function") return;
    const token = actor?.token?.object ?? actor?.getActiveTokens?.()[0] ?? null;
    const speaker = token
        ? ChatMessage.getSpeaker({ actor, scene: canvas.scene, token: token.document })
        : ChatMessage.getSpeaker({ actor });

    await actor.rollSavingThrow({
        ability,
        target: Number.isFinite(data.save.dc) ? data.save.dc : undefined,
        event
    }, {}, {
        data: {
            speaker
        }
    });
}

/**
 * Preset damage multipliers for save successes in the damage application UI.
 * Resolves save data from the originating message (if present).
 *
 * @param {ChatMessage5e} message The damage roll chat message being rendered.
 * @param {HTMLElement} html The rendered chat message element.
 * @returns {void}
 */
export function activateDamageMultiplierPreset(message, html) {
    if (!game.settings.get(MODULE_ID, "damageChat")) return;

    const app = html.querySelector("damage-application");
    if (!app) return;

    const sourceMessage = message.getOriginatingMessage?.() ?? message;
    const data = getSaveTrayData(sourceMessage);

    const damageOnSave = message.getFlag?.("dnd5e", "roll.damageOnSave");
    const multiplierValue = damageOnSave === "none" ? "0" : damageOnSave === "half" ? "0.5" : null;
    if (!multiplierValue) return;

    const successUuids = new Set(
        data.recorded
            .filter(result => result?.success === true && typeof result?.actor === "string")
            .map(result => result.actor)
    );
    if (!successUuids.size) return;

    const getTargetingMode = () => {
        const control = app.querySelector(".target-source-control");
        if (!control || control.hidden) return "selected";
        return control.querySelector('[aria-pressed="true"]')?.dataset.mode ?? "targeted";
    };

    const getRows = () => Array.from(app.querySelectorAll('li.target[data-target-uuid]'));

    const applyPresetToRows = (rows) => {
        for (const row of rows) {
            const actorUuid = row.dataset.targetUuid;
            if (!actorUuid || !successUuids.has(actorUuid)) continue;

            const button = row.querySelector(`button.multiplier-button[value="${multiplierValue}"]`);
            if (!button) continue;
            if (button.getAttribute("aria-pressed") === "true") continue;

            button.click();
        }
    };

    let state = DAMAGE_PRESET_STATES.get(app);
    if (!state) {
        state = {
            lastMode: null,
            observerAttached: false,
            selectedVisible: new Set(),
            targetedInitialized: false
        };
        DAMAGE_PRESET_STATES.set(app, state);
    }

    const sync = () => {
        const rows = getRows();

        const mode = getTargetingMode();
        if (mode !== state.lastMode) {
            if (mode === "selected") state.selectedVisible = new Set();
            state.lastMode = mode;
        }

        if (mode === "targeted") {
            if (!rows.length) return;
            if (state.targetedInitialized) return;
            applyPresetToRows(rows);
            state.targetedInitialized = true;
            return;
        }

        if (!rows.length) return;

        const currentVisible = new Set(rows.map(row => row.dataset.targetUuid).filter(uuid => !!uuid));
        const newlyVisibleRows = rows.filter(row => !state.selectedVisible.has(row.dataset.targetUuid));
        applyPresetToRows(newlyVisibleRows);
        state.selectedVisible = currentVisible;
    };

    if (!state.observerAttached) {
        const observer = new MutationObserver(sync);
        observer.observe(app, { childList: true, subtree: true });
        state.observerAttached = true;
    }

    sync();
}
