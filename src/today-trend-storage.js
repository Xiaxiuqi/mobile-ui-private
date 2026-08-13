import { TODAY_TREND_FALLBACK_KEY, TODAY_TREND_STORAGE_KEY } from './constants.js';
import { createEmptyTodayTrendStore, migrateTodayTrendStore, normalizeTodayTrendStore } from './today-trend-model.js';
import { pmIDBGet, pmIDBSet } from './pm-idb.js';
import { todayTrendJournal } from './today-trend-journal.js';
import { createTodayTrendV2Authority } from './today-trend-v2-authority.js';

export const TODAY_TREND_STORAGE_KEYS = Object.freeze({ primary: TODAY_TREND_STORAGE_KEY, fallback: TODAY_TREND_FALLBACK_KEY });

const clone = value => structuredClone(value);

function readFallback(storage) {
    try {
        const raw = storage?.getItem(TODAY_TREND_FALLBACK_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[phone-mode] 今日风向后备数据读取失败', error);
        return null;
    }
}

function normalizeLoaded(value) {
    return migrateTodayTrendStore(value).store;
}

export function createTodayTrendStorage({
    idbGet = pmIDBGet, idbSet = pmIDBSet, storage = globalThis.localStorage,
    v2Authority = createTodayTrendV2Authority({ storage }), journal = null,
} = {}) {
    const load = async () => {
        const v2 = await v2Authority.load();
        if (v2.active) return normalizeTodayTrendStore(v2.store);
        try {
            const primary = await idbGet(TODAY_TREND_STORAGE_KEY);
            if (primary !== null && primary !== undefined) return normalizeLoaded(primary);
        } catch (error) {
            console.warn('[phone-mode] 今日风向主存储读取失败', error);
        }
        const fallback = readFallback(storage);
        if (fallback !== null) {
            try { return normalizeLoaded(fallback); }
            catch (error) { console.warn('[phone-mode] 今日风向后备数据无效', error); }
        }
        return createEmptyTodayTrendStore();
    };

    const save = async (value, options = {}) => {
        if (journal) { await journal.ready(); journal.assertWritable(options.transactionId ?? null); }
        const normalized = normalizeTodayTrendStore(value);
        const v2 = await v2Authority.status();
        if (!v2.available) {
            const error = new Error('无法确认 v2 authority 状态，拒绝降级写入 v1');
            error.code = 'TT_V2_AUTHORITY_UNAVAILABLE';
            throw error;
        }
        let acquiredForOperation = false;
        const previousFlags = v2.authority ? { readV2: v2.authority.readV2, serveV2: v2.authority.serveV2 } : null;
        if (options.allowAuthorityAcquire && v2.authority && !v2.owned) {
            if (v2.authority.ownerTabId) {
                const error = new Error('其他标签当前持有 v2 写入权威');
                error.code = 'TT_AUTHORITY_BUSY';
                throw error;
            }
            await v2Authority.acquire({
                readV2: true, writeV2: true, serveV2: v2.authority.serveV2,
                initialStore: v2.authority.storeRevision === 0 ? normalized : undefined,
            });
            acquiredForOperation = true;
        }
        if (v2.authority?.writeV2 || acquiredForOperation) {
            let result;
            let operationError = null;
            try {
                result = await v2Authority.save(normalized, options);
            } catch (error) {
                operationError = error;
            }
            let releaseError = null;
            if (acquiredForOperation) {
                try {
                    const released = await v2Authority.release(previousFlags || undefined);
                    if (released !== true) {
                        const error = new Error('临时 authority 未确认释放成功');
                        error.code = 'TT_AUTHORITY_RELEASE_FAILED';
                        releaseError = error;
                    }
                }
                catch (error) { releaseError = error; }
            }
            if (operationError) {
                if (releaseError) operationError.releaseError = releaseError;
                throw operationError;
            }
            if (releaseError) {
                const error = new Error(`今日风向保存成功，但临时 authority 释放失败：${releaseError.message}`, { cause: releaseError });
                error.code = 'TT_AUTHORITY_RELEASE_FAILED';
                error.committedReceipt = result;
                throw error;
            }
            return options.returnReceipt ? result : result.store;
        }
        if (v2.authority && (v2.authority.readV2 || v2.authority.storeRevision > 0)) {
            const error = new Error('v2 authority 已冻结 v1 写入');
            error.code = v2.authority.ownerTabId ? 'TT_AUTHORITY_LOST' : 'TT_V1_WRITE_FROZEN';
            throw error;
        }
        if (options.transactionId || options.journalWrite) {
            const error = new Error('Today Trend 可恢复事务要求 v2 authority 写入，禁止降级到 v1 或 localStorage');
            error.code = 'TT_SAGA_REQUIRES_V2';
            throw error;
        }
        const snapshot = clone(normalized);
        if (await idbSet(TODAY_TREND_STORAGE_KEY, snapshot)) {
            try { storage?.removeItem(TODAY_TREND_FALLBACK_KEY); }
            catch (error) { console.warn('[phone-mode] 今日风向后备数据清理失败', error); }
            return snapshot;
        }
        try {
            if (!storage || typeof storage.setItem !== 'function') throw new Error('localStorage 不可用');
            storage.setItem(TODAY_TREND_FALLBACK_KEY, JSON.stringify(snapshot));
            return snapshot;
        } catch (error) {
            throw new Error('今日风向保存失败：浏览器存储不可用', { cause: error });
        }
    };

    const status = () => v2Authority.status();
    return { load, save, status, v2Authority, journal };
}

const defaultStorage = createTodayTrendStorage({ journal: todayTrendJournal });
export const loadTodayTrendStore = () => defaultStorage.load();
export const saveTodayTrendStore = (value, options) => defaultStorage.save(value, options);
export const getTodayTrendStorageStatus = () => defaultStorage.status();
export const todayTrendV2Authority = defaultStorage.v2Authority;
export { todayTrendJournal };
