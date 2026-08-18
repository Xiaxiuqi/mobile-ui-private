const clone = value => structuredClone(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const exact = (value, keys, label) => {
    if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
        fail('TT_HISTORY_SCHEMA_INVALID', `${label}字段集合无效`);
    }
};
const text = (value, label, max = 240) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail('TT_HISTORY_SCHEMA_INVALID', `${label}无效`);
    return value.trim();
};
const nullableText = (value, label, max = 120) => value === null ? null : text(value, label, max);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === 'string' && datePattern.test(value)
    && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const projectionText = stage => ['day-summary', 'period-summary', 'span-stage'].includes(stage.kind) ? stage.summary : stage.text;
const availableState = (entityType, entityId, eventId) => ({
    entityType, entityId, eventId, state: 'available', removalReason: null, removedAtAssistantCount: null, policyRevision: 1,
});

function normalizeIdArray(value, label, max) {
    if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item)) {
        fail('TT_HISTORY_SCHEMA_INVALID', `${label}无效`);
    }
    if (new Set(value).size !== value.length) fail('TT_HISTORY_SCHEMA_INVALID', `${label}不得重复`);
    return [...value];
}

function normalizeStage(value) {
    exact(value, ['text', 'time', 'timeLabel'], 'history stage');
    return { text: text(value.text, 'history stage.text', 600), time: nullableText(value.time, 'history stage.time', 5),
        timeLabel: nullableText(value.timeLabel, 'history stage.timeLabel', 40) };
}

function normalizeDaySummary(value) {
    exact(value, ['summaryText', 'keyStages'], 'day summary producer');
    return { summaryText: text(value.summaryText, 'day summary producer.summaryText'),
        keyStages: normalizeIdArray(value.keyStages, 'day summary producer.keyStages', 8) };
}

function normalizePeriodSummary(value) {
    exact(value, ['summaryText', 'startDate', 'endDate', 'childSummaryRefs'], 'period summary producer');
    if (!validDate(value.startDate) || !validDate(value.endDate) || value.startDate > value.endDate) {
        fail('TT_HISTORY_SCHEMA_INVALID', 'period summary producer 日期区间无效');
    }
    const days = Math.floor((new Date(`${value.endDate}T12:00:00Z`) - new Date(`${value.startDate}T12:00:00Z`)) / 86400000) + 1;
    if (days > 7) fail('TT_HISTORY_LIMIT_EXCEEDED', 'period summary producer 跨度超过 7 日');
    return { summaryText: text(value.summaryText, 'period summary producer.summaryText'), startDate: value.startDate,
        endDate: value.endDate, childSummaryRefs: normalizeIdArray(value.childSummaryRefs, 'period summary producer.childSummaryRefs', 24) };
}


export function normalizeTodayTrendHistoryProducer(value) {
    exact(value, ['events'], 'history producer');
    if (!Array.isArray(value.events) || value.events.length > 80) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer.events 无效');
    const ids = new Set();
    const events = value.events.map(item => {
        exact(item, ['eventId', 'stages', 'daySummaries', 'periodSummaries'], 'history event producer');
        const eventId = text(item.eventId, 'history event producer.eventId', 120);
        if (ids.has(eventId)) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer eventId 不得重复');
        ids.add(eventId);
        if (!Array.isArray(item.stages) || !Array.isArray(item.daySummaries) || !Array.isArray(item.periodSummaries)) {
            fail('TT_HISTORY_SCHEMA_INVALID', 'history event producer 数组无效');
        }
        if (item.daySummaries.length > 1) fail('TT_HISTORY_LIMIT_EXCEEDED', '单个 event 每轮最多产出一个 day summary');
        return {
            eventId,
            stages: item.stages.map(normalizeStage),
            daySummaries: item.daySummaries.map(normalizeDaySummary),
            periodSummaries: item.periodSummaries.map(normalizePeriodSummary),
        };
    });
    return { events };
}

const allEvents = dynamics => [...dynamics.active, ...dynamics.archived];
const mapEvents = dynamics => new Map(allEvents(dynamics).map(event => [event.id, event]));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function assertProducerLimits(producer, payload) {
    const eventCount = allEvents(payload.dynamics).length;
    const dayCount = producer.events.reduce((count, item) => count + item.daySummaries.length, 0);
    const periodCount = producer.events.reduce((count, item) => count + item.periodSummaries.length, 0);
    if (dayCount > Math.floor(eventCount / 2)) fail('TT_HISTORY_LIMIT_EXCEEDED', 'day summaries 超过 events / 2');
    if (periodCount > Math.floor(dayCount / 3)) fail('TT_HISTORY_LIMIT_EXCEEDED', 'period summaries 超过 day summaries / 3');
}

function appendStageProjections(event, stages, storyDate, floor) {
    let sequence = event.stages.reduce((maximum, stage) => Math.max(maximum, stage.sourceStageEnd), 0);
    let undatedSequence = event.stages.reduce((maximum, stage) => Math.max(maximum,
        stage.kind === 'undated-stage' ? stage.undatedSequence : 0), 0);
    for (const stage of stages) {
        sequence += 1;
        event.stages.push(storyDate === null ? {
            id: `undated:${event.id}:${++undatedSequence}`, kind: 'undated-stage', storyDate: null,
            time: stage.time, timeLabel: stage.timeLabel, text: stage.text, undatedSequence,
            sourceStageStart: sequence, sourceStageEnd: sequence, sourceFloorStart: floor, sourceFloorEnd: floor, revision: 1,
        } : {
            id: `live:${event.id}:${sequence}`, kind: 'live-stage', storyDate,
            time: stage.time, timeLabel: stage.timeLabel, text: stage.text,
            sourceStageStart: sequence, sourceStageEnd: sequence, sourceFloorStart: floor, sourceFloorEnd: floor, revision: 1,
        });
    }
}


function closeLiveDate(event, storyDate, summary, payload, knownEventIds) {
    const indexes = event.stages.map((stage, index) => stage.kind === 'live-stage' && stage.storyDate === storyDate ? index : -1)
        .filter(index => index >= 0);
    if (!indexes.length) return false;
    if (!summary) fail('TT_HISTORY_SUMMARY_REQUIRED', '日期前进时缺少旧日期摘要');
    if (indexes.length > 8) fail('TT_HISTORY_LIMIT_EXCEEDED', 'day summary stages 超过 8');
    if (summary.keyStages.some(id => !knownEventIds.has(id))) {
        fail('TT_HISTORY_UNKNOWN_KEY_STAGE', 'day summary keyStages 指向未知 event ID');
    }
    const live = indexes.map(index => event.stages[index]);
    const times = live.map(stage => stage.time).filter(Boolean).sort();
    const labels = [...new Set(live.map(stage => stage.timeLabel).filter(Boolean))];
    const details = payload.stageDetailsByEvent[event.id] ? [...payload.stageDetailsByEvent[event.id]] : [];
    const detailRefs = [];
    for (const stage of live) {
        const id = `detail:${event.id}:${stage.sourceStageStart}`;
        const detail = { id, sourceStageSequence: stage.sourceStageStart, text: stage.text, storyDate };
        const existing = details.find(item => item.id === id);
        if (existing && !same(existing, detail)) fail('TT_HISTORY_SCHEMA_INVALID', 'stage detail 稳定 ID 内容冲突');
        if (!existing) details.push(detail);
        payload.removableEntityStateById[id] = availableState('detail', id, event.id);
        detailRefs.push(id);
    }
    const dayId = `day:${event.id}:${storyDate}`;
    const day = {
        id: dayId, kind: 'day-summary', status: 'closed', storyDate,
        timeRange: { start: times[0] || null, end: times.at(-1) || null, label: times.length ? null : labels.join('、') || null },
        summary: summary.summaryText, keyStages: summary.keyStages, detailRefs, detailCount: live.length,
        sourceStageStart: live[0].sourceStageStart, sourceStageEnd: live.at(-1).sourceStageEnd,
        sourceFloorStart: live[0].sourceFloorStart, sourceFloorEnd: live.at(-1).sourceFloorEnd, revision: 1,
    };
    const first = indexes[0], indexSet = new Set(indexes);
    event.stages = event.stages.flatMap((stage, index) => index === first ? [day] : indexSet.has(index) ? [] : [stage]);
    payload.stageDetailsByEvent[event.id] = details.sort((a, b) => a.sourceStageSequence - b.sourceStageSequence || a.id.localeCompare(b.id));
    payload.removableEntityStateById[dayId] = availableState('day-summary', dayId, event.id);
    return true;
}

function latestKnownDate(event) {
    const dates = event.stages.flatMap(stage => {
        if (stage.kind === 'live-stage' || stage.kind === 'day-summary') return [stage.storyDate];
        if (stage.kind === 'period-summary' || stage.kind === 'span-stage') return [stage.endDate];
        return [];
    });
    return dates.sort().at(-1) || null;
}

function openLiveDate(event) {
    const dates = [...new Set(event.stages.filter(stage => stage.kind === 'live-stage').map(stage => stage.storyDate))];
    if (dates.length > 1) fail('TT_DATE_CONFLICT', 'event 同时存在多个开放日期');
    return dates[0] || null;
}

function assertStageAlignment(previousEvent, candidateEvent, producerStages) {
    const previousText = previousEvent ? previousEvent.stages.map(projectionText) : [];
    const candidateText = candidateEvent.stages.map(projectionText);
    if (candidateText.length !== previousText.length + producerStages.length
        || previousText.some((value, index) => candidateText[index] !== value)
        || producerStages.some((stage, index) => candidateText[previousText.length + index] !== stage.text)) {
        fail('TT_HISTORY_STAGE_MISMATCH', 'history producer 与 dynamics stage 追加不一致');
    }
}

export function applyTodayTrendHistoryProducer(payloadValue, producerValue, {
    trustedStoryDate = null, assistantCount = null, previousPayload = null,
} = {}) {
    if (trustedStoryDate !== null && !validDate(trustedStoryDate)) fail('TT_DATE_CONFLICT', '可信 storyDate 格式无效');
    const payload = clone(payloadValue);
    const producer = normalizeTodayTrendHistoryProducer(producerValue);
    assertProducerLimits(producer, payload);
    const candidates = mapEvents(payload.dynamics);
    const previous = previousPayload ? mapEvents(previousPayload.dynamics) : new Map();
    const producedIds = new Set(producer.events.map(item => item.eventId));
    const knownEventIds = new Set(candidates.keys());
    for (const event of candidates.values()) {
        const prior = previous.get(event.id);
        const priorText = prior ? prior.stages.map(projectionText) : [];
        const candidateText = event.stages.map(projectionText);
        const historyChanged = candidateText.length !== priorText.length
            || priorText.some((value, index) => candidateText[index] !== value);
        if (historyChanged && !producedIds.has(event.id)) {
            fail('TT_HISTORY_STAGE_MISMATCH', 'dynamics stage 变化缺少对应 history producer');
        }
    }
    for (const item of producer.events) {
        const event = candidates.get(item.eventId);
        if (!event || event.lifecycle !== 'active') fail('TT_HISTORY_UNKNOWN_EVENT', 'history producer 只能指向当前 active event');
        const prior = previous.get(item.eventId) || null;
        if (prior && previousPayload) {
            const oldDetails = previousPayload.stageDetailsByEvent?.[item.eventId];
            if (oldDetails) payload.stageDetailsByEvent[item.eventId] = clone(oldDetails);
            for (const field of ['removableEntityStateById', 'removableEntityTombstonesById']) {
                const source = previousPayload[field] || {};
                const target = payload[field];
                for (const [id, state] of Object.entries(source)) {
                    if (state.eventId === item.eventId) target[id] = clone(state);
                }
            }
        }
        assertStageAlignment(prior, event, item.stages);
        event.stages = prior ? clone(prior.stages) : [];
        const knownDate = latestKnownDate(event);
        const openDate = openLiveDate(event);
        if (trustedStoryDate !== null && knownDate !== null && trustedStoryDate < knownDate) {
            fail('TT_DATE_REGRESSION', '可信 storyDate 早于 event 历史日期');
        }
        const requiresSummary = trustedStoryDate !== null && openDate !== null && trustedStoryDate > openDate;
        if (item.daySummaries.length !== (requiresSummary ? 1 : 0)) {
            fail('TT_DATE_CONFLICT', requiresSummary ? '日期前进必须恰好提供一个 day summary' : '当前日期没有可封闭的 live-stage');
        }
        if (requiresSummary) closeLiveDate(event, openDate, item.daySummaries[0], payload, knownEventIds);
        appendStageProjections(event, item.stages, trustedStoryDate, Number.isSafeInteger(assistantCount) ? assistantCount : null);
        if (!event.stages.length) fail('TT_HISTORY_SCHEMA_INVALID', 'history producer 不得产生空 event 历史');
        event.latestStage = projectionText(event.stages.at(-1));
        event.capacityCompatibilityPending = event.stages.length === 40;
    }
    return payload;
}

function snapshotFromPayload(payload, assistantCount, generatedAt) {
    return {
        assistantCount, generatedAt,
        world: clone(payload.world), reputation: clone(payload.reputation), factions: clone(payload.factions),
        dynamicsSettings: clone(payload.dynamicsSettings), dynamics: clone(payload.dynamics),
    };
}

export function appendTodayTrendCanonicalSnapshot(payloadValue, assistantCount, generatedAt) {
    const payload = clone(payloadValue);
    const floor = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const timestamp = Number.isFinite(generatedAt) && generatedAt >= 0 ? Math.floor(generatedAt) : 0;
    const snapshots = [...payload.generationSnapshots.filter(item => item.assistantCount !== floor), snapshotFromPayload(payload, floor, timestamp)]
        .sort((left, right) => left.assistantCount - right.assistantCount);
    const baseline = snapshots.find(item => item.assistantCount === 0);
    payload.generationSnapshots = baseline
        ? [baseline, ...snapshots.filter(item => item.assistantCount !== 0).slice(-11)]
        : snapshots.slice(-12);
    return payload;
}

function alignRollbackRemovableContainers(payload) {
    const events = allEvents(payload.dynamics);
    const eventIds = new Set(events.map(event => event.id));
    const archivedIds = new Set(payload.dynamics.archived.map(event => event.id));
    const bodyIds = new Set();
    const detailRefsByEvent = new Map();
    for (const event of events) {
        const refs = new Set();
        for (const stage of event.stages) {
            if (stage.kind !== 'day-summary') continue;
            bodyIds.add(stage.id);
            for (const ref of stage.detailRefs) refs.add(ref);
        }
        detailRefsByEvent.set(event.id, refs);
    }
    payload.stageDetailsByEvent = Object.fromEntries(Object.entries(payload.stageDetailsByEvent || {}).flatMap(([eventId, details]) => {
        const refs = detailRefsByEvent.get(eventId);
        if (!refs) return [];
        const retained = details.filter(detail => refs.has(detail.id));
        for (const detail of retained) bodyIds.add(detail.id);
        return retained.length ? [[eventId, retained]] : [];
    }));
    payload.archivedRemovableDataByEvent = Object.fromEntries(Object.entries(payload.archivedRemovableDataByEvent || {})
        .filter(([eventId]) => archivedIds.has(eventId))
        .map(([eventId, container]) => {
            for (const id of Object.keys(container.daySummariesById || {})) bodyIds.add(id);
            for (const id of Object.keys(container.manifestsById || {})) bodyIds.add(id);
            return [eventId, container];
        }));
    const states = payload.removableEntityStateById || {};
    const tombstones = payload.removableEntityTombstonesById || {};
    payload.removableEntityStateById = Object.fromEntries(Object.entries(states).filter(([id, state]) => {
        if (!eventIds.has(state.eventId)) return false;
        if (state.state === 'available') return bodyIds.has(id);
        return state.state === 'removed' && !bodyIds.has(id) && tombstones[id] !== undefined;
    }));
    payload.removableEntityTombstonesById = Object.fromEntries(Object.entries(tombstones)
        .filter(([id, tombstone]) => payload.removableEntityStateById[id]?.state === 'removed'
            && tombstone.eventId === payload.removableEntityStateById[id].eventId));
    return payload;
}

export function rollbackTodayTrendCanonicalPayload(payloadValue, assistantCount) {
    const payload = clone(payloadValue);
    const floor = Number.isSafeInteger(assistantCount) && assistantCount >= 0 ? assistantCount : 0;
    const snapshot = payload.generationSnapshots.filter(item => item.assistantCount <= floor).at(-1);
    if (!snapshot) return payload;
    Object.assign(payload, {
        world: clone(snapshot.world), reputation: clone(snapshot.reputation), factions: clone(snapshot.factions),
        dynamicsSettings: clone(snapshot.dynamicsSettings), dynamics: clone(snapshot.dynamics),
        operation: { ...payload.operation, lastSuccessfulAssistantCount: snapshot.assistantCount, lastSuccessfulRunAt: snapshot.generatedAt },
        generationSnapshots: payload.generationSnapshots.filter(item => item.assistantCount <= snapshot.assistantCount),
    });
    return alignRollbackRemovableContainers(payload);
}
