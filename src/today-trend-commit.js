import { enqueueDirectoryOperation } from './directory-save-coordinator.js';
import { getTodayTrendStorageStatus, loadTodayTrendStore, saveTodayTrendStore, todayTrendJournal } from './today-trend-storage.js';
import { normalizeTodayTrendStore } from './today-trend-model.js';
import { todayTrendStoreDigest } from './today-trend-journal.js';

const clone = value => structuredClone(value);

const changedScopeIds = (previous, candidate) => [...new Set([
    ...Object.keys(previous.scopes || {}), ...Object.keys(candidate.scopes || {}),
])].filter(id => JSON.stringify(previous.scopes?.[id]) !== JSON.stringify(candidate.scopes?.[id])).sort();

function injectionFailure(result) {
    if (!result) return null;
    const failedWrites = Number.isInteger(result.failedWrites) ? result.failedWrites : 0;
    const failedKeys = Array.isArray(result.failedKeys) ? result.failedKeys.length : 0;
    return failedWrites || failedKeys ? new Error(`今日风向注入刷新失败：${failedWrites + failedKeys} 项写入或清理失败`) : null;
}

function savedStore(result, fallback) {
    return result && typeof result === 'object' && Object.hasOwn(result, 'store')
        ? normalizeTodayTrendStore(result.store)
        : normalizeTodayTrendStore(result ?? fallback);
}

export function createTodayTrendCommitter({
    runtime = {}, load = loadTodayTrendStore, save = saveTodayTrendStore, refreshInjection, prepareInjection,
    storageStatus = getTodayTrendStorageStatus, journal: journalOption,
} = {}) {
    const journal = journalOption === undefined && load === loadTodayTrendStore && save === saveTodayTrendStore
        ? todayTrendJournal : journalOption;
    let generation = 0;
    let recoveryPromise = null;
    const active = task => !task || task.active?.() !== false;
    const invalidateCommits = () => { generation += 1; };

    const refresh = async store => {
        const result = await refreshInjection?.(store);
        const error = injectionFailure(result);
        if (error) throw error;
        return result;
    };

    const block = async (entry, error) => {
        try { await journal.markBlocked(entry, error); } catch (journalError) { error.journalError = journalError; }
        delete runtime.pendingInjectionStore;
        throw error;
    };

    const compensate = async (entry, previous, expectedStoreRevision, original) => {
        try {
            const compensation = journal.atomicTransition(entry, 'compensation-store-written', {
                compensationStoreRevision: expectedStoreRevision + 1,
            });
            const rolledBack = await save(previous, {
                scopeId: entry.scopeId,
                changedScopeIds: entry.affectedScopeIds,
                expectedStoreRevision,
                transactionId: entry.transactionId,
                journalWrite: compensation,
                returnReceipt: true,
            });
            entry = journal.acceptAtomicTransition(compensation.value);
            runtime.pendingInjectionStore = previous;
            runtime.store = savedStore(rolledBack, previous);
            await refresh(previous);
            delete runtime.pendingInjectionStore;
            await journal.complete(entry, 'rejected', {
                lastErrorCode: String(original?.code || original?.name || 'TT_REJECTED'),
            });
            return false;
        } catch (rollbackError) {
            const message = original?.message || 'Today Trend 恢复要求补偿';
            const combined = new Error(`${message}；今日风向状态回滚失败：${rollbackError.message}`);
            combined.cause = original;
            combined.rollbackError = rollbackError;
            return block(entry, combined);
        }
    };

    const recoverEntry = async entry => {
        if (entry.phase === 'blocked') return false;
        const status = await storageStatus();
        const current = normalizeTodayTrendStore(await load());
        const revision = status.authority?.storeRevision;
        const digest = todayTrendStoreDigest(current);
        if (entry.phase === 'pending' || entry.phase === 'prepared') {
            if (revision === entry.baseStoreRevision && digest === entry.previousDigest) {
                await journal.complete(entry, 'rejected');
                runtime.store = current;
                return true;
            }
            const error = Object.assign(new Error('Today Trend prepared journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
            return block(entry, error);
        }
        if (status.authority?.ownerTabId && !status.owned) {
            const error = Object.assign(new Error('Today Trend 恢复被崩溃或其他标签的 authority owner 阻断'), { code: 'TT_RECOVERY_AUTHORITY_BUSY' });
            return block(entry, error);
        }
        if (entry.phase === 'compensation-store-written') {
            if (revision !== entry.compensationStoreRevision || digest !== entry.previousDigest) {
                const error = Object.assign(new Error('Today Trend 补偿 journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
                return block(entry, error);
            }
            runtime.pendingInjectionStore = entry.previous;
            runtime.store = current;
            try {
                await refresh(entry.previous);
                delete runtime.pendingInjectionStore;
                await journal.complete(entry, 'rejected');
                return true;
            } catch (error) {
                return block(entry, error);
            }
        }
        if (revision !== entry.candidateStoreRevision || digest !== entry.candidateDigest) {
            const error = Object.assign(new Error('Today Trend candidate journal 与权威 store 不一致'), { code: 'TT_RECOVERY_SPLIT_BRAIN' });
            return block(entry, error);
        }
        runtime.store = current;
        if (entry.phase === 'compensation-requested') {
            const original = Object.assign(new Error('Today Trend 恢复未完成的补偿事务'), {
                code: entry.lastErrorCode || 'TT_COMPENSATION_REQUIRED',
            });
            return compensate(entry, entry.previous, entry.candidateStoreRevision, original);
        }
        if (entry.phase === 'injection-written') {
            await journal.complete(entry, 'accepted');
            return true;
        }
        if (entry.phase !== 'store-written') {
            const error = Object.assign(new Error(`Today Trend journal phase 无法恢复：${entry.phase}`), { code: 'TT_RECOVERY_PHASE_INVALID' });
            return block(entry, error);
        }
        runtime.pendingInjectionStore = entry.candidate;
        try {
            await refresh(entry.candidate);
            delete runtime.pendingInjectionStore;
            const injected = await journal.transition(entry, 'injection-written');
            await journal.complete(injected, 'accepted');
            return true;
        } catch (error) {
            delete runtime.pendingInjectionStore;
            let compensationRequested;
            try {
                compensationRequested = await journal.transition(entry, 'compensation-requested', {
                    lastErrorCode: String(error?.code || error?.name || 'TT_INJECTION_RECOVERY_FAILED'),
                });
            } catch (transitionError) {
                transitionError.cause = error;
                return block(entry, transitionError);
            }
            return compensate(compensationRequested, entry.previous, entry.candidateStoreRevision, error);
        }
    };

    const recover = () => {
        if (!journal) return Promise.resolve([]);
        if (!recoveryPromise) recoveryPromise = journal.ready().then(async entries => {
            const results = [];
            for (const entry of entries) results.push(await recoverEntry(entry));
            delete runtime.recoveryError;
            return results;
        }).catch(error => {
            runtime.recoveryError = error;
            recoveryPromise = null;
            throw error;
        });
        return recoveryPromise;
    };

    const sagaCommit = async ({ previous, candidate, task, expectedGeneration, scopeId }) => {
        const status = await storageStatus();
        if (!status.available || !status.owned || status.authority?.writeV2 !== true) return null;
        await prepareInjection?.(candidate);
        let entry = await journal.begin({
            scopeId, affectedScopeIds: changedScopeIds(previous, candidate),
            baseStoreRevision: status.authority.storeRevision, previous, candidate,
        });
        const candidateRevision = status.authority.storeRevision + 1;
        const storeWritten = journal.atomicTransition(entry, 'store-written', { candidateStoreRevision: candidateRevision });
        let saved;
        try {
            saved = await save(candidate, {
                scopeId, changedScopeIds: entry.affectedScopeIds, expectedStoreRevision: entry.baseStoreRevision,
                transactionId: entry.transactionId, journalWrite: storeWritten, returnReceipt: true,
            });
            entry = journal.acceptAtomicTransition(storeWritten.value);
        } catch (error) {
            await journal.complete(entry, 'rejected', { lastErrorCode: String(error?.code || error?.name || 'TT_STORE_WRITE_FAILED') });
            throw error;
        }
        runtime.pendingInjectionStore = candidate;
        let refreshError = null;
        try { await refresh(candidate); }
        catch (error) { refreshError = error; }
        if (!refreshError && expectedGeneration === generation && active(task)) {
            runtime.store = savedStore(saved, candidate);
            delete runtime.pendingInjectionStore;
            const injected = await journal.transition(entry, 'injection-written');
            await journal.complete(injected, 'accepted');
            return candidate;
        }
        const original = refreshError || Object.assign(new Error('今日风向提交在任务取消后需要回滚'), { name: 'AbortError' });
        entry = await journal.transition(entry, 'compensation-requested', { lastErrorCode: String(original.code || original.name || 'TT_COMPENSATION_REQUIRED') });
        await compensate(entry, previous, saved.storeRevision, original);
        if (refreshError) throw refreshError;
        return false;
    };

    const commitStore = (mutate, task = null, options = {}) => {
        if (typeof mutate !== 'function') throw new TypeError('今日风向提交变更必须是函数');
        const scopeId = options.scopeId ?? null;
        const refreshEnabled = Object.hasOwn(options, 'refreshInjection')
            ? options.refreshInjection !== false : options.refresh !== false;
        const expectedGeneration = generation;
        return enqueueDirectoryOperation('todayTrend', async () => {
            await recover();
            journal?.assertWritable(null);
            if (expectedGeneration !== generation || !active(task)) return false;
            const previous = normalizeTodayTrendStore(await load());
            const candidate = normalizeTodayTrendStore(await mutate(clone(previous)));
            if (expectedGeneration !== generation || !active(task)) return false;
            if (journal && refreshEnabled) {
                const sagaResult = await sagaCommit({ previous, candidate, task, expectedGeneration, scopeId });
                if (sagaResult !== null) return sagaResult;
            }
            const saved = await save(candidate, { scopeId, returnReceipt: true });
            const committedCandidate = savedStore(saved, candidate);
            runtime.store = committedCandidate;
            if (!refreshEnabled) return candidate;
            let refreshError = null;
            try { refreshError = injectionFailure(await refreshInjection?.(candidate)); }
            catch (error) { refreshError = error; }
            if (!refreshError && expectedGeneration === generation && active(task)) return candidate;
            try {
                const rollbackOptions = { scopeId, returnReceipt: true };
                if (Number.isSafeInteger(saved?.storeRevision)) rollbackOptions.expectedStoreRevision = saved.storeRevision;
                const rolledBack = await save(previous, rollbackOptions);
                const restored = savedStore(rolledBack, previous);
                runtime.store = restored;
                const rollbackError = injectionFailure(await refreshInjection?.(previous));
                if (rollbackError) throw rollbackError;
            } catch (rollbackError) {
                const original = refreshError || new Error('今日风向提交在任务取消后需要回滚');
                const combined = new Error(`${original.message}；今日风向状态回滚失败：${rollbackError.message}`);
                combined.cause = original;
                combined.rollbackError = rollbackError;
                throw combined;
            }
            if (refreshError) throw refreshError;
            return false;
        });
    };

    const commitScope = (storageId, mutate, task = null, options = {}) => commitStore(async store => {
        if (typeof storageId !== 'string' || !storageId) throw new TypeError('今日风向角色资料 ID 必须是非空字符串');
        const scope = await mutate(clone(store.scopes[storageId]));
        if (scope === null) delete store.scopes[storageId];
        else store.scopes[storageId] = scope;
        return store;
    }, task, { ...options, scopeId: storageId });

    const api = { commitStore, commitScope, invalidateCommits, recover };
    if (journal) Object.assign(api, { ready: recover, isBlocked: () => journal.blocked() === true });
    return api;
}
