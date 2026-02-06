import { MODULE_ID, SAVE_TRAY_FLAG } from "./constants.mjs";
import { setFlagViaGM } from "./queries.mjs";

/**
 * Register hooks.
 */
export function initSaveTray() {
  Hooks.on("dnd5e.postUseActivity", onPostUseActivity);
  Hooks.on("dnd5e.rollSavingThrow", onRollSavingThrow);
  Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
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
  if (!targets) return;

  const dc = activity?.save?.dc?.value ?? 0
  const ability = [...activity?.save.ability][0] ?? null;

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
async function attachSaveParticipantsToMessage(message, targets, meta = {}) {
  if (!message || !Array.isArray(targets) || targets.length === 0) return null;

  const existing = message.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) ?? { version: 1, participants: [] };

  const participants = existing.participants ?? [];
  const participantsByUuid = new Map(participants.map(p => [p.uuid, p]));

  for (const target of targets) {
    const tokenDoc = target?.document ?? target;
    const actor = tokenDoc?.actor
    const uuid = actor?.uuid;
    if (!uuid) continue;

    const name = tokenDoc.name
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
 * Fires after dnd5e-specific chat message modifications have completed.
 * 
 * @param {ChatMessage5e} message   Chat message being rendered.
 * @param {HTMLElement} html        HTML contents of the message
 */
function onRenderChatMessage(message, html) {
  const data = message?.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
  if (!data?.participants?.length) return;

  const content = html?.querySelector?.(".message-content");
  if (!content) return;

  content.querySelectorAll(".save-tray-5e").forEach(el => el.remove());

  const tray = document.createElement("div");
  tray.classList.add("save-tray-5e", "card-tray", "collapsible");

  const label = document.createElement("label");
  label.classList.add("roboto-upper");
  label.innerHTML = `
    <i class="fas fa-shield-halved" inert></i>
    <span>Saving Throw</span>
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

    li.innerHTML = `
      <i class="fas ${icon} ${iconClass}" inert></i>
      <div class="name"></div>
      <div class="ac">${hasResult ? p.total : ""}</div>
    `;

    li.querySelector(".name").textContent = p.name ?? "Unknown";

    const right = li.querySelector(".ac");
    if (hasResult) {
      right.innerHTML = `<span>${p.total}</span>`;
    } else {
      const actor = fromUuidSync(p.uuid);
      const canRoll = game.user.isGM || actor?.isOwner;

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

  content.appendChild(tray);
  activateInteractions(message, ul);
  activateSaveRollButtons(message, ul);
}

/**
 * Attach dnd5e-style target interactions (click to control/pan, hover highlight) to tray entries.
 *
 * @param {ChatMessage5e} message
 * @param {HTMLElement} html
 */
function activateInteractions(message, html) {
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
function activateSaveRollButtons(message, html) {
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
