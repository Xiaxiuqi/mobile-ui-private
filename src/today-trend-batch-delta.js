import { normalizeTodayTrendHistoryProducer } from './today-trend-history-reducer.js';

const exact = (value, keys, path = '$') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        throw new Error(`${path}: 历史批增量字段集合无效；要求 ${keys.join(',')}`);
    }
};
const unique = (items, key = 'id', path = '$') => {
    if (!Array.isArray(items)) throw new Error(`${path}: 历史批增量必须为数组`);
    const ids = new Set();
    for (const item of items) {
        if (typeof item?.[key] !== 'string' || !item[key].trim() || item[key] !== item[key].trim() || ids.has(item[key])) {
            throw new Error(`${path}.${key} [${item?.[key]}]: 历史批增量 ID 无效或重复`);
        }
        ids.add(item[key]);
    }
};
const upsert = (previous, delta, path) => {
    exact(delta, ['upserts'], path);
    unique(delta.upserts, 'id', `${path}.upserts`);
    const result = structuredClone(previous);
    for (const item of delta.upserts) {
        const index = result.findIndex(prior => prior.id === item.id);
        if (index < 0) result.push(item); else result[index] = item;
    }
    return result;
};

// Transport only: never persisted. Existing facade/canonical schemas stay unchanged.
export function materializeTodayTrendBatchDelta(value, scope, timestamp) {
    exact(value, ['world', 'reputation', 'factions', 'dynamics', 'history']);
    exact(value.dynamics, ['create', 'appendStages', 'archive'], 'dynamics');
    exact(value.history, ['events'], 'history');
    unique(value.dynamics.create, 'id', 'dynamics.create');
    unique(value.dynamics.appendStages, 'eventId', 'dynamics.appendStages');
    unique(value.dynamics.archive, 'eventId', 'dynamics.archive');
    unique(value.history.events, 'eventId', 'history.events');
    const dynamics = structuredClone(scope.dynamics);
    const known = new Set([...dynamics.active, ...dynamics.archived].map(event => event.id));
    const producers = new Map();
    for (const item of value.history.events) {
        exact(item, ['eventId', 'daySummaries', 'periodSummaries'], `history.events[${item.eventId}]`);
        producers.set(item.eventId, { ...item, stages: [] });
    }
    const stagesFor = (id, stages, path) => {
        if (!Array.isArray(stages) || !stages.length) throw new Error(`${path} [${id}]: 阶段增量必须为非空字符串数组`);
        stages.forEach((text, index) => {
            if (typeof text !== 'string' || !text.trim() || text.length > 240) {
                throw new Error(`${path}[${index}] [${id}]: 阶段必须为非空字符串，最多240字`);
            }
        });
        const producer = producers.get(id) || { eventId: id, stages: [], daySummaries: [], periodSummaries: [] };
        producer.stages.push(...stages.map(text => ({ text, time: null, timeLabel: null })));
        producers.set(id, producer);
        return stages;
    };

    for (const item of value.dynamics.create) {
        exact(item, ['id', 'type', 'title', 'stageLabel', 'origin', 'participants', 'initialStage', 'relatedEventIds'], `dynamics.create[${item.id}]`);
        if (known.has(item.id)) throw new Error(`dynamics.create[${item.id}].id: 不能重建既有事件`);
        known.add(item.id);
        const stages = stagesFor(item.id, [item.initialStage], `dynamics.create[${item.id}].initialStage`);
        const { initialStage, ...fields } = item;
        dynamics.active.push({ ...fields, stages, latestStage: stages.at(-1), lifecycle: 'active',
            outcome: null, finalResult: null, createdAt: timestamp, updatedAt: timestamp });
    }
    for (const item of value.dynamics.appendStages) {
        exact(item, ['eventId', 'stages'], `dynamics.appendStages[${item.eventId}]`);
        const event = dynamics.active.find(event => event.id === item.eventId);
        if (!event) throw new Error(`dynamics.appendStages[${item.eventId}].eventId: 只能指向 active`);
        event.stages.push(...stagesFor(item.eventId, item.stages, `dynamics.appendStages[${item.eventId}].stages`));
        event.latestStage = event.stages.at(-1);
        event.updatedAt = timestamp;
    }
    for (const item of value.dynamics.archive) {
        exact(item, ['eventId', 'outcome', 'finalResult'], `dynamics.archive[${item.eventId}]`);
        if (!scope.dynamicsSettings.autoComplete || !scope.dynamicsSettings.archiveCompleted) {
            throw new Error(`dynamics.archive[${item.eventId}]: dynamicsSettings.autoComplete/archiveCompleted 不允许归档`);
        }
        if (!dynamics.active.some(event => event.id === item.eventId)) throw new Error(`dynamics.archive[${item.eventId}].eventId: 只能指向 active`);
    }
    const history = normalizeTodayTrendHistoryProducer({ events: [...producers.values()] });
    for (const producer of history.events) {
        const event = dynamics.active.find(event => event.id === producer.eventId);
        if (!event) throw new Error(`history.events[${producer.eventId}].eventId: 只能指向 active`);
        if (producer.stages.length) {
            event.stages.splice(-producer.stages.length, producer.stages.length, ...producer.stages.map(stage => stage.text));
            event.latestStage = event.stages.at(-1);
        }
    }
    return { parsed: { world: { items: upsert(scope.world.items, value.world, 'world') },
        reputation: { circles: upsert(scope.reputation.circles, value.reputation, 'reputation') },
        factions: upsert(scope.factions, value.factions, 'factions'), dynamics, history },
        archives: structuredClone(value.dynamics.archive) };
}
