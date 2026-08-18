import { normalizeTodayTrendStore } from './today-trend-model.js';
import {
    appendTodayTrendCanonicalSnapshot, applyTodayTrendHistoryProducer, rollbackTodayTrendCanonicalPayload,
} from './today-trend-history-reducer.js';

export const TODAY_TREND_V2_STORE_VERSION = 2;
const GLOBAL_ENVELOPE_VERSION = 1;
const SCOPE_ENVELOPE_VERSION = 1;
const PROJECTION_KINDS = new Set([
    'live-stage', 'undated-stage', 'legacy-stage', 'day-summary', 'period-summary', 'span-stage',
]);
const REMOVABLE_PREFIXES = { detail: 'detail', 'day-summary': 'day', manifest: 'manifest' };
const REMOVAL_REASONS = new Set(['detail-pool-capacity', 'archived-retention']);
const LEGACY_STAGE_KIND = 'legacy-stage';
const clone = value => structuredClone(value);
const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((item, index) => same(item, right[index]));
    }
    if (!plainRecord(left) || !plainRecord(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};

function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}
const invalid = message => failure('TT_V2_SCHEMA_INVALID', message);

function safeInteger(value, field, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) invalid(`${field} 必须是大于等于 ${minimum} 的安全整数`);
    return value;
}

function exact(value, keys, field) {
    if (!plainRecord(value)) invalid(`${field} 必须是对象`);
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        invalid(`${field} 字段集合无效`);
    }
}

function nonEmptyString(value, field) {
    if (typeof value !== 'string' || !value) invalid(`${field} 必须是非空字符串`);
}

function nullableString(value, field) {
    if (value !== null && typeof value !== 'string') invalid(`${field} 必须是字符串或 null`);
}

function nullableInteger(value, field) {
    if (value !== null) safeInteger(value, field);
}

function stringArray(value, field) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
        invalid(`${field} 必须是非空字符串数组`);
    }
    if (new Set(value).size !== value.length) invalid(`${field} 不得重复`);
}

function legacyStageId(eventId, index) {
    return `legacy:${eventId}:${String(index + 1).padStart(4, '0')}`;
}

function migrateLegacyStage(eventId, text, index) {
    return {
        id: legacyStageId(eventId, index), kind: LEGACY_STAGE_KIND, text, legacyIndex: index,
        sourceStageStart: index + 1, sourceStageEnd: index + 1, revision: 1,
    };
}

function normalizeLegacyStage(value, eventId) {
    exact(value, ['id', 'kind', 'text', 'legacyIndex', 'sourceStageStart', 'sourceStageEnd', 'revision'], 'legacy-stage');
    safeInteger(value.legacyIndex, 'legacy-stage.legacyIndex');
    if (value.id !== legacyStageId(eventId, value.legacyIndex) || value.kind !== LEGACY_STAGE_KIND
        || value.sourceStageStart !== value.legacyIndex + 1 || value.sourceStageEnd !== value.legacyIndex + 1 || value.revision !== 1
        || typeof value.text !== 'string' || !value.text) invalid('legacy-stage 内容无效');
    return { ...value };
}

function normalizeFloorRange(value, field) {
    nullableInteger(value.sourceFloorStart, `${field}.sourceFloorStart`);
    nullableInteger(value.sourceFloorEnd, `${field}.sourceFloorEnd`);
    if ((value.sourceFloorStart === null) !== (value.sourceFloorEnd === null)
        || (value.sourceFloorStart !== null && value.sourceFloorStart > value.sourceFloorEnd)) {
        invalid(`${field} 楼层区间无效`);
    }
}

function normalizeSourceRange(value, field) {
    safeInteger(value.sourceStageStart, `${field}.sourceStageStart`, 1);
    safeInteger(value.sourceStageEnd, `${field}.sourceStageEnd`, 1);
    if (value.sourceStageStart > value.sourceStageEnd) invalid(`${field} source 区间无效`);
    if (value.revision !== 1) invalid(`${field}.revision 无效`);
}

function normalizeLiveStage(value, eventId) {
    exact(value, ['id', 'kind', 'storyDate', 'time', 'timeLabel', 'text', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'live-stage');
    normalizeSourceRange(value, 'live-stage');
    normalizeFloorRange(value, 'live-stage');
    if (!String(value.id).startsWith(`live:${eventId}:`) || value.kind !== 'live-stage') invalid('live-stage ID 或 kind 无效');
    nonEmptyString(value.storyDate, 'live-stage.storyDate');
    nullableString(value.time, 'live-stage.time');
    nullableString(value.timeLabel, 'live-stage.timeLabel');
    nonEmptyString(value.text, 'live-stage.text');
    return clone(value);
}

function normalizeUndatedStage(value, eventId) {
    exact(value, ['id', 'kind', 'storyDate', 'time', 'timeLabel', 'text', 'undatedSequence', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'undated-stage');
    normalizeSourceRange(value, 'undated-stage');
    normalizeFloorRange(value, 'undated-stage');
    safeInteger(value.undatedSequence, 'undated-stage.undatedSequence', 1);
    if (value.id !== `undated:${eventId}:${value.undatedSequence}` || value.kind !== 'undated-stage' || value.storyDate !== null) {
        invalid('undated-stage ID、kind 或 storyDate 无效');
    }
    nullableString(value.time, 'undated-stage.time');
    nullableString(value.timeLabel, 'undated-stage.timeLabel');
    nonEmptyString(value.text, 'undated-stage.text');
    return clone(value);
}

function normalizeTimeRange(value, field) {
    exact(value, ['start', 'end', 'label'], field);
    nullableString(value.start, `${field}.start`);
    nullableString(value.end, `${field}.end`);
    nullableString(value.label, `${field}.label`);
}

function normalizeDaySummary(value, eventId) {
    exact(value, ['id', 'kind', 'status', 'storyDate', 'timeRange', 'summary', 'keyStages', 'detailRefs', 'detailCount', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'day-summary');
    normalizeSourceRange(value, 'day-summary');
    normalizeFloorRange(value, 'day-summary');
    if (value.id !== `day:${eventId}:${value.storyDate}` || value.kind !== 'day-summary' || value.status !== 'closed') invalid('day-summary ID、kind 或 status 无效');
    nonEmptyString(value.storyDate, 'day-summary.storyDate');
    normalizeTimeRange(value.timeRange, 'day-summary.timeRange');
    nonEmptyString(value.summary, 'day-summary.summary');
    stringArray(value.keyStages, 'day-summary.keyStages');
    stringArray(value.detailRefs, 'day-summary.detailRefs');
    safeInteger(value.detailCount, 'day-summary.detailCount');
    return clone(value);
}

function normalizePeriodSummary(value, eventId) {
    exact(value, ['id', 'kind', 'periodSequence', 'startDate', 'startTime', 'endDate', 'endTime', 'summary', 'childSummaryRefs', 'childSummaryCount', 'historicalDetailCount', 'sourceStageStart', 'sourceStageEnd', 'revision'], 'period-summary');
    normalizeSourceRange(value, 'period-summary');
    safeInteger(value.periodSequence, 'period-summary.periodSequence', 1);
    if (value.id !== `period:${eventId}:${value.periodSequence}` || value.kind !== 'period-summary') invalid('period-summary ID 或 kind 无效');
    nonEmptyString(value.startDate, 'period-summary.startDate');
    nullableString(value.startTime, 'period-summary.startTime');
    nonEmptyString(value.endDate, 'period-summary.endDate');
    nullableString(value.endTime, 'period-summary.endTime');
    nonEmptyString(value.summary, 'period-summary.summary');
    stringArray(value.childSummaryRefs, 'period-summary.childSummaryRefs');
    safeInteger(value.childSummaryCount, 'period-summary.childSummaryCount');
    safeInteger(value.historicalDetailCount, 'period-summary.historicalDetailCount');
    return clone(value);
}

function normalizeSpanStage(value, eventId) {
    exact(value, ['id', 'kind', 'startDate', 'startTime', 'endDate', 'endTime', 'summary', 'sourceStageStart', 'sourceStageEnd', 'sourceFloorStart', 'sourceFloorEnd', 'revision'], 'span-stage');
    normalizeSourceRange(value, 'span-stage');
    normalizeFloorRange(value, 'span-stage');
    if (!String(value.id).startsWith(`span:${eventId}:`) || value.kind !== 'span-stage') invalid('span-stage ID 或 kind 无效');
    nonEmptyString(value.startDate, 'span-stage.startDate');
    nullableString(value.startTime, 'span-stage.startTime');
    nonEmptyString(value.endDate, 'span-stage.endDate');
    nullableString(value.endTime, 'span-stage.endTime');
    nonEmptyString(value.summary, 'span-stage.summary');
    return clone(value);
}

export function normalizeTodayTrendStageProjection(value, eventId) {
    if (!plainRecord(value) || !PROJECTION_KINDS.has(value.kind)) invalid('StageProjection kind 无效');
    if (value.kind === 'legacy-stage') return normalizeLegacyStage(value, eventId);
    if (value.kind === 'live-stage') return normalizeLiveStage(value, eventId);
    if (value.kind === 'undated-stage') return normalizeUndatedStage(value, eventId);
    if (value.kind === 'day-summary') return normalizeDaySummary(value, eventId);
    if (value.kind === 'period-summary') return normalizePeriodSummary(value, eventId);
    return normalizeSpanStage(value, eventId);
}

export function resolveTodayTrendV2LatestStage(event) {
    if (!plainRecord(event) || !Array.isArray(event.stages) || event.stages.length === 0) invalid('v2 event stages 不能为空');
    const latest = event.stages.reduce((selected, stage) => !selected
        || stage.sourceStageEnd > selected.sourceStageEnd
        || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart > selected.sourceStageStart)
        || (stage.sourceStageEnd === selected.sourceStageEnd && stage.sourceStageStart === selected.sourceStageStart && stage.id > selected.id)
        ? stage : selected, null);
    return projectionText(latest);
}

function migrateEvent(event, archivedSequence = null) {
    const stages = event.stages.map((text, index) => migrateLegacyStage(event.id, text, index));
    return {
        ...clone(event), stages, capacityCompatibilityPending: stages.length === 40,
        ...(event.lifecycle === 'archived' ? { archivedAtAssistantCount: null, archivedSequence } : {}),
    };
}

function projectionText(stage) {
    return ['day-summary', 'period-summary', 'span-stage'].includes(stage.kind) ? stage.summary : stage.text;
}

function projectEventToV1(event) {
    return {
        id: event.id, type: event.type, lifecycle: event.lifecycle, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: event.participants, stages: event.stages.map(projectionText),
        latestStage: event.latestStage, outcome: event.outcome, finalResult: event.finalResult,
        relatedEventIds: event.relatedEventIds, createdAt: event.createdAt, updatedAt: event.updatedAt,
    };
}


function migrateDynamics(dynamics) {
    return {
        active: dynamics.active.map(event => migrateEvent(event)),
        archived: dynamics.archived.map((event, index) => migrateEvent(event, index + 1)),
    };
}

function projectDynamicsToV1(dynamics) {
    return {
        active: dynamics.active.map(projectEventToV1),
        archived: dynamics.archived.map(projectEventToV1),
    };
}

export function extractArchivedFixedCore(event) {
    if (event?.lifecycle !== 'archived') invalid('fixed core 只能从 archived event 提取');
    return clone({
        id: event.id, type: event.type, lifecycle: event.lifecycle, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: event.participants, stages: event.stages, latestStage: event.latestStage,
        outcome: event.outcome, finalResult: event.finalResult, relatedEventIds: event.relatedEventIds,
        archivedAtAssistantCount: event.archivedAtAssistantCount, archivedSequence: event.archivedSequence,
        createdAt: event.createdAt, updatedAt: event.updatedAt,
    });
}

function scopeFacadeFields(scope) {
    return {
        storageId: scope.storageId, characterId: scope.characterId, characterName: scope.characterName, presetId: scope.presetId,
        operation: scope.operation, injection: scope.injection, world: scope.world, reputation: scope.reputation,
        factions: scope.factions, dynamicsSettings: scope.dynamicsSettings,
    };
}

function createScopePayload(scope) {
    const dynamics = migrateDynamics(scope.dynamics);
    const generationSnapshots = scope.generationSnapshots.map(snapshot => ({
        ...clone(snapshot), dynamics: migrateDynamics(snapshot.dynamics),
    }));
    const fixedCoreBaselineByEvent = {};
    for (const event of dynamics.archived) fixedCoreBaselineByEvent[event.id] = extractArchivedFixedCore(event);
    return {
        ...scopeFacadeFields(scope), dynamics, generationSnapshots,
        historyRetentionSettings: { archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1 },
        historyRetentionState: { highWaterAssistantCount: null, nextArchivedSequence: dynamics.archived.length + 1, detailPoolRevision: 0, retentionPolicyRevision: 1 },
        stageDetailsByEvent: {}, archivedRemovableDataByEvent: {}, removableEntityStateById: {}, removableEntityTombstonesById: {},
        fixedCoreBaselineByEvent, commitJournal: null,
    };
}

function projectScopePayloadToV1(scope) {
    return {
        ...scopeFacadeFields(scope), dynamics: projectDynamicsToV1(scope.dynamics),
        generationSnapshots: scope.generationSnapshots.map(snapshot => ({ ...clone(snapshot), dynamics: projectDynamicsToV1(snapshot.dynamics) })),
    };
}

function normalizeEventProjection(event, lifecycle) {
    if (!plainRecord(event) || event.lifecycle !== lifecycle || !Array.isArray(event.stages) || event.stages.length > 40) {
        invalid('v2 event projection 无效');
    }
    const keys = ['id', 'type', 'lifecycle', 'title', 'stageLabel', 'origin', 'participants', 'stages', 'latestStage', 'outcome', 'finalResult', 'relatedEventIds', 'createdAt', 'updatedAt', 'capacityCompatibilityPending'];
    if (lifecycle === 'archived') keys.push('archivedAtAssistantCount', 'archivedSequence');
    exact(event, keys, 'v2 event');
    const normalized = clone(event);
    normalized.stages = event.stages.map(stage => normalizeTodayTrendStageProjection(stage, event.id));
    const stageIds = new Set();
    let previous = null;
    for (const stage of normalized.stages) {
        if (stageIds.has(stage.id)) invalid('StageProjection ID 重复');
        stageIds.add(stage.id);
        if (previous) {
            const order = stage.sourceStageStart - previous.sourceStageStart
                || stage.sourceStageEnd - previous.sourceStageEnd || stage.id.localeCompare(previous.id);
            if (order <= 0) invalid('StageProjection 排序不稳定');
            if (stage.sourceStageStart <= previous.sourceStageEnd) invalid('StageProjection source 区间重叠');
        }
        previous = stage;
    }
    if (normalized.latestStage !== resolveTodayTrendV2LatestStage(normalized)) invalid('v2 latestStage 与最新 source 区间不一致');
    if (event.capacityCompatibilityPending !== (event.stages.length === 40)) invalid('capacityCompatibilityPending 与 stages 数量不一致');
    if (lifecycle === 'active') {
        if (Object.hasOwn(event, 'archivedSequence') || Object.hasOwn(event, 'archivedAtAssistantCount')) invalid('active event 不得携带归档字段');
    } else {
        safeInteger(event.archivedSequence, 'archivedSequence', 1);
        nullableInteger(event.archivedAtAssistantCount, 'archivedAtAssistantCount');
    }
    return normalized;
}

function normalizeRetentionSettings(value) {
    exact(value, ['archivedDetailLatestEventCount', 'archivedDetailRetentionFloors', 'revision'], 'historyRetentionSettings');
    safeInteger(value.archivedDetailLatestEventCount, 'archivedDetailLatestEventCount');
    safeInteger(value.archivedDetailRetentionFloors, 'archivedDetailRetentionFloors');
    if (value.revision !== 1) invalid('historyRetentionSettings.revision 无效');
    return clone(value);
}

function normalizeRetentionState(value) {
    exact(value, ['highWaterAssistantCount', 'nextArchivedSequence', 'detailPoolRevision', 'retentionPolicyRevision'], 'historyRetentionState');
    nullableInteger(value.highWaterAssistantCount, 'highWaterAssistantCount');
    safeInteger(value.nextArchivedSequence, 'nextArchivedSequence', 1);
    safeInteger(value.detailPoolRevision, 'detailPoolRevision');
    safeInteger(value.retentionPolicyRevision, 'retentionPolicyRevision', 1);
    return clone(value);
}

function normalizeRemovableRecord(value, field) {
    exact(value, ['entityType', 'entityId', 'eventId', 'state', 'removalReason', 'removedAtAssistantCount', 'policyRevision'], field);
    const prefix = REMOVABLE_PREFIXES[value.entityType];
    if (!prefix) invalid(`${field}.entityType 无效`);
    nonEmptyString(value.entityId, `${field}.entityId`);
    nonEmptyString(value.eventId, `${field}.eventId`);
    safeInteger(value.policyRevision, `${field}.policyRevision`, 1);
    nullableInteger(value.removedAtAssistantCount, `${field}.removedAtAssistantCount`);
    if (value.state === 'available') {
        if (value.removalReason !== null || value.removedAtAssistantCount !== null) invalid(`${field} available 状态不得携带删除信息`);
    } else if (value.state === 'removed') {
        if (!REMOVAL_REASONS.has(value.removalReason)) invalid(`${field}.removalReason 无效`);
    } else invalid(`${field}.state 无效`);
    if (!value.entityId.startsWith(`${prefix}:${value.eventId}:`)) invalid(`${field} identity 无效`);
    return clone(value);
}

function normalizeRemovableContainers(payload, eventIds, archivedEventIds) {
    if (!plainRecord(payload.stageDetailsByEvent) || !plainRecord(payload.archivedRemovableDataByEvent)
        || !plainRecord(payload.removableEntityStateById) || !plainRecord(payload.removableEntityTombstonesById)) {
        invalid('removable entity 容器无效');
    }
    const bodies = new Map();
    const refs = [];
    const addRefs = (values, prefix) => refs.push(...values.map(ref => {
        if (!ref.startsWith(prefix)) invalid('soft ref 类型或 event 不一致');
        return ref;
    }));
    const registerBody = (id, body, type, eventId) => {
        nonEmptyString(id, `${type} ID`);
        if (!eventIds.has(eventId)) invalid(`${type} 指向未知 event`);
        const existing = bodies.get(id);
        const normalized = clone(body);
        if (existing && !same(existing.body, normalized)) invalid('同一 removable entity ID 内容冲突');
        bodies.set(id, { body: normalized, type, eventId });
        return normalized;
    };
    const stageDetailsByEvent = {};
    for (const [eventId, details] of Object.entries(payload.stageDetailsByEvent)) {
        if (!eventIds.has(eventId) || !Array.isArray(details)) invalid('stageDetailsByEvent 无效');
        stageDetailsByEvent[eventId] = details.map(detail => {
            exact(detail, ['id', 'sourceStageSequence', 'text', 'storyDate'], 'stage detail');
            safeInteger(detail.sourceStageSequence, 'stage detail sourceStageSequence', 1);
            nonEmptyString(detail.text, 'stage detail text');
            nullableString(detail.storyDate, 'stage detail storyDate');
            if (detail.id !== `detail:${eventId}:${detail.sourceStageSequence}`) invalid('stage detail ID 无效');
            return registerBody(detail.id, detail, 'detail', eventId);
        });
    }
    const archivedRemovableDataByEvent = {};
    for (const [eventId, container] of Object.entries(payload.archivedRemovableDataByEvent)) {
        if (!archivedEventIds.has(eventId)) invalid('archived removable data 只能属于 archived event');
        exact(container, ['daySummariesById', 'manifestsById'], 'archived removable data');
        if (!plainRecord(container.daySummariesById) || !plainRecord(container.manifestsById)) invalid('archived removable data 集合无效');
        const daySummariesById = {};
        for (const [id, summary] of Object.entries(container.daySummariesById)) {
            if (summary.id !== id) invalid('day summary key 与 ID 不一致');
            const normalized = normalizeDaySummary(summary, eventId);
            daySummariesById[id] = registerBody(id, normalized, 'day-summary', eventId);
            addRefs(normalized.detailRefs, `detail:${eventId}:`);
        }
        const manifestsById = {};
        for (const [id, manifest] of Object.entries(container.manifestsById)) {
            exact(manifest, ['id'], 'manifest');
            const prefix = `manifest:${eventId}:`;
            const revision = +id.slice(prefix.length);
            if (manifest.id !== id || `${prefix}${revision}` !== id) invalid('manifest ID 无效');
            safeInteger(revision, 'manifest snapshotRevision', 1);
            manifestsById[id] = registerBody(id, manifest, 'manifest', eventId);
        }
        archivedRemovableDataByEvent[eventId] = { daySummariesById, manifestsById };
    }
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        for (const stage of event.stages) {
            if (stage.kind === 'day-summary') {
                registerBody(stage.id, stage, 'day-summary', event.id);
                addRefs(stage.detailRefs, `detail:${event.id}:`);
            } else if (stage.kind === 'period-summary') addRefs(stage.childSummaryRefs, `day:${event.id}:`);
        }
    }
    const removableEntityStateById = {};
    for (const [id, record] of Object.entries(payload.removableEntityStateById)) {
        const normalized = normalizeRemovableRecord(record, `removableEntityStateById.${id}`);
        if (normalized.entityId !== id) invalid('removable state key 与 entityId 不一致');
        if (!eventIds.has(normalized.eventId)) invalid('removable state 指向未知 event');
        removableEntityStateById[id] = normalized;
    }
    const removableEntityTombstonesById = {};
    for (const [id, record] of Object.entries(payload.removableEntityTombstonesById)) {
        const normalized = normalizeRemovableRecord(record, `removableEntityTombstonesById.${id}`);
        if (normalized.entityId !== id || normalized.state !== 'removed') invalid('tombstone 必须是 removed 审计副本');
        if (!eventIds.has(normalized.eventId)) invalid('tombstone 指向未知 event');
        removableEntityTombstonesById[id] = normalized;
    }
    for (const [id, body] of bodies) {
        const state = removableEntityStateById[id];
        if (!state || state.state !== 'available' || state.entityType !== body.type || state.eventId !== body.eventId) {
            invalid('removable 正文与 available state 不一致');
        }
        if (removableEntityTombstonesById[id]) invalid('available 正文不得存在 tombstone');
    }
    for (const [id, state] of Object.entries(removableEntityStateById)) {
        if (state.state === 'available' && !bodies.has(id)) invalid('available state 缺少正文');
        if (state.state === 'removed') {
            if (bodies.has(id)) invalid('removed state 不得保留正文');
            if (!same(removableEntityTombstonesById[id], state)) invalid('removed state 与 tombstone 不一致');
        }
    }
    for (const id of Object.keys(removableEntityTombstonesById)) {
        if (removableEntityStateById[id]?.state !== 'removed') invalid('tombstone 缺少 removed state');
    }
    for (const ref of refs) {
        if (!bodies.has(ref) && !removableEntityStateById[ref] && !removableEntityTombstonesById[ref]) {
            failure('TT_DANGLING_REF_UNKNOWN', `soft ref 指向未知 removable entity：${ref}`);
        }
    }
    return { stageDetailsByEvent, archivedRemovableDataByEvent, removableEntityStateById, removableEntityTombstonesById };
}

function entityIndex(payload) {
    const result = new Map();
    const add = value => result.set(value.id, value);
    for (const details of Object.values(payload.stageDetailsByEvent)) for (const detail of details) add(detail);
    for (const container of Object.values(payload.archivedRemovableDataByEvent)) {
        for (const summary of Object.values(container.daySummariesById)) add(summary);
        for (const manifest of Object.values(container.manifestsById)) add(manifest);
    }
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        for (const stage of event.stages) result.set(stage.id, stage);
    }
    return result;
}

export function validateTodayTrendV2Transition(previousValue, candidateValue) {
    const previous = normalizeTodayTrendV2Store(previousValue);
    const candidate = normalizeTodayTrendV2Store(candidateValue);
    for (const [storageId, previousEnvelope] of Object.entries(previous.globalEnvelope.payload.scopes)) {
        const nextPayload = candidate.globalEnvelope.payload.scopes[storageId]?.payload;
        const previousPayload = previousEnvelope.payload;
        if (!nextPayload) {
            if (Object.values(previousPayload.removableEntityStateById).some(item => item.state === 'removed')) invalid('包含 removed lifecycle 的 scope 不得直接删除');
            continue;
        }
        const oldEntities = entityIndex(previousPayload);
        const newEntities = entityIndex(nextPayload);
        for (const [id, state] of Object.entries(previousPayload.removableEntityStateById)) {
            const nextState = nextPayload.removableEntityStateById[id];
            if (state.state === 'removed' && !same(nextState, state)) invalid('removed lifecycle 不可逆或删除');
        }
        for (const [id, entity] of oldEntities) {
            if (newEntities.has(id) && !same(newEntities.get(id), entity)) invalid('稳定 ID 不得改写');
        }
    }
    return candidate;
}

function normalizeScopeEnvelope(value, presets) {
    exact(value, ['schemaVersion', 'revision', 'payload'], 'scope envelope');
    if (value.schemaVersion !== SCOPE_ENVELOPE_VERSION) invalid('scope envelope 版本无效');
    safeInteger(value.revision, 'scope envelope revision');
    const payload = clone(value.payload);
    exact(payload, ['storageId', 'characterId', 'characterName', 'presetId', 'operation', 'injection', 'world', 'reputation', 'factions', 'dynamicsSettings', 'dynamics', 'generationSnapshots', 'historyRetentionSettings', 'historyRetentionState', 'stageDetailsByEvent', 'archivedRemovableDataByEvent', 'removableEntityStateById', 'removableEntityTombstonesById', 'fixedCoreBaselineByEvent', 'commitJournal'], 'scope payload');
    if (!plainRecord(payload.dynamics) || !Array.isArray(payload.generationSnapshots)) invalid('scope payload 无效');
    payload.dynamics = {
        active: payload.dynamics.active.map(event => normalizeEventProjection(event, 'active')),
        archived: payload.dynamics.archived.map(event => normalizeEventProjection(event, 'archived')),
    };
    const eventIds = new Set();
    const archivedEventIds = new Set();
    const archivedSequences = new Set();
    for (const event of [...payload.dynamics.active, ...payload.dynamics.archived]) {
        if (eventIds.has(event.id)) invalid('v2 event ID 重复');
        eventIds.add(event.id);
        if (event.lifecycle === 'archived') {
            if (archivedSequences.has(event.archivedSequence)) invalid('archivedSequence 重复');
            archivedSequences.add(event.archivedSequence);
            archivedEventIds.add(event.id);
        }
    }
    payload.generationSnapshots = payload.generationSnapshots.map(snapshot => ({
        ...clone(snapshot),
        dynamics: {
            active: snapshot.dynamics.active.map(event => normalizeEventProjection(event, 'active')),
            archived: snapshot.dynamics.archived.map(event => normalizeEventProjection(event, 'archived')),
        },
    }));
    const v1Store = normalizeTodayTrendStore({ version: 1, presets, scopes: { [payload.storageId]: projectScopePayloadToV1(payload) } });
    const facade = v1Store.scopes[payload.storageId];
    payload.operation = clone(facade.operation); payload.injection = clone(facade.injection); payload.world = clone(facade.world);
    payload.reputation = clone(facade.reputation); payload.factions = clone(facade.factions); payload.dynamicsSettings = clone(facade.dynamicsSettings);
    payload.historyRetentionSettings = normalizeRetentionSettings(payload.historyRetentionSettings);
    payload.historyRetentionState = normalizeRetentionState(payload.historyRetentionState);
    const removable = normalizeRemovableContainers(payload, eventIds, archivedEventIds);
    Object.assign(payload, removable);
    if (!plainRecord(payload.fixedCoreBaselineByEvent)) invalid('fixedCoreBaselineByEvent 必须是对象');
    const fixedCoreBaselineByEvent = {};
    for (const event of payload.dynamics.archived) {
        const baseline = payload.fixedCoreBaselineByEvent[event.id];
        if (!baseline || !same(baseline, extractArchivedFixedCore(event))) invalid('archived fixed core baseline 不一致');
        fixedCoreBaselineByEvent[event.id] = clone(baseline);
    }
    if (Object.keys(payload.fixedCoreBaselineByEvent).some(id => !archivedEventIds.has(id))) invalid('fixed core baseline 存在孤儿记录');
    payload.fixedCoreBaselineByEvent = fixedCoreBaselineByEvent;
    if (payload.commitJournal !== null) invalid('scope payload commitJournal 必须为 null');
    return { schemaVersion: SCOPE_ENVELOPE_VERSION, revision: value.revision, payload };
}


export function migrateTodayTrendStoreToV2(value, { globalRevision = 1, scopeRevisionByStorageId = {} } = {}) {
    if (value?.version === TODAY_TREND_V2_STORE_VERSION && Object.hasOwn(value, 'globalEnvelope')) {
        return { store: normalizeTodayTrendV2Store(value), migrated: false };
    }
    const source = normalizeTodayTrendStore(value);
    const scopes = {};
    for (const [storageId, scope] of Object.entries(source.scopes)) {
        scopes[storageId] = {
            schemaVersion: SCOPE_ENVELOPE_VERSION,
            revision: safeInteger(scopeRevisionByStorageId[storageId] ?? 1, `scope revision ${storageId}`),
            payload: createScopePayload(scope),
        };
    }
    return {
        migrated: true,
        store: normalizeTodayTrendV2Store({
            version: TODAY_TREND_V2_STORE_VERSION,
            globalEnvelope: {
                schemaVersion: GLOBAL_ENVELOPE_VERSION,
                revision: safeInteger(globalRevision, 'global revision'),
                payload: { presets: clone(source.presets), scopes },
            },
        }),
    };
}

export function normalizeTodayTrendV2Store(value) {
    if (!plainRecord(value)) invalid('v2 store 必须是对象');
    if (value.version > TODAY_TREND_V2_STORE_VERSION) failure('TT_V2_FUTURE_VERSION', `v2 store 版本 ${value.version} 高于当前支持版本 ${TODAY_TREND_V2_STORE_VERSION}`);
    exact(value, ['version', 'globalEnvelope'], 'v2 store');
    if (value.version !== TODAY_TREND_V2_STORE_VERSION) invalid('v2 store 版本无效');
    const envelope = value.globalEnvelope;
    exact(envelope, ['schemaVersion', 'revision', 'payload'], 'global envelope');
    if (envelope.schemaVersion > GLOBAL_ENVELOPE_VERSION) failure('TT_V2_FUTURE_VERSION', 'global envelope 版本高于当前支持版本');
    if (envelope.schemaVersion !== GLOBAL_ENVELOPE_VERSION) invalid('global envelope 版本无效');
    safeInteger(envelope.revision, 'global envelope revision');
    exact(envelope.payload, ['presets', 'scopes'], 'global envelope payload');
    if (!plainRecord(envelope.payload.presets) || !plainRecord(envelope.payload.scopes)) invalid('global envelope 集合无效');
    const presets = clone(envelope.payload.presets);
    const scopes = {};
    for (const [storageId, scopeEnvelope] of Object.entries(envelope.payload.scopes)) {
        const normalized = normalizeScopeEnvelope(scopeEnvelope, presets);
        if (normalized.payload.storageId !== storageId) invalid('scope envelope key 与 storageId 不一致');
        scopes[storageId] = normalized;
    }
    return {
        version: TODAY_TREND_V2_STORE_VERSION,
        globalEnvelope: {
            schemaVersion: GLOBAL_ENVELOPE_VERSION,
            revision: envelope.revision,
            payload: { presets, scopes },
        },
    };
}

function eventMap(dynamics) {
    return new Map([...dynamics.active, ...dynamics.archived].map(event => [event.id, event]));
}

function preserveUnchangedEvents(previousPayload, nextPayload) {
    const previous = eventMap(previousPayload.dynamics);
    const continuous = new Set();
    for (const bucket of ['active', 'archived']) {
        nextPayload.dynamics[bucket] = nextPayload.dynamics[bucket].map(event => {
            const existing = previous.get(event.id);
            if (!existing || !same(projectEventToV1(existing), projectEventToV1(event))) return event;
            continuous.add(event.id);
            return clone(existing);
        });
    }
    return continuous;
}

function preserveUnchangedSnapshots(previousPayload, nextPayload) {
    nextPayload.generationSnapshots = nextPayload.generationSnapshots.map((snapshot, index) => {
        const existing = previousPayload.generationSnapshots[index];
        if (!existing) return snapshot;
        const previousV1 = { ...clone(existing), dynamics: projectDynamicsToV1(existing.dynamics) };
        const nextV1 = { ...clone(snapshot), dynamics: projectDynamicsToV1(snapshot.dynamics) };
        return same(previousV1, nextV1) ? clone(existing) : snapshot;
    });
}

function preserveScopeMetadata(previousPayload, nextPayload, continuous) {
    const previousEvents = eventMap(previousPayload.dynamics);
    const archivedIds = new Set(nextPayload.dynamics.archived.filter(event => continuous.has(event.id)).map(event => event.id));
    const preserve = (source, accept) => Object.fromEntries(Object.entries(source).filter(accept)
        .map(([id, value]) => [id, clone(value)]));
    nextPayload.historyRetentionSettings = clone(previousPayload.historyRetentionSettings);
    nextPayload.historyRetentionState = clone(previousPayload.historyRetentionState);
    nextPayload.stageDetailsByEvent = preserve(previousPayload.stageDetailsByEvent, ([id]) => continuous.has(id));
    nextPayload.archivedRemovableDataByEvent = preserve(previousPayload.archivedRemovableDataByEvent, ([id]) => archivedIds.has(id));
    const eventRecord = ([, value]) => continuous.has(value.eventId);
    nextPayload.removableEntityStateById = preserve(previousPayload.removableEntityStateById, eventRecord);
    nextPayload.removableEntityTombstonesById = preserve(previousPayload.removableEntityTombstonesById, eventRecord);
    nextPayload.fixedCoreBaselineByEvent = Object.fromEntries(nextPayload.dynamics.archived.map(event => {
        const existing = previousEvents.get(event.id);
        const baseline = existing && same(projectEventToV1(existing), projectEventToV1(event))
            ? previousPayload.fixedCoreBaselineByEvent[event.id] : extractArchivedFixedCore(event);
        return [event.id, clone(baseline)];
    }));
}

export function mergeTodayTrendV1StoreIntoV2(currentValue, facadeValue) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const facade = normalizeTodayTrendStore(facadeValue);
    const revisions = Object.fromEntries(Object.entries(current.globalEnvelope.payload.scopes)
        .map(([storageId, envelope]) => [storageId, envelope.revision]));
    const migrated = migrateTodayTrendStoreToV2(facade, {
        globalRevision: current.globalEnvelope.revision, scopeRevisionByStorageId: revisions,
    }).store;
    for (const [storageId, nextEnvelope] of Object.entries(migrated.globalEnvelope.payload.scopes)) {
        const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
        if (!previousEnvelope) continue;
        const continuousEventIds = preserveUnchangedEvents(previousEnvelope.payload, nextEnvelope.payload);
        preserveUnchangedSnapshots(previousEnvelope.payload, nextEnvelope.payload);
        preserveScopeMetadata(previousEnvelope.payload, nextEnvelope.payload, continuousEventIds);
    }
    return normalizeTodayTrendV2Store(migrated);
}

export function applyTodayTrendGenerationToV2(currentValue, storageId, generatedScope, history, {
    trustedStoryDate = null, assistantCount = null, generatedAt = 0, snapshot = true,
} = {}) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const previousEnvelope = current.globalEnvelope.payload.scopes[storageId];
    if (!previousEnvelope) failure('TT_V2_SCHEMA_INVALID', 'canonical scope 不存在');
    const facade = buildReadOnlyShadow(current);
    facade.scopes[storageId] = clone(generatedScope);
    const merged = mergeTodayTrendV1StoreIntoV2(current, facade);
    const envelope = merged.globalEnvelope.payload.scopes[storageId];
    let payload = applyTodayTrendHistoryProducer(envelope.payload, history, {
        trustedStoryDate, assistantCount, previousPayload: previousEnvelope.payload,
    });
    payload.fixedCoreBaselineByEvent = Object.fromEntries(payload.dynamics.archived
        .map(event => [event.id, extractArchivedFixedCore(event)]));
    if (snapshot) payload = appendTodayTrendCanonicalSnapshot(payload, assistantCount, generatedAt);
    envelope.payload = payload;
    return normalizeTodayTrendV2Store(merged);
}

export function rollbackTodayTrendV2Scope(currentValue, storageId, assistantCount) {
    const current = normalizeTodayTrendV2Store(currentValue);
    const envelope = current.globalEnvelope.payload.scopes[storageId];
    if (!envelope) return current;
    envelope.payload = rollbackTodayTrendCanonicalPayload(envelope.payload, assistantCount);
    envelope.payload.fixedCoreBaselineByEvent = Object.fromEntries(envelope.payload.dynamics.archived
        .map(event => [event.id, extractArchivedFixedCore(event)]));
    return normalizeTodayTrendV2Store(current);
}

export function normalizeTodayTrendV2Candidate(value, currentValue = null) {
    if (value?.version === TODAY_TREND_V2_STORE_VERSION && Object.hasOwn(value, 'globalEnvelope')) {
        return normalizeTodayTrendV2Store(value);
    }
    if (currentValue) return mergeTodayTrendV1StoreIntoV2(currentValue, value);
    return migrateTodayTrendStoreToV2(value).store;
}

export function rebaseTodayTrendV2Store(value, globalRevision, scopeRevisionByStorageId = null) {
    const store = normalizeTodayTrendV2Store(value);
    const revision = safeInteger(globalRevision, 'global revision');
    const scopes = {};
    for (const [storageId, envelope] of Object.entries(store.globalEnvelope.payload.scopes)) {
        const scopeRevision = scopeRevisionByStorageId === null ? revision
            : safeInteger(scopeRevisionByStorageId[storageId] ?? 0, `scope revision ${storageId}`);
        scopes[storageId] = { ...envelope, revision: scopeRevision };
    }
    return normalizeTodayTrendV2Store({
        ...store,
        globalEnvelope: { ...store.globalEnvelope, revision, payload: { ...store.globalEnvelope.payload, scopes } },
    });
}

export function buildReadOnlyShadow(value) {
    const store = normalizeTodayTrendV2Store(value);
    const scopes = {};
    for (const [storageId, envelope] of Object.entries(store.globalEnvelope.payload.scopes)) {
        scopes[storageId] = projectScopePayloadToV1(envelope.payload);
    }
    return normalizeTodayTrendStore({ version: 1, presets: clone(store.globalEnvelope.payload.presets), scopes });
}

export function diffReadOnlyShadow(v1Value, v2Value) {
    const expected = JSON.stringify(normalizeTodayTrendStore(v1Value));
    const actual = JSON.stringify(buildReadOnlyShadow(v2Value));
    if (expected === actual) return { equal: true, byteDifference: 0, expectedBytes: expected.length, actualBytes: actual.length };
    return { equal: false, byteDifference: Math.abs(expected.length - actual.length) || 1, expectedBytes: expected.length, actualBytes: actual.length };
}
