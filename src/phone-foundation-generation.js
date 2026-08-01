import { applyContextInjections, clearExtensionPrompts } from './phone-injection.js';

export function createPhoneGeneration(state, deps, hideTyping) {
    const { runtime, getCtx, getStorageId, getUserPersona } = deps;
    function syncGenerationControls() {
        const disabled = !!state.isGenerating;
        for (const button of document.querySelectorAll('.pm-submit-pending-btn')) { const empty = button.dataset.empty === 'true'; button.disabled = disabled || empty; }
        for (const button of document.querySelectorAll('.pm-generation-cancel')) { button.hidden = !disabled; button.disabled = !disabled; }
        const status = document.querySelector('.pm-control-generation-status');
        if (status) status.textContent = disabled ? 'AI 正在回复，暂存仍可继续编辑' : '';
    }
    function beginGeneration(storageId) {
        if (state.generationTask) return null;
        const id = storageId || getStorageId(); const context = getCtx();
        if (!context || !id || id === 'sms_unknown__default') return null;
        const controller = new AbortController();
        const task = Object.freeze({ id: ++state.generationSequence, hostEpoch: state.hostEpoch, storageId: id, context, controller, signal: controller.signal });
        state.generationTask = task; state.isGenerating = true; syncGenerationControls(); return task;
    }
    function isGenerationTaskActive(task) {
        return !!task && !task.signal.aborted && state.generationTask === task && state.hostEpoch === task.hostEpoch && getStorageId() === task.storageId;
    }
    function finishGeneration(task) {
        if (state.generationTask !== task) return false;
        state.generationTask = null; state.isGenerating = false; syncGenerationControls(); return true;
    }
    function cancelGeneration() {
        if (!state.generationTask) return false;
        state.generationTask.controller.abort('generation-cancelled-by-user'); hideTyping(); return true;
    }
    function invalidateGeneration() {
        state.generationTask?.controller?.abort('generation-invalidated'); state.hostEpoch += 1;
        state.generationTask = null; state.isGenerating = false; hideTyping(); syncGenerationControls();
    }
    function clearBidirectionalInjection() {
        runtime.injectionEpoch += 1;
        return clearExtensionPrompts({ context: getCtx(), runtime });
    }
    function getCalendarData(getter) {
        try { const store = deps[getter]?.(); return store || null; } catch (error) { return null; }
    }
    async function applyBidirectionalInjection() {
        const epoch = ++runtime.injectionEpoch; const context = getCtx(); const id = getStorageId();
        if (!context || !id || id === 'sms_unknown__default') return clearExtensionPrompts({ context, runtime });
        const character = context.characters?.[context.characterId];
        const currentActorName = typeof character?.name === 'string' ? character.name.trim() : '';
        if (!currentActorName) return clearExtensionPrompts({ context, runtime });
        const currentConversationKey = state.isGroupChat && state.currentGroupKey ? state.currentGroupKey : state.currentPersona;
        let interactiveStore;
        try { interactiveStore = await deps.getInteractiveStore?.(); } catch (error) { interactiveStore = null; }
        if (epoch !== runtime.injectionEpoch || getStorageId() !== id) return;
        return applyContextInjections({
            context, runtime, currentStorageId: id, currentActorName, currentConversationKey,
            injectionConfig: window.__pmInjectionConfig, selectedByStorage: window.__pmBidirectional,
            historiesByStorage: window.__pmHistories, groupsByStorage: window.__pmGroupMeta, interactiveStore,
            budgetConfig: window.__pmBudgetConfig, userName: getUserPersona().name || '用户', emojis: window.__pmEmojis,
            calendarStore: getCalendarData('getCalendarStore'), calendarOccasions: getCalendarData('getCalendarOccasionStore'),
            calendarHolidays: getCalendarData('getCalendarHolidayStore'), calendarWeather: getCalendarData('getCalendarWeatherStore'),
            calendarCycles: getCalendarData('getCalendarCycleStore'), calendarRecipes: getCalendarData('getCalendarRecipeStore'),
            calendarOutfits: getCalendarData('getCalendarOutfitStore'),
        });
    }
    function installBidirectionalToggle() {
        window.__pmToggleBidirectional = name => {
            const id = getStorageId(); const targetKey = String(name || '').trim();
            const isGroup = Object.hasOwn(window.__pmGroupMeta?.[id] || {}, targetKey);
            return window.__pmToggleConversationInjection?.(id, targetKey, isGroup) || Promise.resolve(false);
        };
    }
    return { syncGenerationControls, beginGeneration, isGenerationTaskActive, finishGeneration, cancelGeneration, invalidateGeneration, clearBidirectionalInjection, applyBidirectionalInjection, installBidirectionalToggle };
}
