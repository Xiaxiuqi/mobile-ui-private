import { normalizeTodayTrendStore } from './today-trend-model.js';

export const TODAY_TREND_V2_STORE_VERSION = 2;
const GLOBAL_ENVELOPE_VERSION = 1;
const SCOPE_ENVELOPE_VERSION = 1;
const LEGACY_STAGE_KIND = 'legacy-stage';
const clone = value => structuredClone(value);
const plainRecord = value => value && typeof value === 'object' && !Array.isArray(value);

function failure(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function safeInteger(value, field, minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) failure('TT_V2_SCHEMA_INVALID', `${field} 必须是大于等于 ${minimum} 的安全整数`);
    return value;
}

function exactKeys(value, keys, field) {
    if (!plainRecord(value)) failure('TT_V2_SCHEMA_INVALID', `${field} 必须是对象`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        failure('TT_V2_SCHEMA_INVALID', `${field} 字段集合无效`);
    }
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

function normalizeLegacyStage(value, eventId, index) {
    exactKeys(value, ['id', 'kind', 'text', 'legacyIndex', 'sourceStageStart', 'sourceStageEnd', 'revision'], 'legacy-stage');
    if (value.id !== legacyStageId(eventId, index) || value.kind !== LEGACY_STAGE_KIND || value.legacyIndex !== index
        || value.sourceStageStart !== index + 1 || value.sourceStageEnd !== index + 1 || value.revision !== 1
        || typeof value.text !== 'string' || !value.text) failure('TT_V2_SCHEMA_INVALID', 'legacy-stage 内容无效');
    return { ...value };
}

function migrateEvent(event, archivedSequence = null) {
    const stages = event.stages.map((text, index) => migrateLegacyStage(event.id, text, index));
    return {
        ...clone(event), stages, capacityCompatibilityPending: stages.length === 40,
        ...(event.lifecycle === 'archived' ? { archivedAtAssistantCount: null, archivedSequence } : {}),
    };
}

function projectEventToV1(event) {
    return {
        id: event.id, type: event.type, lifecycle: event.lifecycle, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: clone(event.participants), stages: event.stages.map(stage => stage.text),
        latestStage: event.latestStage, outcome: event.outcome, finalResult: event.finalResult,
        relatedEventIds: clone(event.relatedEventIds), createdAt: event.createdAt, updatedAt: event.updatedAt,
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
    if (event?.lifecycle !== 'archived') failure('TT_V2_SCHEMA_INVALID', 'fixed core 只能从 archived event 提取');
    return clone({
        id: event.id, type: event.type, lifecycle: event.lifecycle, title: event.title, stageLabel: event.stageLabel,
        origin: event.origin, participants: event.participants, stages: event.stages, latestStage: event.latestStage,
        outcome: event.outcome, finalResult: event.finalResult, relatedEventIds: event.relatedEventIds,
        archivedAtAssistantCount: event.archivedAtAssistantCount, archivedSequence: event.archivedSequence,
        createdAt: event.createdAt, updatedAt: event.updatedAt,
    });
}

function createScopePayload(scope) {
    const dynamics = migrateDynamics(scope.dynamics);
    const generationSnapshots = scope.generationSnapshots.map(snapshot => ({
        ...clone(snapshot), dynamics: migrateDynamics(snapshot.dynamics),
    }));
    const fixedCoreBaselineByEvent = {};
    for (const event of dynamics.archived) fixedCoreBaselineByEvent[event.id] = extractArchivedFixedCore(event);
    return {
        storageId: scope.storageId, characterId: scope.characterId, characterName: scope.characterName, presetId: scope.presetId,
        operation: clone(scope.operation), injection: clone(scope.injection), world: clone(scope.world), reputation: clone(scope.reputation),
        factions: clone(scope.factions), dynamicsSettings: clone(scope.dynamicsSettings), dynamics, generationSnapshots,
        historyRetentionSettings: { archivedDetailLatestEventCount: 2, archivedDetailRetentionFloors: 20, revision: 1 },
        historyRetentionState: { highWaterAssistantCount: null, nextArchivedSequence: dynamics.archived.length + 1, detailPoolRevision: 0, retentionPolicyRevision: 1 },
        stageDetailsByEvent: {}, archivedRemovableDataByEvent: {}, removableEntityStateById: {}, removableEntityTombstonesById: {},
        fixedCoreBaselineByEvent, commitJournal: null,
    };
}

function projectScopePayloadToV1(scope) {
    return {
        storageId: scope.storageId, characterId: scope.characterId, characterName: scope.characterName, presetId: scope.presetId,
        operation: clone(scope.operation), injection: clone(scope.injection), world: clone(scope.world), reputation: clone(scope.reputation),
        factions: clone(scope.factions), dynamicsSettings: clone(scope.dynamicsSettings), dynamics: projectDynamicsToV1(scope.dynamics),
        generationSnapshots: scope.generationSnapshots.map(snapshot => ({ ...clone(snapshot), dynamics: projectDynamicsToV1(snapshot.dynamics) })),
    };
}

function normalizeEventProjection(event, lifecycle, archivedSequence) {
    if (!plainRecord(event) || event.lifecycle !== lifecycle || !Array.isArray(event.stages) || event.stages.length > 40) {
        failure('TT_V2_SCHEMA_INVALID', 'v2 event projection 无效');
    }
    const normalized = clone(event);
    normalized.stages = event.stages.map((stage, index) => normalizeLegacyStage(stage, event.id, index));
    if (event.capacityCompatibilityPending !== (event.stages.length === 40)) failure('TT_V2_SCHEMA_INVALID', 'capacityCompatibilityPending 与 stages 数量不一致');
    if (lifecycle === 'active') {
        if (Object.hasOwn(event, 'archivedSequence') || Object.hasOwn(event, 'archivedAtAssistantCount')) failure('TT_V2_SCHEMA_INVALID', 'active event 不得携带归档字段');
    } else if (event.archivedSequence !== archivedSequence || event.archivedAtAssistantCount !== null) {
        failure('TT_V2_SCHEMA_INVALID', '归档 sequence 或楼层无效');
    }
    return normalized;
}

function normalizeScopeEnvelope(value, presets) {
    exactKeys(value, ['schemaVersion', 'revision', 'payload'], 'scope envelope');
    if (value.schemaVersion !== SCOPE_ENVELOPE_VERSION) failure('TT_V2_SCHEMA_INVALID', 'scope envelope 版本无效');
    safeInteger(value.revision, 'scope envelope revision');
    const payload = clone(value.payload);
    if (!plainRecord(payload) || !plainRecord(payload.dynamics) || !Array.isArray(payload.generationSnapshots)) failure('TT_V2_SCHEMA_INVALID', 'scope payload 无效');
    payload.dynamics = {
        active: payload.dynamics.active.map(event => normalizeEventProjection(event, 'active', null)),
        archived: payload.dynamics.archived.map((event, index) => normalizeEventProjection(event, 'archived', index + 1)),
    };
    payload.generationSnapshots = payload.generationSnapshots.map(snapshot => ({
        ...clone(snapshot),
        dynamics: {
            active: snapshot.dynamics.active.map(event => normalizeEventProjection(event, 'active', null)),
            archived: snapshot.dynamics.archived.map((event, index) => normalizeEventProjection(event, 'archived', index + 1)),
        },
    }));
    const v1Store = normalizeTodayTrendStore({ version: 1, presets, scopes: { [payload.storageId]: projectScopePayloadToV1(payload) } });
    const canonical = createScopePayload(v1Store.scopes[payload.storageId]);
    if (JSON.stringify(payload) !== JSON.stringify(canonical)) failure('TT_V2_SCHEMA_INVALID', 'scope payload 不是规范 v2 迁移结构');
    return { schemaVersion: SCOPE_ENVELOPE_VERSION, revision: value.revision, payload: canonical };
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
    if (!plainRecord(value)) failure('TT_V2_SCHEMA_INVALID', 'v2 store 必须是对象');
    if (value.version > TODAY_TREND_V2_STORE_VERSION) failure('TT_V2_FUTURE_VERSION', `v2 store 版本 ${value.version} 高于当前支持版本 ${TODAY_TREND_V2_STORE_VERSION}`);
    exactKeys(value, ['version', 'globalEnvelope'], 'v2 store');
    if (value.version !== TODAY_TREND_V2_STORE_VERSION) failure('TT_V2_SCHEMA_INVALID', 'v2 store 版本无效');
    const envelope = value.globalEnvelope;
    exactKeys(envelope, ['schemaVersion', 'revision', 'payload'], 'global envelope');
    if (envelope.schemaVersion > GLOBAL_ENVELOPE_VERSION) failure('TT_V2_FUTURE_VERSION', 'global envelope 版本高于当前支持版本');
    if (envelope.schemaVersion !== GLOBAL_ENVELOPE_VERSION) failure('TT_V2_SCHEMA_INVALID', 'global envelope 版本无效');
    safeInteger(envelope.revision, 'global envelope revision');
    exactKeys(envelope.payload, ['presets', 'scopes'], 'global envelope payload');
    if (!plainRecord(envelope.payload.presets) || !plainRecord(envelope.payload.scopes)) failure('TT_V2_SCHEMA_INVALID', 'global envelope 集合无效');
    const presets = clone(envelope.payload.presets);
    const scopes = {};
    for (const [storageId, scopeEnvelope] of Object.entries(envelope.payload.scopes)) {
        const normalized = normalizeScopeEnvelope(scopeEnvelope, presets);
        if (normalized.payload.storageId !== storageId) failure('TT_V2_SCHEMA_INVALID', 'scope envelope key 与 storageId 不一致');
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

export function rebaseTodayTrendV2Store(value, globalRevision) {
    const store = normalizeTodayTrendV2Store(value);
    const revision = safeInteger(globalRevision, 'global revision');
    const scopes = {};
    for (const [storageId, envelope] of Object.entries(store.globalEnvelope.payload.scopes)) {
        scopes[storageId] = { ...envelope, revision };
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
