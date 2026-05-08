import { MODULE_ID, SAVE_TRAY_FLAG, SAVE_TRAY_VERSION } from "../config.mjs";

/**
 * Register module-specific GM query handlers.
 *
 * @returns {void}
 */
export function initQueries() {
    CONFIG.queries ??= {};
    if (CONFIG.queries[`${MODULE_ID}.setFlag`]) return;

    /**
     * Handle the GM-side query used to set a document flag.
     *
     * @param {{uuid?: string, scope?: string, key?: string, value?: *}|null|undefined} data The query payload.
     * @returns {Promise<{ok: boolean, changed?: boolean, reason?: string}>} The query result.
     */
    CONFIG.queries[`${MODULE_ID}.setFlag`] = async (data) => {
        try {
            if (!game.user.isGM) return { ok: false, reason: "not-gm" };

            const { uuid, scope, key, value } = data ?? {};
            if (!uuid || scope !== MODULE_ID || key !== SAVE_TRAY_FLAG) {
                return { ok: false, reason: "bad-args" };
            }

            const doc = await fromUuid(uuid);
            if (!doc) return { ok: false, reason: "no-document" };

            if (typeof doc.setFlag !== "function" || typeof doc.getFlag !== "function") {
                return { ok: false, reason: "no-flag-api" };
            }

            await doc.setFlag(scope, key, value);
            return { ok: true, changed: true };
        } catch (err) {
            console.warn(`[${MODULE_ID}] query setFlag failed:`, err, data);
            return { ok: false, reason: "exception" };
        }
    };
}

/**
 * Resolve a document and attempt a local flag write when the current user can update it.
 *
 * @param {string} uuid The UUID of the document to update.
 * @param {string} scope The flag scope.
 * @param {string} key The flag key.
 * @param {*} value The flag value to set.
 * @returns {Promise<boolean|null>} True when updated locally, false on local failure, or null if local write is not allowed.
 */
async function setFlagLocally(uuid, scope, key, value) {
    const doc = await fromUuid(uuid);
    if (!doc) {
        console.warn(`[${MODULE_ID}] no document for uuid ${uuid}`);
        return false;
    }

    if (typeof doc.setFlag !== "function" || typeof doc.canUserModify !== "function") {
        return false;
    }

    if (!doc.canUserModify(game.user, "update")) return null;

    try {
        await doc.setFlag(scope, key, value);
        return true;
    } catch (err) {
        console.warn(`[${MODULE_ID}] local setFlag failed:`, err, { uuid, scope, key });
        return false;
    }
}

/**
 * Request the active GM to set a document flag.
 *
 * @param {string} uuid The UUID of the document to update.
 * @param {string} scope The flag scope.
 * @param {string} key The flag key.
 * @param {*} value The flag value to set.
 * @returns {Promise<boolean>} True if the flag was set successfully.
 */
export async function setFlagViaGM(uuid, scope, key, value) {
    const local = await setFlagLocally(uuid, scope, key, value);
    if (local === true) return true;

    const gm = game.users.activeGM;
    if (!gm) {
        console.warn(`[${MODULE_ID}] no active GM for flag write`, { uuid, scope, key });
        return false;
    }

    try {
        const res = await gm.query(
            `${MODULE_ID}.setFlag`,
            { uuid, scope, key, value },
            { timeout: 8000 }
        );
        return !!res?.ok;
    } catch (e) {
        console.warn(`[${MODULE_ID}] GM query failed:`, e);
        return false;
    }
}

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
