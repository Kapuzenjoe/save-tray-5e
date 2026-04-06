import { MODULE_ID } from "./constants.mjs";

const TEMPLATE_TARGETING_STATES = new WeakMap();
const CREATURE_ACTOR_TYPES = new Set(["character", "npc"]);

/**
 * Register template auto-targeting hooks.
 *
 * @returns {void}
 */
export function readyTemplateTargeting() {
    if ((game.release?.generation ?? 0) !== 14) return;
    Hooks.on("dnd5e.createActivityTemplate", onCreateActivityTemplate);
}

/**
 * Attach auto-targeting behavior to freshly created activity preview templates.
 *
 * @param {Activity} activity The source activity.
 * @param {MeasuredTemplate[]} templates The preview templates created for the activity.
 * @returns {void}
 */
function onCreateActivityTemplate(activity, templates) {
    if (!game.settings.get(MODULE_ID, "autoTemplateTargeting")) return;
    if (!shouldAutoTargetActivity(activity)) return;

    for (const template of templates ?? []) {
        instrumentPreviewTemplate(activity, template);
    }
}

/**
 * Determine whether the activity should participate in auto template targeting.
 *
 * @param {Activity} activity The source activity.
 * @returns {boolean}
 */
function shouldAutoTargetActivity(activity) {
    if (activity?.type !== "save") return false;

    const target = activity?.target;
    if (!target?.template?.type) return false;
    if (target.affects?.choice === true) return false;

    const affectsType = target.affects?.type ?? "";
    if (!["any", "creature", "creatureOrObject", "ally", "enemy"].includes(affectsType)) return false;

    const count = target.affects?.count;
    return (count === null) || (count === undefined) || (count === "");
}

/**
 * Attach preview move/confirm hooks to a single preview template instance.
 *
 * @param {Activity} activity The source activity.
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {void}
 */
function instrumentPreviewTemplate(activity, template) {
    if (!template || TEMPLATE_TARGETING_STATES.has(template)) return;

    TEMPLATE_TARGETING_STATES.set(template, { lastTargetIds: [] });

    const originalMove = template._onMovePlacement;
    if (typeof originalMove === "function") {
        template._onMovePlacement = function(event) {
            const before = getTemplatePlacementSnapshot(this);
            originalMove.call(this, event);
            const after = getTemplatePlacementSnapshot(this);
            if (!didTemplatePlacementChange(before, after)) return;
            updatePreviewTargets(activity, this);
        };
    }
}

/**
 * Recompute targets while the template preview is moving.
 *
 * @param {Activity} activity The source activity.
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {void}
 */
function updatePreviewTargets(activity, template) {
    const tokenIds = collectTemplateTargetIds(activity, template);
    applyPreviewTargets(template, tokenIds);
}

/**
 * Snapshot placement-relevant template document fields.
 *
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {{x: number|null, y: number|null, distance: number|null, direction: number|null, angle: number|null, width: number|null}|null}
 */
function getTemplatePlacementSnapshot(template) {
    const document = template?.document;
    if (!document) return null;

    return {
        x: document.x ?? null,
        y: document.y ?? null,
        distance: document.distance ?? null,
        direction: document.direction ?? null,
        angle: document.angle ?? null,
        width: document.width ?? null
    };
}

/**
 * Determine whether placement-relevant template fields changed.
 *
 * @param {object|null} before The placement snapshot before the move.
 * @param {object|null} after The placement snapshot after the move.
 * @returns {boolean}
 */
function didTemplatePlacementChange(before, after) {
    if (!before || !after) return false;
    return Object.keys(before).some(key => before[key] !== after[key]);
}

/**
 * Collect candidate token IDs matched by the current template.
 *
 * @param {Activity} activity The source activity.
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {string[]}
 */
function collectTemplateTargetIds(activity, template) {
    if (!template?.shape) return [];

    const sourceToken = resolveSourceToken(activity);
    const targetType = activity?.target?.affects?.type ?? "any";
    const templateBounds = getTemplateBounds(template);
    const restrictedPolygons = getRestrictedPolygons(template);
    const ids = [];

    for (const token of canvas.tokens?.placeables ?? []) {
        if (!isCandidateToken(token)) continue;
        if (templateBounds && token.bounds && !templateBounds.intersects(token.bounds)) continue;
        if (!matchesTargetType(token, targetType, sourceToken)) continue;
        const intersects = restrictedPolygons
            ? tokenIntersectsPolygonTree(token, restrictedPolygons)
            : tokenIntersectsTemplate(token, template);
        if (!intersects) continue;
        ids.push(token.id);
    }

    ids.sort();
    return ids;
}

/**
 * Build a temporary move-restricted polygon tree for a preview template.
 *
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {foundry.data.PolygonTree|null}
 */
function getRestrictedPolygons(template) {
    try {
        const region = createPreviewRegion(template);
        if (!region) return null;

        const levels = canvas.level?.id ? [canvas.level.id] : region.levels;
        const restriction = {
            enabled: true,
            type: "move",
            priority: region.restriction?.priority ?? 0
        };

        const restricted = foundry.documents.RegionDocument.fromSource(region.toObject(), { parent: region.parent });
        if (typeof restricted?._computeShapeConstraints !== "function") return null;
        if (typeof restricted?._createClipperPolyTree !== "function") return null;

        restricted.updateSource({ restriction, levels });
        const shapeConstraints = restricted._computeShapeConstraints({
            restriction,
            levels,
            shapes: restricted.shapes
        });
        if (!shapeConstraints) return null;
        const clipperPolyTree = restricted._createClipperPolyTree(restricted.shapes, shapeConstraints);
        return foundry.data.PolygonTree.fromClipperPolyTree(clipperPolyTree);
    } catch {
        return null;
    }
}

/**
 * Create an ephemeral Region document from a preview MeasuredTemplate.
 *
 * @param {MeasuredTemplate} template The preview template instance.
 * @returns {RegionDocument|null}
 */
function createPreviewRegion(template) {
    const source = template?.document?.toObject?.();
    if (!source) return null;

    const regionData = foundry.documents.BaseRegion._migrateMeasuredTemplateData(source, {
        grid: canvas.scene?.grid ?? canvas.grid,
        gridTemplates: game.settings.get("core", "gridTemplates"),
        coneTemplateType: game.settings.get("core", "coneTemplateType"),
        users: game.users.contents
    });

    return foundry.documents.RegionDocument.fromSource(regionData, { parent: canvas.scene });
}

/**
 * Apply preview target IDs if they changed.
 *
 * @param {MeasuredTemplate} template The preview template instance.
 * @param {string[]} tokenIds Target token IDs.
 * @returns {void}
 */
function applyPreviewTargets(template, tokenIds) {
    const state = TEMPLATE_TARGETING_STATES.get(template);
    const prior = state?.lastTargetIds ?? [];
    if ((prior.length === tokenIds.length) && prior.every((id, index) => id === tokenIds[index])) return;

    canvas.tokens?.setTargets?.(tokenIds, { mode: "replace" });
    if (state) state.lastTargetIds = tokenIds;
}

/**
 * Snapshot the user's current targeted tokens in the same compact shape used by dnd5e message flags.
 *
 * @returns {{ name: string, img: string, uuid: string, ac: number|null }[]}
 */
export function getCurrentTargetDescriptors() {
    return getTargetDescriptorsFromTargets(game.user.targets ?? []);
}

/**
 * Snapshot arbitrary targets in the same compact shape used by dnd5e message flags.
 *
 * @param {Iterable<Token>|Token[]} targets Targets to normalize.
 * @returns {{ name: string, img: string, uuid: string, ac: number|null }[]}
 */
function getTargetDescriptorsFromTargets(targets) {
    const descriptors = new Map();
    for (const target of targets ?? []) {
        const actor = target?.actor;
        const uuid = actor?.uuid;
        if (!uuid) continue;

        const ac = actor.statuses?.has("coverTotal") ? null : actor.system?.attributes?.ac?.value;
        descriptors.set(uuid, {
            name: target.name ?? actor.name ?? "",
            img: actor.img ?? "",
            uuid,
            ac: ac ?? null
        });
    }
    return Array.from(descriptors.values());
}

/**
 * Resolve the source token for ally/enemy filtering.
 *
 * @param {Activity} activity The source activity.
 * @returns {Token|null}
 */
function resolveSourceToken(activity) {
    const actor = activity?.actor;
    return actor?.token?.object ?? actor?.getActiveTokens?.()[0] ?? null;
}

/**
 * Determine whether a token is a valid auto-targeting candidate.
 *
 * @param {Token} token The token to evaluate.
 * @returns {boolean}
 */
function isCandidateToken(token) {
    const actor = token?.actor;
    if (!actor || !token?.id) return false;
    if (token.document?.hidden) return false;
    if (isDefeatedToken(token)) return false;
    if (hasEtherealStatus(token)) return false;

    const hpMax = Number(actor.system?.attributes?.hp?.max);
    if (Number.isFinite(hpMax) && (hpMax <= 0)) return false;

    return true;
}

/**
 * Determine whether the token is defeated/dead.
 *
 * @param {Token} token The token to evaluate.
 * @returns {boolean}
 */
function isDefeatedToken(token) {
    const defeatedStatus = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
    return token.document?.hasStatusEffect?.(defeatedStatus) === true || token.combatant?.isDefeated === true;
}

/**
 * Determine whether the token has the Ethereal status.
 *
 * @param {Token} token The token to evaluate.
 * @returns {boolean}
 */
function hasEtherealStatus(token) {
    return token.document?.hasStatusEffect?.("ethereal") === true || token.actor?.statuses?.has?.("ethereal") === true;
}

/**
 * Apply type/disposition filtering to a candidate token.
 *
 * @param {Token} token The token to evaluate.
 * @param {string} targetType Supported dnd5e affects type.
 * @param {Token|null} sourceToken Source token for ally/enemy checks.
 * @returns {boolean}
 */
function matchesTargetType(token, targetType, sourceToken) {
    switch (targetType) {
        case "any":
            return true;
        case "creature":
            return CREATURE_ACTOR_TYPES.has(token.actor?.type);
        case "creatureOrObject":
            return token.actor?.type !== "group";
        case "ally":
            return !!sourceToken
                && CREATURE_ACTOR_TYPES.has(token.actor?.type)
                && token.document?.disposition === sourceToken.document?.disposition;
        case "enemy":
            return !!sourceToken
                && CREATURE_ACTOR_TYPES.has(token.actor?.type)
                && token.document?.disposition !== CONST.TOKEN_DISPOSITIONS.SECRET
                && token.document?.disposition !== sourceToken.document?.disposition;
        default:
            return false;
    }
}

/**
 * Determine whether any of a token's containment test points fall within the template.
 *
 * @param {Token} token The token to test.
 * @param {MeasuredTemplate} template The preview template.
 * @returns {boolean}
 */
function tokenIntersectsTemplate(token, template) {
    const points = token.document?.getContainmentTestPoints?.() ?? [];
    return points.some(point => template.testPoint(point));
}

/**
 * Determine whether any of a token's containment test points fall within a polygon tree.
 *
 * @param {Token} token The token to test.
 * @param {foundry.data.PolygonTree} polygonTree The polygon tree to test against.
 * @returns {boolean}
 */
function tokenIntersectsPolygonTree(token, polygonTree) {
    const points = token.document?.getContainmentTestPoints?.() ?? [];
    return points.some(point => polygonTree.testPoint(point, 0.75));
}

/**
 * Compute template bounds in scene coordinates.
 *
 * @param {MeasuredTemplate} template The preview template.
 * @returns {PIXI.Rectangle|null}
 */
function getTemplateBounds(template) {
    if (!template?.shape) return null;

    const bounds = template.shape.getBounds();
    bounds.x += template.document?.x ?? 0;
    bounds.y += template.document?.y ?? 0;
    return bounds;
}
