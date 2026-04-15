import { MODULE_ID, SAVE_TRAY_FLAG, SAVE_TRAY_VERSION } from "./constants.mjs";
import { setFlagViaGM } from "./queries.mjs";

const DAMAGE_PRESET_STATES = new WeakMap();

/**
 * Normalize save tray ability data.
 *
 * @param {Iterable<string>|string|null|undefined} abilities Ability identifiers to normalize.
 * @returns {string[]} Normalized ability identifiers.
 */
function normalizeAbilities(abilities) {
    if (!abilities) return [];

    const source = typeof abilities === "string" ? [abilities] : Array.from(abilities);
    return Array.from(new Set(source.filter(ability => typeof ability === "string" && ability.length)));
}

/**
 * Normalize recorded save result data.
 *
 * @param {object|null|undefined} entry Recorded entry to normalize.
 * @returns {{actor: string|null, ability: string|null, success: boolean|null, total: number|null}} Normalized entry.
 */
function normalizeRecordedEntry(entry) {
    return {
        actor: typeof entry?.actor === "string" && entry.actor.length ? entry.actor : null,
        ability: typeof entry?.ability === "string" ? entry.ability : null,
        success: typeof entry?.success === "boolean" ? entry.success : null,
        total: Number.isFinite(entry?.total) ? Number(entry.total) : null
    };
}

/**
 * Merge a recorded entry into the list, keyed by actor UUID.
 *
 * @param {object[]} entries Existing recorded entries.
 * @param {{actor: string|null, ability: string|null, success: boolean|null, total: number|null}} entry Entry to merge.
 * @returns {void}
 */
function upsertRecordedEntry(entries, entry) {
    if (!entry?.actor) return;
    if (!Number.isFinite(entry?.total) && typeof entry?.success !== "boolean") return;

    const index = entries.findIndex(existing => existing.actor === entry.actor);
    if (index === -1) entries.push(entry);
    else entries[index] = entry;
}

/**
 * Build the persisted save tray flag payload.
 *
 * @param {{save: {abilities: string[], dc: number|null}, recorded: object[]}} existing Existing normalized state.
 * @param {object} [meta={}] Partial data to override.
 * @param {Iterable<string>|string|null} [meta.abilities] Allowed save abilities.
 * @param {number|null} [meta.dc] Save DC.
 * @param {object[]} [meta.recorded] Recorded save results.
 * @returns {{version: number, save: {abilities: string[], dc: number|null}, recorded: object[]}}
 */
function buildSaveTrayFlag(existing, meta = {}) {
    return {
        version: SAVE_TRAY_VERSION,
        save: {
            abilities: normalizeAbilities(meta.abilities ?? existing.save.abilities),
            dc: Number.isFinite(meta.dc) ? Number(meta.dc) : existing.save.dc
        },
        recorded: meta.recorded ?? existing.recorded
    };
}

/**
 * Get normalized save tray data from a chat message.
 *
 * @param {ChatMessage5e} message The chat message to inspect.
 * @returns {{version: number, save: {abilities: string[], dc: number|null}, recorded: object[]}}
 */
export function getSaveTrayData(message) {
    const raw = message?.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) ?? {};
    const recorded = [];

    for (const entry of Array.isArray(raw?.recorded) ? raw.recorded : []) {
        upsertRecordedEntry(recorded, normalizeRecordedEntry(entry));
    }

    const dc = raw?.save?.dc ?? null;
    return {
        version: SAVE_TRAY_VERSION,
        save: {
            abilities: normalizeAbilities(raw?.save?.abilities),
            dc: Number.isFinite(dc) ? Number(dc) : null
        },
        recorded
    };
}

/**
 * Persist the initial save tray metadata for a chat message.
 *
 * @param {ChatMessage5e} message The chat message to update.
 * @param {object} [meta={}] Additional save metadata to merge.
 * @param {number|null} [meta.dc=null] The save DC.
 * @param {Iterable<string>|string|null} [meta.abilities=null] Allowed save abilities.
 * @returns {Promise<boolean>} True if the flag was updated.
 */
export async function initializeSaveTrayMessage(message, meta = {}) {
    if (!message) return false;

    const existing = getSaveTrayData(message);
    const next = buildSaveTrayFlag(existing, {
        abilities: meta.abilities,
        dc: meta.dc
    });

    return setFlagViaGM(message.uuid, MODULE_ID, SAVE_TRAY_FLAG, next);
}

/**
 * Record the save result for a single actor on a chat message.
 *
 * @param {ChatMessage5e} message The chat message to update.
 * @param {Actor5e} actor The actor whose result should be stored.
 * @param {object} [meta={}] Additional save metadata to merge.
 * @param {string|null} [meta.ability=null] The ability identifier used for the roll.
 * @param {number|null} [meta.dc=null] The save DC.
 * @param {number|null} [meta.total=null] The rolled total.
 * @param {boolean|null} [meta.success=null] Whether the save succeeded.
 * @returns {Promise<boolean>} True if the flag was updated.
 */
export async function recordSaveResult(message, actor, meta = {}) {
    const uuid = actor?.uuid;
    if (!message || !uuid) return false;

    const existing = getSaveTrayData(message);
    const prior = existing.recorded.find(entry => entry.actor === uuid) ?? normalizeRecordedEntry({ actor: uuid });
    const abilities = normalizeAbilities([
        ...existing.save.abilities,
        typeof meta.ability === "string" ? meta.ability : null
    ]);
    const nextRecorded = existing.recorded.map(entry => ({ ...entry }));
    upsertRecordedEntry(nextRecorded, {
        actor: uuid,
        ability: typeof meta.ability === "string" ? meta.ability : prior.ability,
        success: typeof meta.success === "boolean" ? meta.success : prior.success,
        total: Number.isFinite(meta.total) ? Number(meta.total) : prior.total
    });

    const next = buildSaveTrayFlag(existing, {
        abilities,
        dc: meta.dc,
        recorded: nextRecorded
    });

    return setFlagViaGM(message.uuid, MODULE_ID, SAVE_TRAY_FLAG, next);
}

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
