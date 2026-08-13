import {
    TODAY_TREND_V2_AUTHORITY_KEY, TODAY_TREND_V2_FALLBACK_KEY, TODAY_TREND_V2_JOURNAL_PREFIX, TODAY_TREND_V2_STORAGE_KEY,
} from './constants.js';
import { normalizeTodayTrendStore } from './today-trend-model.js';
import { pmIDBCompareAndSwap, pmIDBReadEntry } from './pm-idb.js';

const AUTHORITY_VERSION = 1;
const ENVELOPE_VERSION = 1;
const CHANNEL_NAME = 'pm-today-trend-v2-authority';
const clone = value => structuredClone(value);
const structurallyEqual = (left, right) => {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length
            && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
        && structurallyEqual(left[key], right[key]));
};

function failure(code, message, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    return error;
}

function nonNegativeInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) throw failure('TT_V2_SCHEMA_INVALID', `${field} 必须是非负安全整数`);
    return value;
}

function normalizeScopeRevisions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('TT_V2_SCHEMA_INVALID', 'scopeRevisionByStorageId 必须是对象');
    const result = Object.create(null);
    for (const [storageId, revision] of Object.entries(value)) {
        if (!storageId || storageId === '__proto__' || storageId === 'constructor' || storageId === 'prototype') {
            throw failure('TT_V2_SCHEMA_INVALID', 'scope revision key 无效');
        }
        result[storageId] = nonNegativeInteger(revision, `scopeRevisionByStorageId.${storageId}`);
    }
    return result;
}

export function normalizeTodayTrendV2Authority(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('TT_V2_SCHEMA_INVALID', 'v2 authority 必须是对象');
    if (value.schemaVersion > AUTHORITY_VERSION) throw failure('TT_V2_FUTURE_VERSION', `v2 authority 版本 ${value.schemaVersion} 高于当前支持版本 ${AUTHORITY_VERSION}`);
    if (value.schemaVersion !== AUTHORITY_VERSION) throw failure('TT_V2_SCHEMA_INVALID', 'v2 authority 版本无效');
    if (value.ownerTabId !== null && (typeof value.ownerTabId !== 'string' || !value.ownerTabId)) throw failure('TT_V2_SCHEMA_INVALID', 'ownerTabId 必须是非空字符串或 null');
    for (const key of ['readV2', 'writeV2', 'serveV2']) if (typeof value[key] !== 'boolean') throw failure('TT_V2_SCHEMA_INVALID', `${key} 必须是布尔值`);
    if (value.writeV2 && !value.ownerTabId) throw failure('TT_V2_SCHEMA_INVALID', 'writeV2 启用时必须存在 ownerTabId');
    return {
        schemaVersion: AUTHORITY_VERSION,
        epoch: nonNegativeInteger(value.epoch, 'epoch'),
        authorityRevision: nonNegativeInteger(value.authorityRevision, 'authorityRevision'),
        storeRevision: nonNegativeInteger(value.storeRevision, 'storeRevision'),
        scopeRevisionByStorageId: normalizeScopeRevisions(value.scopeRevisionByStorageId),
        ownerTabId: value.ownerTabId,
        readV2: value.readV2,
        writeV2: value.writeV2,
        serveV2: value.serveV2,
    };
}

export function createTodayTrendV2Envelope(payload, revision) {
    return { schemaVersion: ENVELOPE_VERSION, revision: nonNegativeInteger(revision, 'revision'), payload: normalizeTodayTrendStore(payload) };
}

export function normalizeTodayTrendV2Envelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('TT_V2_SCHEMA_INVALID', 'v2 store envelope 必须是对象');
    if (value.schemaVersion > ENVELOPE_VERSION) throw failure('TT_V2_FUTURE_VERSION', `v2 store 版本 ${value.schemaVersion} 高于当前支持版本 ${ENVELOPE_VERSION}`);
    if (value.schemaVersion !== ENVELOPE_VERSION) throw failure('TT_V2_SCHEMA_INVALID', 'v2 store 版本无效');
    return createTodayTrendV2Envelope(value.payload, value.revision);
}

function readFallback(storage) {
    try {
        const raw = storage?.getItem(TODAY_TREND_V2_FALLBACK_KEY);
        return raw ? normalizeTodayTrendV2Envelope(JSON.parse(raw)) : null;
    } catch (error) {
        if (error?.code) throw error;
        throw failure('TT_V2_FALLBACK_INVALID', 'v2 fallback 数据不可读', error);
    }
}


function defaultTabId() {
    return globalThis.crypto?.randomUUID?.() || `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function initialAuthority() {
    return {
        schemaVersion: AUTHORITY_VERSION, epoch: 0, authorityRevision: 0, storeRevision: 0,
        scopeRevisionByStorageId: Object.create(null), ownerTabId: null,
        readV2: false, writeV2: false, serveV2: false,
    };
}

export function createTodayTrendV2Authority({
    readEntry = pmIDBReadEntry, compareAndSwap = pmIDBCompareAndSwap,
    storage = globalThis.localStorage, tabId = defaultTabId(), BroadcastChannelImpl = globalThis.BroadcastChannel,
} = {}) {
    if (typeof tabId !== 'string' || !tabId) throw new TypeError('Today Trend v2 tabId 必须是非空字符串');
    let token = null;
    let closed = false;
    let channel = null;
    let mutationQueue = Promise.resolve();
    let pendingMutations = 0;
    const enqueueMutation = operation => {
        pendingMutations += 1;
        const scheduled = mutationQueue.then(operation);
        mutationQueue = scheduled.catch(() => {});
        return scheduled.finally(() => { pendingMutations -= 1; });
    };
    const invalidateToken = () => { if (token) token.lost = true; };
    const closeChannel = () => {
        try { channel?.close?.(); }
        catch {
            // 资源释放失败不改变本地失权状态；CAS 仍会阻止后续写入。
        }
        channel = null;
    };
    const ensureChannel = () => {
        if (channel || typeof BroadcastChannelImpl !== 'function') return;
        try {
            channel = new BroadcastChannelImpl(CHANNEL_NAME);
            channel.addEventListener?.('message', event => {
                const message = event?.data;
                if (!token || !message || message.tabId === tabId) return;
                if (message.epoch >= token.authority.epoch && message.ownerTabId !== tabId) {
                    invalidateToken();
                    closeChannel();
                }
            });
        } catch {
            channel = null;
        }
    };
    const broadcast = authority => {
        try { channel?.postMessage?.({ epoch: authority.epoch, ownerTabId: authority.ownerTabId, tabId }); }
        catch {
            // 通知失败不影响 CAS 正确性；其他标签仍会在下一次写入时由事务比较拒绝。
        }
    };
    const readAuthority = async () => {
        const entry = await readEntry(TODAY_TREND_V2_AUTHORITY_KEY);
        if (!entry?.ok) return { available: false, authority: null };
        return { available: true, authority: entry.value === undefined ? null : normalizeTodayTrendV2Authority(entry.value) };
    };
    const status = async () => {
        const state = await readAuthority();
        return { ...state, owned: !!token && !token.lost && state.authority?.ownerTabId === tabId };
    };
    const load = async () => {
        const state = await readAuthority();
        if (!state.available) throw failure('TT_V2_IDB_UNAVAILABLE', '无法确认 v2 authority 状态');
        if (!state.authority?.readV2 && state.authority?.storeRevision > 0) throw failure('TT_V2_READ_FROZEN', 'v2 store 已存在但读取开关被关闭');
        if (!state.authority?.readV2) return { active: false, store: null, authority: state.authority };
        const primaryEntry = await readEntry(TODAY_TREND_V2_STORAGE_KEY);
        const primary = primaryEntry?.ok && primaryEntry.value !== undefined ? normalizeTodayTrendV2Envelope(primaryEntry.value) : null;
        const fallback = readFallback(storage);
        if (!primary && !fallback) throw failure('TT_V2_STORE_MISSING', 'v2 authority 已启用读取但 store 不存在');
        if (primary && fallback && primary.revision === fallback.revision && !structurallyEqual(primary, fallback)) {
            throw failure('TT_STORAGE_SPLIT_BRAIN', 'v2 主存储与 fallback 在相同 revision 内容不同');
        }
        const envelope = !primary ? fallback : !fallback || primary.revision >= fallback.revision ? primary : fallback;
        if (envelope.revision !== state.authority.storeRevision) throw failure('TT_V2_REVISION_MISMATCH', 'v2 store revision 与 authority 不一致');
        return { active: true, store: clone(envelope.payload), authority: state.authority };
    };
    const acquireInternal = async ({ readV2 = false, writeV2 = false, serveV2 = false, initialStore } = {}) => {
        if (closed) throw failure('TT_AUTHORITY_CLOSED', 'v2 authority owner 已关闭');
        if (typeof readV2 !== 'boolean' || typeof writeV2 !== 'boolean' || typeof serveV2 !== 'boolean') throw new TypeError('v2 开关必须是布尔值');
        if ((writeV2 || serveV2) && !readV2) throw failure('TT_V2_FLAGS_INVALID', 'writeV2/serveV2 启用时 readV2 必须启用');
        const state = await readAuthority();
        if (!state.available) throw failure('TT_V2_IDB_UNAVAILABLE', 'v2 authority 存储不可用');
        const previous = state.authority;
        if (previous?.ownerTabId) {
            if (previous.ownerTabId !== tabId || !token || token.lost) {
                throw failure('TT_AUTHORITY_BUSY', '其他 authority owner 尚未显式释放写入权');
            }
            if (previous.readV2 !== readV2 || previous.writeV2 !== writeV2 || previous.serveV2 !== serveV2) {
                throw failure('TT_AUTHORITY_BUSY', '当前 authority owner 必须先显式释放再变更开关');
            }
            token.authority = previous;
            ensureChannel();
            return clone(previous);
        }
        const base = previous || initialAuthority();
        const activating = readV2 && base.storeRevision === 0;
        if (activating && initialStore === undefined) {
            throw failure('TT_V2_INITIAL_STORE_REQUIRED', '首次启用 v2 读取必须提供初始 store');
        }
        const storeRevision = activating ? 1 : base.storeRevision;
        const next = normalizeTodayTrendV2Authority({
            ...base, epoch: base.epoch + 1, authorityRevision: base.authorityRevision + 1,
            storeRevision, ownerTabId: tabId, readV2, writeV2, serveV2,
        });
        const writes = [];
        if (activating) writes.push({ key: TODAY_TREND_V2_STORAGE_KEY, value: createTodayTrendV2Envelope(initialStore, storeRevision) });
        writes.push({ key: TODAY_TREND_V2_AUTHORITY_KEY, value: next });
        const result = await compareAndSwap({
            guardKey: TODAY_TREND_V2_AUTHORITY_KEY, expectedGuard: previous === null ? undefined : previous,
            writes,
        });
        if (!result?.ok) throw failure(result?.reason === 'CAS_CONFLICT' ? 'TT_AUTHORITY_CONFLICT' : 'TT_V2_IDB_UNAVAILABLE', 'v2 authority 获取失败');
        token = { authority: next, lost: false };
        ensureChannel();
        broadcast(next);
        return clone(next);
    };
    const changedScopes = async (value, declaredScopeIds) => {
        if (declaredScopeIds !== undefined && !Array.isArray(declaredScopeIds)) throw new TypeError('changedScopeIds 必须是字符串数组');
        const declared = declaredScopeIds === undefined ? null : [...new Set(declaredScopeIds)];
        if (declared?.some(storageId => typeof storageId !== 'string' || !storageId)) throw new TypeError('changedScopeIds 必须只包含非空字符串');
        const entry = await readEntry(TODAY_TREND_V2_STORAGE_KEY);
        if (!entry?.ok || entry.value === undefined) throw failure('TT_V2_IDB_UNAVAILABLE', '无法读取当前 v2 store 以计算 scope revision');
        const current = normalizeTodayTrendV2Envelope(entry.value).payload;
        const candidate = normalizeTodayTrendStore(value);
        const ids = new Set([...Object.keys(current.scopes), ...Object.keys(candidate.scopes)]);
        const actual = [...ids].filter(storageId => !structurallyEqual(current.scopes[storageId], candidate.scopes[storageId])).sort();
        if (declared && !structurallyEqual([...declared].sort(), actual)) {
            throw failure('TT_SCOPE_REVISION_MISMATCH', '声明的 scope 变更范围与实际 candidate 不一致');
        }
        return actual;
    };
    const saveInternal = async (value, { scopeId = null, changedScopeIds, expectedStoreRevision = null, journalWrite = null } = {}) => {
        if (closed) throw failure('TT_AUTHORITY_CLOSED', 'v2 authority owner 已关闭');
        if (!token || token.lost || token.authority.ownerTabId !== tabId || !token.authority.writeV2) {
            throw failure('TT_AUTHORITY_LOST', '当前标签不具备 v2 写入权威');
        }
        if (scopeId !== null && (typeof scopeId !== 'string' || !scopeId)) throw new TypeError('scopeId 必须是非空字符串或 null');
        if (journalWrite !== null && (!journalWrite || typeof journalWrite.key !== 'string'
            || !journalWrite.key.startsWith(TODAY_TREND_V2_JOURNAL_PREFIX) || !Object.hasOwn(journalWrite, 'value'))) {
            throw new TypeError('journalWrite 必须是受控 Today Trend journal 写入');
        }
        const previous = token.authority;
        if (expectedStoreRevision !== null && expectedStoreRevision !== previous.storeRevision) {
            throw failure('TT_STORE_REVISION_CONFLICT', 'v2 store 已在当前提交后发生变化，拒绝覆盖');
        }
        const affectedScopeIds = await changedScopes(value, changedScopeIds === undefined && scopeId !== null ? [scopeId] : changedScopeIds);
        const scopeRevisions = { ...previous.scopeRevisionByStorageId };
        for (const storageId of affectedScopeIds) scopeRevisions[storageId] = (scopeRevisions[storageId] || 0) + 1;
        const next = normalizeTodayTrendV2Authority({
            ...previous, authorityRevision: previous.authorityRevision + 1, storeRevision: previous.storeRevision + 1,
            scopeRevisionByStorageId: scopeRevisions,
        });
        const envelope = createTodayTrendV2Envelope(value, next.storeRevision);
        const writes = [
            { key: TODAY_TREND_V2_STORAGE_KEY, value: envelope },
            { key: TODAY_TREND_V2_AUTHORITY_KEY, value: next },
        ];
        if (journalWrite) writes.push(clone(journalWrite));
        const result = await compareAndSwap({
            guardKey: TODAY_TREND_V2_AUTHORITY_KEY, expectedGuard: previous,
            writes,
        });
        if (!result?.ok) {
            invalidateToken();
            throw failure(result?.reason === 'CAS_CONFLICT' ? 'TT_AUTHORITY_LOST' : 'TT_V2_IDB_UNAVAILABLE', 'v2 store CAS 保存失败');
        }
        token.authority = next;
        try { storage?.removeItem?.(TODAY_TREND_V2_FALLBACK_KEY); }
        catch {
            // fallback 清理失败不会改变已由 IDB 事务提交的权威 revision。
        }
        broadcast(next);
        return {
            store: clone(envelope.payload),
            storeRevision: next.storeRevision,
            authorityRevision: next.authorityRevision,
            scopeRevisionByStorageId: clone(next.scopeRevisionByStorageId),
        };
    };
    const releaseInternal = async ({ readV2, serveV2 } = {}) => {
        if (closed) throw failure('TT_AUTHORITY_CLOSED', 'v2 authority owner 已关闭');
        if (!token) { closeChannel(); return false; }
        const previous = token.authority;
        const nextReadV2 = readV2 === undefined ? previous.storeRevision > 0 : readV2;
        const nextServeV2 = serveV2 === undefined ? false : serveV2;
        if (typeof nextReadV2 !== 'boolean' || typeof nextServeV2 !== 'boolean') throw new TypeError('release 开关必须是布尔值');
        if (nextServeV2 && !nextReadV2) throw failure('TT_V2_FLAGS_INVALID', 'serveV2 启用时 readV2 必须启用');
        const next = normalizeTodayTrendV2Authority({
            ...previous, epoch: previous.epoch + 1, authorityRevision: previous.authorityRevision + 1,
            ownerTabId: null, readV2: nextReadV2, writeV2: false, serveV2: nextServeV2,
        });
        const result = await compareAndSwap({
            guardKey: TODAY_TREND_V2_AUTHORITY_KEY, expectedGuard: previous,
            writes: [{ key: TODAY_TREND_V2_AUTHORITY_KEY, value: next }],
        });
        if (result?.ok) {
            invalidateToken();
            token = null;
            broadcast(next);
            closeChannel();
            return true;
        }
        if (result?.reason === 'CAS_CONFLICT') {
            const current = await readAuthority();
            if (current.available && current.authority?.ownerTabId === tabId) {
                token = { authority: current.authority, lost: false };
                ensureChannel();
                throw failure('TT_AUTHORITY_CONFLICT', 'v2 authority 释放发生并发冲突，请重试');
            }
            invalidateToken();
            token = null;
            closeChannel();
            throw failure('TT_AUTHORITY_LOST', 'v2 authority 释放时已失权');
        }
        throw failure('TT_V2_IDB_UNAVAILABLE', 'v2 authority 释放失败');
    };
    const acquire = options => enqueueMutation(() => acquireInternal(options));
    const save = (value, options) => enqueueMutation(() => saveInternal(value, options));
    const release = options => enqueueMutation(() => releaseInternal(options));
    const close = () => {
        if (pendingMutations > 0 || (token && !token.lost)) {
            throw failure('TT_AUTHORITY_BUSY', '关闭 authority owner 前必须等待 mutation 完成并显式 release');
        }
        closed = true;
        invalidateToken();
        token = null;
        closeChannel();
    };
    return { status, load, acquire, save, release, close };
}
