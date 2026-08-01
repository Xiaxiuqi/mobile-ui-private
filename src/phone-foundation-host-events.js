import { beginBranchInheritance, resolveBranchInheritance } from './branch-scope-inheritance.js';
import { resolveCommunityMessageEvents, resolveHostEvent } from './interactive-scene-scheduler.js';

const warnedHostEventRegistrationFailures = new Set();
function warnHostEventRegistrationFailureOnce(key, eventName, error) {
    if (warnedHostEventRegistrationFailures.has(key)) return;
    warnedHostEventRegistrationFailures.add(key);
    const errorType = typeof error?.name === 'string' && error.name ? error.name : 'Error';
    console.warn(`[phone-mode] 宿主事件 ${eventName} 注册失败，该集成功能可能不可用。`, errorType);
}

export function handleHostChatChanged({
    state, runtime, chatLength = 0, cancelCommunityGeneration, cancelCalendarTasks,
    disarmAutoPoke, endPhone = globalThis.window?.__pmEnd, invalidateGeneration,
}) {
    runtime.lastChatLength = Number.isInteger(chatLength) && chatLength >= 0 ? chatLength : 0;
    cancelCommunityGeneration?.('host-chat-changed');
    cancelCalendarTasks?.('host-chat-changed');
    disarmAutoPoke?.('host-chat-changed');
    if (state.phoneActive && typeof endPhone === 'function') { endPhone(true); return 'closed'; }
    invalidateGeneration?.();
    return 'invalidated';
}

export function createPhoneHostEvents(state, deps, automaticTasks, generation) {
    const { runtime, getCtx, getStorageId } = deps;
    return function hookGenerationEvent() {
        const c = getCtx(); const et = c?.eventTypes || c?.event_types;
        if (!c?.eventSource || !et) return;
        if (runtime.hostEventSource !== c.eventSource) {
            runtime.hostEventSource = c.eventSource; runtime.hostEventRegistrations = new Set(); runtime.eventHooked = false;
        }
        const registrations = runtime.hostEventRegistrations instanceof Set ? runtime.hostEventRegistrations : (runtime.hostEventRegistrations = new Set());
        if (runtime.eventHooked) return;
        runtime.lastChatLength = (c.chat || []).length;
        const injectionEvents = [
            et.GENERATION_STARTED || 'generation_started', et.SETTINGS_UPDATED || 'settings_updated',
            et.CHATCOMPLETION_SOURCE_CHANGED || 'chatcompletion_source_changed', et.OAI_PRESET_CHANGED_AFTER || 'oai_preset_changed_after',
        ].filter(Boolean);
        const registerOnce = (key, eventName, callback) => {
            if (registrations.has(key)) return true;
            if (!eventName || typeof c.eventSource?.on !== 'function') return false;
            try { c.eventSource.on(eventName, callback); registrations.add(key); return true; }
            catch (error) { warnHostEventRegistrationFailureOnce(key, eventName, error); return false; }
        };
        const results = injectionEvents.map(eventName => registerOnce(`injection:${eventName}`, eventName, () => generation.applyBidirectionalInjection().catch(() => undefined)));
        for (const eventName of resolveCommunityMessageEvents(et)) {
            results.push(registerOnce(`community:${eventName}`, eventName, () => {
                const currentContext = getCtx();
                try { deps.observeCommunityTurn?.(currentContext?.chat || []); } catch (error) {}
                Promise.resolve(deps.observeCalendarTurn?.()).catch(() => {});
            }));
        }
        const messageReceivedEvent = resolveHostEvent(et, 'MESSAGE_RECEIVED');
        results.push(registerOnce('resolved:MESSAGE_RECEIVED', messageReceivedEvent, () => {
            const chat = getCtx()?.chat || []; const previousLen = runtime.lastChatLength; const currentLen = chat.length;
            if (currentLen > runtime.lastChatLength) {
                runtime.lastChatLength = currentLen;
                const hasCompletedAssistantMessage = chat.slice(previousLen).some(message => !message?.is_user);
                if (hasCompletedAssistantMessage && automaticTasks.isAllowed() && typeof window.__pmIncrementCounters === 'function') window.__pmIncrementCounters();
            } else if (currentLen < runtime.lastChatLength) runtime.lastChatLength = currentLen;
        }));
        const chatChangedEvent = resolveHostEvent(et, 'CHAT_CHANGED');
        results.push(registerOnce('resolved:CHAT_CHANGED', chatChangedEvent, () => {
            const currentContext = getCtx(); const branch = resolveBranchInheritance(currentContext);
            const inheritBranch = deps.beginBranchInheritance || beginBranchInheritance;
            const branchMetadata = currentContext?.chatMetadata || currentContext?.chat_metadata;
            return inheritBranch(currentContext, {
                getStorageId, invalidateInteractiveStore: deps.invalidateInteractiveStore, reloadCalendarStore: deps.reloadCalendarStore,
            }).then(result => {
                runtime.lastBranchInheritance = {
                    status: result?.status || 'unknown', reason: result?.reason || null, sourceId: result?.sourceId || null,
                    targetId: result?.targetId || null, sourcePresence: result?.sourcePresence || null, targetPresence: result?.targetPresence || null,
                };
                runtime.lastBranchInheritanceError = null;
                if (result?.status === 'cloned') console.info('[phone-mode] 分支手机数据继承完成');
                else if (result?.status === 'skipped' && branchMetadata?.main_chat) console.warn('[phone-mode] 分支手机数据继承已跳过', result.reason || 'unknown');
                return result;
            }).catch(error => {
                runtime.lastBranchInheritance = { status: 'failed', reason: null, sourceId: branch?.sourceId || null, targetId: branch?.targetId || null, sourcePresence: null, targetPresence: null };
                runtime.lastBranchInheritanceError = { name: typeof error?.name === 'string' && error.name ? error.name : 'Error', message: typeof error?.message === 'string' ? error.message.slice(0, 240) : '' };
                console.warn('[phone-mode] 分支手机数据继承失败', error?.name || 'Error');
                return { status: 'failed', error };
            }).finally(() => {
                handleHostChatChanged({
                    state, runtime, chatLength: (currentContext?.chat || []).length,
                    cancelCommunityGeneration: deps.cancelCommunityGeneration, cancelCalendarTasks: deps.cancelCalendarTasks,
                    disarmAutoPoke: automaticTasks.disarm, endPhone: window.__pmEnd, invalidateGeneration: generation.invalidateGeneration,
                });
            });
        }));
        runtime.eventHooked = results.every(Boolean);
        if (runtime.eventHooked) console.log('[phone-mode] hooked', injectionEvents.length, 'injection events');
    };
}
