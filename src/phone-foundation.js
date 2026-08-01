import { bindIsland } from './phone-island-gesture.js';
import { createPhoneAppearance } from './phone-appearance.js';
import { createAutomaticTaskController } from './runtime.js';
import { saveHistoriesBeforeUnload } from './storage.js';
import {
    PHONE_BASE_WIDTH, PHONE_BASE_HEIGHT, PHONE_MIN_SCALE, PHONE_MAX_SCALE,
    normalizePhoneScale, phoneSizeForScale, phoneSizeForViewport, applyPhoneScale, createPhoneResize,
} from './phone-foundation-scale.js';
import { initializePhoneFoundationGlobals, createPhoneTheme } from './phone-foundation-theme.js';
import { createPhoneOverlay } from './phone-foundation-overlay.js';
import { createPhoneQuote } from './phone-foundation-quote.js';
import { createPhoneMessages } from './phone-foundation-messages.js';
import { createPhoneGeneration } from './phone-foundation-generation.js';
import { createPhoneHostEvents, handleHostChatChanged } from './phone-foundation-host-events.js';

export {
    PHONE_BASE_WIDTH, PHONE_BASE_HEIGHT, PHONE_MIN_SCALE, PHONE_MAX_SCALE,
    normalizePhoneScale, phoneSizeForScale, phoneSizeForViewport, applyPhoneScale,
    handleHostChatChanged,
};

export function installPhonePageSuspensionListeners(windowRef = window, documentRef = document, lifecycleScope) {
    if (windowRef.__pmBeforeUnloadRegistered) return false;
    if (!lifecycleScope) throw new Error('Phone page suspension listeners require an app lifecycle scope');
    const owner = {}, releases = [];
    const beforeUnload = () => windowRef.__pmPageSuspensionListenerOwner === owner
        && windowRef.__pmPageSuspensionHandler?.('beforeunload');
    const visibilityChange = () => windowRef.__pmPageSuspensionListenerOwner === owner
        && documentRef.visibilityState === 'hidden' && windowRef.__pmPageSuspensionHandler?.('document-hidden');
    try {
        releases.push(lifecycleScope.listen(windowRef, 'beforeunload', beforeUnload));
        releases.push(lifecycleScope.listen(documentRef, 'visibilitychange', visibilityChange));
        releases.push(lifecycleScope.addCleanup(() => {
            if (windowRef.__pmPageSuspensionListenerOwner !== owner) return;
            windowRef.__pmPageSuspensionListenerOwner = null; windowRef.__pmBeforeUnloadRegistered = false;
        }));
        windowRef.__pmPageSuspensionListenerOwner = owner;
        windowRef.__pmBeforeUnloadRegistered = true;
    } catch (error) {
        const cleanupErrors = [];
        for (const release of releases.reverse()) {
            try { release(); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
        }
        if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Phone page suspension listener installation failed');
        throw error;
    }
    return true;
}

export function updatePhonePageSuspensionHandler(windowRef, deps, disarm, save = saveHistoriesBeforeUnload) {
    windowRef.__pmPageSuspensionHandler = reason => handlePhonePageSuspension(deps, reason, { disarm, save });
    return windowRef.__pmPageSuspensionHandler;
}

export function handlePhonePageSuspension(deps, reason, { save = saveHistoriesBeforeUnload, disarm = () => {} } = {}) {
    save();
    deps.cancelCommunityGeneration?.(reason);
    deps.cancelCalendarTasks?.(reason);
    disarm(reason);
}

export function installPhoneFoundation(state, deps) {
    const { runtime, getStorageId } = deps;
    const quote = createPhoneQuote(state);
    const automaticTasks = createAutomaticTaskController({
        runtime, state, getStorageId,
        isDocumentVisible: () => typeof document.visibilityState !== 'string' || document.visibilityState !== 'hidden',
    });
    const messages = createPhoneMessages(state, quote);
    updatePhonePageSuspensionHandler(window, deps, automaticTasks.disarm);
    installPhonePageSuspensionListeners(window, document, deps.appLifecycleScope);
    initializePhoneFoundationGlobals(window);

    const generation = createPhoneGeneration(state, deps, messages.hideTyping);
    const applyTheme = createPhoneTheme(state);
    const { applyBackground, fitNameFont, migrateOldHistory } = createPhoneAppearance(state, deps);
    const overlay = createPhoneOverlay(runtime, applyTheme);
    const bindPhoneResize = createPhoneResize(state);
    const hookGenerationEvent = createPhoneHostEvents(state, deps, automaticTasks, generation);

    generation.installBidirectionalToggle();
    window.__pmCloseOverlay = () => overlay.closeOverlay('close');
    Object.assign(deps, {
        applyTheme, applyBackground, fitNameFont, migrateOldHistory,
        applyBidirectionalInjection: generation.applyBidirectionalInjection,
        clearBidirectionalInjection: generation.clearBidirectionalInjection, hookGenerationEvent,
        bindIsland, bindPhoneResize, applyPhoneScale,
        addBubble: messages.addBubble, addNote: messages.addNote, addDirector: messages.addDirector,
        rebaseRenderedHistory: messages.rebaseRenderedHistory, resetEmojiRenderBudget: messages.resetEmojiRenderBudget,
        showTyping: messages.showTyping, hideTyping: messages.hideTyping,
        makeOverlay: overlay.makeOverlay, closeOverlay: overlay.closeOverlay,
        beginGeneration: generation.beginGeneration, isGenerationTaskActive: generation.isGenerationTaskActive,
        finishGeneration: generation.finishGeneration, cancelGeneration: generation.cancelGeneration,
        invalidateGeneration: generation.invalidateGeneration, syncGenerationControls: generation.syncGenerationControls,
        isAutoPokeAllowed: automaticTasks.isAllowed, armAutoPoke: automaticTasks.arm, disarmAutoPoke: automaticTasks.disarm,
        beginAutomaticTask: automaticTasks.begin, isAutomaticTaskActive: automaticTasks.isActive, finishAutomaticTask: automaticTasks.finish,
        setActiveQuote: quote.setActiveQuote, clearActiveQuote: quote.clearActiveQuote, renderActiveQuote: quote.renderActiveQuote,
        findQuotedBubble: quote.findQuotedBubble, locateQuotedBubble: quote.locateQuotedBubble,
        refreshReplyCardAvailability: quote.refreshReplyCardAvailability,
    });
}
