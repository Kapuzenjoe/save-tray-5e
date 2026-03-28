import { MODULE_ID, SAVE_TRAY_FLAG } from "./constants.mjs";
import {
  attachSaveParticipantsToMessage,
  activateInteractions,
  activateSaveRollButtons,
  activateDamageTargetSync,
  activateDamageMultiplierPreset,
  clearParticipantsFromMessage,
  activateDeleteParticipantFromMessage
} from "./message-helper.mjs";

/**
 * Register the chat-related hooks used by the save tray.
 *
 * @returns {void}
 */
export function readySaveTray() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("dnd5e.rollSavingThrow", onRollSavingThrow);
  // Usage messages rendered through system.getHTML still bypass dnd5e.renderChatMessage in dnd5e 5.3.x.
  if (!foundry.utils.isNewerVersion("5.3.0", game.system.version)) {
    Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  }
  else {
    Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
  }
  Hooks.on("dnd5e.renderChatMessage", activateDamageMultiplierPreset);
  refreshExistingSaveTrays(ui.chat?.element);
  console.log(`[${MODULE_ID}] is ready`)
}

/**
 * Register initialization-time hooks used by the save tray.
 *
 * @returns {void}
 */
export function initSaveTray() {
  Hooks.on("getChatMessageContextOptions", onGetChatMessageContextOptions);
}

/**
 * Attach save tray participants when a save activity is used.
 *
 * @function dnd5e.postUseActivity
 * @memberof hookEvents
 * @param {Activity} activity                     Activity being used.
 * @param {ActivityUseConfiguration} usageConfig  Configuration info for the activation.
 * @param {ActivityUsageResults} results          Final details on the activation.
 * @returns {Promise<void>}
 */
async function onPostUseActivity(activity, usageConfig, results) {
  if (activity?.type !== "save") return;

  const srcMsg = results?.message ?? null;
  if (!srcMsg) return;

  const targets = Array.from(game.user?.targets ?? []);
  if (!targets.length) return;

  const dc = activity?.save?.dc?.value ?? null;
  const ability = activity?.save?.ability?.first?.() ?? null;

  await attachSaveParticipantsToMessage(srcMsg, targets, { dc, ability });
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

  const srcMsg =
    rollMsg.getOriginatingMessage?.()
    ?? game.messages?.get?.(rollMsg.getFlag?.("dnd5e", "originatingMessage"));
  if (!srcMsg) return;

  const actor = data?.subject;
  if (!actor) return;

  const token = actor?.token?.object ?? actor?.getActiveTokens?.()[0] ?? null;
  if (!token) return;

  const total = Number.isFinite(roll.total) ? roll.total : null;
  if (total === null) return;

  const dc = Number.isFinite(roll.options?.target) ? Number(roll.options.target) : null;
  const ability = typeof data?.ability === "string" ? data.ability : null;

  const success =
    typeof roll.isSuccess === "boolean" ? roll.isSuccess :
      Number.isFinite(dc) ? total >= dc :
        null;

  await attachSaveParticipantsToMessage(srcMsg, [token], { dc, ability, total, success });
}



/**
 * Render or refresh the save tray on a chat message.
 *
 * @param {ChatMessage5e} message   Chat message being rendered.
 * @param {HTMLElement} html        HTML contents of the message.
 * @returns {void}
 */
function onRenderChatMessage(message, html) {
  const content = html?.querySelector?.(".message-content");
  if (!content) return;

  const data = message?.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
  if (!data?.participants?.length) {
    content.querySelectorAll(".save-tray-5e").forEach(el => el.remove());
    return;
  }

  const buildTray = () => {
    const tray = document.createElement("div");
    tray.classList.add("save-tray-5e", "card-tray", "collapsible");

    const label = document.createElement("label");
    label.classList.add("roboto-upper");
    label.innerHTML = `
      <i class="fa-solid fa-shield-heart" inert></i>
      <span>${game.i18n.localize("DND5E.SavingThrow")}</span>
      <i class="fas fa-caret-down" inert></i>
    `;

    const body = document.createElement("div");
    body.classList.add("collapsible-content");

    const ul = document.createElement("ul");
    ul.classList.add("unlist", "evaluation", "wrapper");

    for (const p of data.participants) {
      const li = document.createElement("li");
      li.classList.add("target");
      li.dataset.saveUuid = p.uuid ?? "";

      const hasResult = Number.isFinite(p.total);

      const icon =
        hasResult ? (p.success === true ? "fa-check" : p.success === false ? "fa-times" : "fa-minus") : "fa-minus";

      const iconClass =
        hasResult && p.success === true ? "save-tray-5e-success" :
          hasResult && p.success === false ? "save-tray-5e-failure" :
            "";

      const actor = fromUuidSync(p.uuid);
      const canDelete = game.user.isGM || message.isOwner;;
      const canRoll = game.user.isGM || actor?.isOwner;

      li.innerHTML = canDelete
        ? `
          <button type="button" class="save-tray-5e-delete" data-save-uuid="${p.uuid}">
            <i class="fas fa-trash" inert></i>
          </button>
          <i class="fas ${icon} ${iconClass}" inert></i>
          <div class="name"></div>
          <div class="ac">${hasResult ? p.total : ""}</div>
        `
        : `
          <i class="fas ${icon} ${iconClass}" inert></i>
          <div class="name"></div>
          <div class="ac"></div>
        `;

      const isHideNPCNamesActive = game.modules?.get?.("hide-npc-names")?.active === true;
      const actorName = isHideNPCNamesActive && game?.hnn ? game.hnn.getReplacementInfo(actor).displayName : p.name;
      li.querySelector(".name").textContent = actorName ?? game.i18n.localize("DND5E.Unknown");

      const right = li.querySelector(".ac");
      if (hasResult) {
        right.innerHTML = ` <i class="fa-solid fa-shield-heart" inert></i> <span>${p.total}</span>`;
      } else {
        right.innerHTML = canRoll
          ? `
            <button type="button" class="save-tray-5e-roll" data-save-uuid="${p.uuid}">
              <i class="fas fa-dice-d20" inert></i>
            </button>
          `
          : "";
      }

      ul.appendChild(li);
    }

    body.appendChild(ul);
    tray.appendChild(label);
    tray.appendChild(body);

    return { tray, ul };
  };

  const applyTray = () => {
    content.querySelectorAll(".save-tray-5e").forEach(el => el.remove());
    const { tray, ul } = buildTray();

    if (message?.type === "usage") {
      const wrapper = content.querySelector(":scope > div");
      if (!wrapper || wrapper.classList.contains("chat-card")) return false;

      wrapper.appendChild(tray);
    }
    else {
      content.appendChild(tray);
    }

    activateInteractions(message, ul);
    activateSaveRollButtons(message, ul);
    activateDeleteParticipantFromMessage(message, ul);
    activateDamageTargetSync(message, content);
    return true;
  }

  if (applyTray()) return;

  const observer = new MutationObserver(() => {
    if (applyTray()) observer.disconnect();
  });

  observer.observe(content, { childList: true, subtree: true });
}

/**
 * Add save tray context options to chat messages.
 *
 * @function getChatMessageContextOptions
 * @memberof hookEvents
 * @param {HTMLElement} html    The chat message being rendered.
 * @param {object[]} options    The array of context menu options.
 *
 * @returns {object[]}          The extended context menu options.
 */
function onGetChatMessageContextOptions(html, options) {
  options.push({
    name: "Save Tray: Clear all targets",
    icon: '<i class="fas fa-trash"></i>',
    condition: (li) => {
      const msg = game.messages.get(li.dataset.messageId)
      if (!msg) return false;
      const canEdit = game.user.isGM || msg.isOwner;
      if (!canEdit) return false;
      const data = msg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
      return Boolean(data?.participants?.length);
    },
    callback: (li) => {
      const msg = game.messages.get(li.dataset.messageId)
      if (!msg) return;
      clearParticipantsFromMessage(msg);
    }
  });
  return options;
}

/**
 * Refresh all save trays already present in the current chat log DOM.
 *
 * @param {HTMLElement|null|undefined} html  The chat log root element.
 * @returns {void}
 */
function refreshExistingSaveTrays(html) {
  const nodes = html?.querySelectorAll?.("li.chat-message[data-message-id]");
  if (!nodes?.length) return;

  for (const node of nodes) {
    const msgId = node.dataset.messageId;
    const msg = game.messages?.get?.(msgId);

    const data = msg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
    if (!data?.participants?.length) continue;

    onRenderChatMessage(msg, node);
  }
}
