/**
 * @typedef {object} TrayEntry
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 */

/**
 * @typedef {object} RecordedSaveResult
 * @property {string|null} actor
 * @property {string|null} ability
 * @property {boolean|null} success
 * @property {number|null} total
 */

/**
 * @typedef {object} SaveTrayData
 * @property {number} version
 * @property {{abilities: string[], dc: number|null}} save
 * @property {RecordedSaveResult[]} recorded
 */
