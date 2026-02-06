import { MODULE_ID } from "./constants.mjs";

/**
 * Register module-specific GM query handlers.
 *
 * @returns {void}
 */
export function initQueries() {
    CONFIG.queries ??= {};

    CONFIG.queries[`${MODULE_ID}.setFlag`] = async (data) => {
        try {
            if (!game.user.isGM) return { ok: false, reason: "not-gm" };

            const { uuid, scope, key, value } = data ?? {};
            if (!uuid || typeof scope !== "string" || typeof key !== "string") {
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
 * Set a document flag via active GM query.
 *
 * @param {string} uuid      The UUID of the Document
 * @param {string} scope     The flag scope
 * @param {string} key       The flag key
 * @param {any} value        The flag value to set.
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
