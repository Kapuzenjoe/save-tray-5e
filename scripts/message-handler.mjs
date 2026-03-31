import { MODULE_ID, SAVE_TRAY_FLAG } from "./constants.mjs";
import {
  getSaveTrayData,
  initializeSaveTrayMessage,
  activateInteractions,
  activateSaveRollButtons,
  activateDamageMultiplierPreset,
  recordSaveResult
} from "./message-helper.mjs";

const SAVE_TRAY_MODES = new Map();
const SAVE_TRAY_CLASS = "save-tray-5e card-tray targets-tray collapsible";

/**
 * Insert or replace a tray entry in a UUID-keyed map.
 *
 * @param {Map<string, {img: string, name: string, uuid: string}>} entries The target map.
 * @param {string|null|undefined} uuid The actor UUID.
 * @param {string|null|undefined} name The display name.
 * @param {string|null|undefined} img The image path.
 * @returns {void}
 */
function setTrayEntry(entries, uuid, name, img) {
  if (!uuid) return;
  entries.set(uuid, {
    img: img ?? "",
    name: name ?? "",
    uuid
  });
}

/**
 * Get the current collapsed state for the save tray.
 *
 * Prefer the existing DOM tray when present, otherwise fall back to the
 * tray state remembered by the dnd5e chat log.
 *
 * @param {ChatMessage5e} message The source message.
 * @param {HTMLElement} content The message content container.
 * @returns {boolean}
 */
function getSaveTrayCollapsedState(message, content) {
  const tray = content?.querySelector?.(".save-tray-5e");
  if (tray) return tray.classList.contains("collapsed");
  return message?._trayStates?.get?.(SAVE_TRAY_CLASS) ?? false;
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
  Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
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

  await recordSaveResult(srcMsg, actor, {
    ability,
    dc,
    name: token.name ?? actor.name ?? "",
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
  refreshRenderedSaveTrays(ui.chat?.element, { selectedOnly: true });
}


/**
 * Get the stored save targets snapshot from a message.
 *
 * @param {ChatMessage5e} message The source chat message.
 * @returns {{img: string, name: string, uuid: string}[]} Target descriptors.
 */
function getTargetedEntries(message) {
  const targeted = new Map();
  for (const target of message?.getFlag?.("dnd5e", "targets") ?? []) {
    setTrayEntry(targeted, target?.uuid, target?.name, target?.img);
  }
  return Array.from(targeted.values());
}

/**
 * Get the currently selected token actors.
 *
 * @returns {{img: string, name: string, uuid: string}[]} Selected token descriptors.
 */
function getSelectedEntries() {
  const selected = new Map();
  for (const token of canvas.tokens?.controlled ?? []) {
    setTrayEntry(selected, token.actor?.uuid, token.name ?? token.actor?.name, token.actor?.img);
  }
  return Array.from(selected.values());
}

/**
 * Get a localized short label for a save ability.
 *
 * @param {string} ability The ability identifier.
 * @returns {{abbr: string, label: string}} Localized display labels.
 */
function getAbilityLabels(ability) {
  const config = CONFIG.DND5E.abilities?.[ability];
  const abilityLabel = config?.label ?? config?.abbreviation ?? ability?.toUpperCase?.() ?? "";
  return {
    abbr: config?.abbreviation ?? ability?.toUpperCase?.() ?? "",
    label: game.i18n.format("DND5E.SavePromptTitle", { ability: abilityLabel })
  };
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

  const raw = message?.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG);
  if (raw === undefined) {
    content.querySelectorAll(".save-tray-5e").forEach(el => el.remove());
    return;
  }
  const data = getSaveTrayData(message);
  const recordedByActor = new Map(data.recorded.map(result => [result.actor, result]));

  const buildTray = (collapsed = false) => {
    const targetedEntries = getTargetedEntries(message);
    const selectedEntries = getSelectedEntries();
    const hasTargetedEntries = targetedEntries.length > 0;
    const initialMode = hasTargetedEntries && SAVE_TRAY_MODES.get(message.id) !== "selected" ? "targeted" : "selected";

    const tray = document.createElement("div");
    tray.className = SAVE_TRAY_CLASS;
    tray.classList.toggle("collapsed", collapsed);

    const label = document.createElement("label");
    label.classList.add("roboto-upper");
    label.innerHTML = `
      <i class="fa-solid fa-shield-heart" inert></i>
      <span>${game.i18n.localize("DND5E.SavingThrow")}</span>
      <i class="fas fa-caret-down" inert></i>
    `;

    const body = document.createElement("div");
    body.classList.add("collapsible-content");

    label.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      tray.classList.toggle("collapsed");
    });

    body.addEventListener("click", event => {
      event.stopPropagation();
    });

    const wrapper = document.createElement("div");
    wrapper.classList.add("wrapper");

    const controls = document.createElement("div");
    controls.classList.add("target-source-control");

    const targetedButton = document.createElement("button");
    targetedButton.type = "button";
    targetedButton.classList.add("unbutton");
    targetedButton.dataset.mode = "targeted";
    targetedButton.innerHTML = `
      <i class="fa-solid fa-bullseye" inert></i> ${game.i18n.localize("DND5E.Tokens.Targeted")}
    `;

    const selectedButton = document.createElement("button");
    selectedButton.type = "button";
    selectedButton.classList.add("unbutton");
    selectedButton.dataset.mode = "selected";
    selectedButton.innerHTML = `
      <i class="fa-solid fa-expand" inert></i> ${game.i18n.localize("DND5E.Tokens.Selected")}
    `;

    controls.append(targetedButton, selectedButton);
    controls.hidden = !hasTargetedEntries;

    const ul = document.createElement("ul");
    ul.classList.add("targets", "unlist");

    const renderList = (mode) => {
      SAVE_TRAY_MODES.set(message.id, mode);
      targetedButton.setAttribute("aria-pressed", String(mode === "targeted"));
      selectedButton.setAttribute("aria-pressed", String(mode === "selected"));

      const sourceEntries = mode === "targeted" ? targetedEntries : selectedEntries;
      const rows = [];

      for (const entry of sourceEntries) {
        const result = recordedByActor.get(entry.uuid);
        const hasResult = Number.isFinite(result?.total);
        const actor = fromUuidSync(entry.uuid);
        const canRoll = game.user.isGM || actor?.isOwner;
        const li = document.createElement("li");
        li.classList.add("target");
        li.dataset.saveUuid = entry.uuid;
        li.innerHTML = `
          <img class="gold-icon" alt="">
          <div class="name-stacked">
            <span class="title"></span>
            <span class="subtitle"></span>
          </div>
        `;

        const img = li.querySelector(".gold-icon");
        const imagePath = entry.img || actor?.img || "";
        if (imagePath) img.src = imagePath;
        else img.hidden = true;
        img.alt = entry.name || actor?.name || "";

        const isHideNPCNamesActive = game.modules?.get?.("hide-npc-names")?.active === true;
        const hiddenName = isHideNPCNamesActive && actor && game?.hnn?.getReplacementInfo
          ? game.hnn.getReplacementInfo(actor)?.displayName
          : null;
        const actorName = hiddenName || result?.name || entry.name;
        li.querySelector(".title").textContent = actorName ?? game.i18n.localize("DND5E.Unknown");

        if (hasResult) {
          const value = document.createElement("div");
          value.classList.add("calculated", "damage");
          if (result?.success === true) value.classList.add("healing");
          value.innerHTML = `
            <i class="fa-solid fa-shield-heart" inert></i>
            <span>${result.total}</span>
          `;
          li.append(value);
        } else if (canRoll && data.save.abilities.length) {
          const menu = document.createElement("menu");
          menu.classList.add("save-buttons", "unlist");

          for (const ability of data.save.abilities) {
            const { abbr, label } = getAbilityLabels(ability);
            const item = document.createElement("li");
            item.innerHTML = `
              <button type="button" class="save-tray-5e-roll" data-save-uuid="${entry.uuid}" data-save-ability="${ability}"
                      data-tooltip aria-label="${label}">
                <i class="fa-solid fa-shield-heart" inert></i>
                <span>${abbr}</span>
              </button>
            `;
            menu.append(item);
          }

          li.append(menu);
        }

        rows.push(li);
      }

      if (!rows.length) {
        const empty = document.createElement("li");
        empty.classList.add("none");
        empty.textContent = game.i18n.localize(`DND5E.Tokens.None${mode.capitalize()}`);
        ul.replaceChildren(empty);
        return;
      }

      ul.replaceChildren(...rows);
      activateInteractions(message, ul);
      activateSaveRollButtons(message, ul);
    };

    if (hasTargetedEntries) {
      controls.querySelectorAll("button").forEach(button => {
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          renderList(event.currentTarget.dataset.mode);
        });
      });
    }

    renderList(initialMode);

    wrapper.append(controls, ul);
    body.appendChild(wrapper);
    tray.appendChild(label);
    tray.appendChild(body);

    return tray;
  };

  const applyTray = () => {
    const collapsed = getSaveTrayCollapsedState(message, content);
    content.querySelectorAll(".save-tray-5e").forEach(el => el.remove());
    const tray = buildTray(collapsed);
    content.appendChild(tray);
    return true;
  };

  applyTray();
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
  const nodes = html?.querySelectorAll?.("li.chat-message[data-message-id]");
  if (!nodes?.length) return;

  for (const node of nodes) {
    const msgId = node.dataset.messageId;
    const msg = game.messages?.get?.(msgId);
    if (!msg) continue;

    if (msg.getFlag?.(MODULE_ID, SAVE_TRAY_FLAG) === undefined) continue;

    if (selectedOnly) {
      const tray = node.querySelector(".save-tray-5e");
      if (!tray) continue;

      const controls = tray.querySelector(".target-source-control");
      if (controls && !controls.hidden) {
        const selectedPressed =
          controls.querySelector('[data-mode="selected"]')?.getAttribute("aria-pressed") === "true";
        if (!selectedPressed) continue;
      }
    }

    onRenderChatMessage(msg, node);
  }
}
