import { MODULE_ID, SAVE_TRAY_FLAG } from "../config.mjs";
import { initQueries, getSaveTrayData, initializeSaveTrayMessage, recordSaveResult } from "./flag.mjs";
import { renderSaveTray } from "../applications/save-tray.mjs";
import { activateDamageMultiplierPreset } from "./interactions.mjs";

const CHAT_MESSAGE_SELECTOR = ".message[data-message-id]";
const REFRESH_SELECTED_SAVE_TRAYS = foundry.utils.debounce(() => {
  refreshRenderedSaveTrays(ui.chat?.element, { selectedOnly: true });
}, 50);

/**
 * Initialize the save tray module.
 *
 * @returns {void}
 */
export function initTray() {
  initQueries();
}

/**
 * Register the chat-related hooks used by the save tray.
 *
 * @returns {void}
 */
export function readySaveTray() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("dnd5e.rollSavingThrow", onRollSavingThrow);
  Hooks.on("controlToken", onControlToken);
  Hooks.on("updateChatMessage", onUpdateChatMessage);
  Hooks.on("dnd5e.renderChatMessage", renderSaveTray);
  Hooks.on("dnd5e.renderChatMessage", activateDamageMultiplierPreset);
  refreshRenderedSaveTrays(ui.chat?.element);
}

/**
 * Persist save metadata when a save activity is used.
 *
 * @function dnd5e.postUseActivity
 * @memberof hookEvents
 * @param {Activity} activity                     Activity being used.
 * @param {ActivityUseConfiguration} usageConfig  Configuration info for the activation.
 * @param {ActivityUsageResults} results          Final details on the activation.
 * @returns {Promise<void>}
 */
async function onPostUseActivity(activity, _usageConfig, results) {
  if (activity?.type !== "save") return;

  const srcMsg = results?.message ?? null;
  if (!srcMsg) return;

  const dc = activity?.save?.dc?.value ?? null;
  const abilities = Array.from(activity?.save?.ability ?? []);

  if (activity?.target?.template?.type) {
    await srcMsg.update({ "flags.dnd5e.targets": game.dnd5e.utils.getTargetDescriptors() });
  }

  await initializeSaveTrayMessage(srcMsg, { dc, abilities });
}

/**
 * Attach a save result to its originating tray message after the save is rolled.
 *
 * @function dnd5e.rollSavingThrow
 * @memberof hookEvents
 * @param {D20Roll[]} rolls       The resulting rolls.
 * @param {object} data           Roll metadata.
 * @param {string} data.ability   ID of the ability that was rolled as defined in CONFIG.DND5E.abilities.
 * @param {Actor5e} data.subject  Actor for which the saving throw has been rolled.
 * @returns {Promise<void>}
 */
async function onRollSavingThrow(rolls, data) {
  const roll = rolls?.[0];
  if (!roll?._evaluated) return;

  const rollMsg = roll.parent;
  if (!rollMsg) return;

  const srcMsg = rollMsg.getOriginatingMessage?.() ?? rollMsg;
  if (!srcMsg) return;
  if (srcMsg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) === undefined) return;

  const actor = data?.subject;
  if (!actor) return;

  const total = Number.isFinite(roll.total) ? roll.total : null;
  if (total === null) return;

  const dc = Number.isFinite(roll.options?.target) ? Number(roll.options.target) : null;
  const ability = typeof data?.ability === "string" ? data.ability : null;

  const success =
    typeof roll.isSuccess === "boolean" ? roll.isSuccess :
      Number.isFinite(dc) ? total >= dc :
        null;

  await recordSaveResult(srcMsg, actor, {
    ability,
    dc,
    total,
    success
  });
}

/**
 * Refresh rendered save trays when the live selected token state changes.
 *
 * @returns {void}
 */
function onControlToken() {
  if (!game.user.isGM) return;
  const html = ui.chat?.element;
  const hasSelectedTray = html?.querySelector?.(
    '.save-tray-5e .target-source-control [data-mode="selected"][aria-pressed="true"]'
  );
  if (!hasSelectedTray) return;
  REFRESH_SELECTED_SAVE_TRAYS();
}

/**
 * Refresh an already-rendered chat message when relevant save tray inputs change.
 *
 * Template-based save activities first render the chat message before the final
 * target snapshot is known. When either the dnd5e target flags or the module's
 * save tray flag updates later, rebuild the tray for the existing DOM node.
 *
 * @param {ChatMessage5e} message The updated chat message.
 * @param {object} changed The changed document data.
 * @returns {void}
 */
function onUpdateChatMessage(message, changed) {
  const changedTargets = foundry.utils.hasProperty(changed, "flags.dnd5e.targets");
  const changedSaveTray = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${SAVE_TRAY_FLAG}`);
  if (!changedTargets && !changedSaveTray) return;

  const node = ui.chat?.element?.querySelector?.(`${CHAT_MESSAGE_SELECTOR}[data-message-id="${message.id}"]`);
  if (!node) return;

  renderSaveTray(message, node);
  activateDamageMultiplierPreset(message, node);
}

/**
 * Refresh save trays already present in the current chat log DOM.
 *
 * @param {HTMLElement|null|undefined} html The chat log root element.
 * @param {object} [options={}] Refresh options.
 * @param {boolean} [options.selectedOnly=false] Only refresh trays that currently show selected targets.
 * @returns {void}
 */
function refreshRenderedSaveTrays(html, { selectedOnly = false } = {}) {
  const nodes = html?.querySelectorAll?.(CHAT_MESSAGE_SELECTOR);
  if (!nodes?.length) return;

  for (const node of nodes) {
    const msgId = node.dataset.messageId;
    const msg = game.messages?.get?.(msgId);
    if (!msg) continue;

    if (msg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) === undefined) continue;

    if (selectedOnly) {
      if(!game.user.isGM) continue
      const tray = node.querySelector(".save-tray-5e");
      if (!tray) continue;

      const controls = tray.querySelector(".target-source-control");
      if (controls && !controls.hidden) {
        const selectedPressed =
          controls.querySelector('[data-mode="selected"]')?.getAttribute("aria-pressed") === "true";
        if (!selectedPressed) continue;
      }
    }

    renderSaveTray(msg, node);
  }
}
