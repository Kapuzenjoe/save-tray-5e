import { MODULE_ID, SAVE_TRAY_FLAG } from "./constants.mjs";

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

            const current = doc.getFlag(scope, key);
            if (foundry.utils.deepEqual(current, value)) {
                return { ok: true, changed: false };
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
 * Request the active GM to set a document flag.
 *
 * @param {string} uuid The UUID of the document to update.
 * @param {string} scope The flag scope.
 * @param {string} key The flag key.
 * @param {*} value The flag value to set.
 * @returns {Promise<boolean>} True if the flag was set successfully.
 */
export async function setFlagViaGM(uuid, scope, key, value) {
    const gm = game.users.activeGM;
    if (!gm) {
        console.warn(`[${MODULE_ID}] no active GM`);
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
