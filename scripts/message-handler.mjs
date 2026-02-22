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
 * Register hooks.
 */
export function readySaveTray() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("dnd5e.rollSavingThrow", onRollSavingThrow);
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

export function initSaveTray() {
  Hooks.on("getChatMessageContextOptions", onGetChatMessageContextOptions);
}

/**
 * Fires when an activity is activated.
 * 
 * @param {Activity} activity                     Activity being used.
 * @param {ActivityUseConfiguration} usageConfig  Configuration info for the activation.
 * @param {ActivityUsageResults} results          Final details on the activation.
 */
async function onPostUseActivity(activity, usageConfig, results) {
  if (activity?.type !== "save") return;

  const srcMsg = results?.message ?? null;
  if (!srcMsg) return;

  const targets = Array.from(game.user?.targets ?? []);
  if (!targets.length) return;

  const dc = activity?.save?.dc?.value ?? null;
  const ability = activity?.save?.ability ? [...activity.save.ability][0] : null;

  await attachSaveParticipantsToMessage(srcMsg, targets, { dc, ability });
}

/**
 * A hook event that fires after a save has been rolled.	
 * 
 * @param {D20Roll[]} rolls       The resulting rolls.
 * @param {object} data
 * @param {string} data.ability   ID of the ability that was rolled as defined in CONFIG.DND5E.abilities.
 * @param {Actor5e} data.subject  Actor for which the hit die has been rolled.
 */
async function onRollSavingThrow(rolls, data) {
  const roll = rolls?.[0];
  if (!roll?._evaluated) return;

  const rollMsg = roll.parent;
  if (!rollMsg) return;

  const srcMessageId =
    rollMsg.getFlag?.("dnd5e", "originatingMessage");

  if (!srcMessageId) return;

  const srcMsg = game.messages?.get?.(srcMessageId);
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
 * Fires after dnd5e-specific chat message modifications have completed.
 * 
 * @param {ChatMessage5e} message   Chat message being rendered.
 * @param {HTMLElement} html        HTML contents of the message
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

      li.querySelector(".name").textContent = p.name ?? game.i18n.localize("DND5E.Unknown");

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
 * This function is used to hook into the Chat Log context menu to add additional options to each message
 *
 * @param {HTMLElement} html    The Chat Message being rendered
 * @param {object[]} options    The Array of Context Menu options
 *
 * @returns {object[]}          The extended options Array including new context choices
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
}

/**
 * Refresh all existing save trays in current Chat Log DOM. 
 * 
 * @param {HTMLElement} html 
 * @returns 
 */
function refreshExistingSaveTrays(html) {
  const nodes = html.querySelectorAll?.("li.chat-message[data-message-id]");
  if (!nodes?.length) return;

  for (const node of nodes) {
    const msgId = node.dataset.messageId;
    const msg = game.messages?.get?.(msgId);

    const data = msg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
    if (!data?.participants?.length) continue;

    onRenderChatMessage(msg, node);
  }
}