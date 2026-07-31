export function createTaskController(getStorageId, defaultParentSignal = null) {
    let epoch = 0, sequence = 0;
    const tasks = new Map();
    const slotFor = (storageId, category) => ['generate', 'recipe-generate', 'outfit-generate'].includes(category)
        ? `${category}\0${storageId}` : category;
    const begin = (storageId, category, { replace = true, mode = category, parentSignal } = {}) => {
        if (!storageId || storageId === 'sms_unknown__default' || getStorageId() !== storageId) return null;
        const ownerSignal = parentSignal || defaultParentSignal;
        const slot = slotFor(storageId, category);
        const previous = tasks.get(slot);
        if (previous && !replace) return null;
        if (previous) {
            previous.detachParent?.();
            previous.controller.abort('superseded');
        }
        const controller = new AbortController();
        const abortFromParent = () => controller.abort(ownerSignal?.reason || 'parent-cancelled');
        if (ownerSignal?.aborted) abortFromParent();
        else ownerSignal?.addEventListener?.('abort', abortFromParent, { once: true });
        const task = Object.freeze({
            id: ++sequence, epoch, storageId, category, mode, slot, controller, signal: controller.signal,
            detachParent: () => ownerSignal?.removeEventListener?.('abort', abortFromParent),
        });
        tasks.set(slot, task);
        return task;
    };
    const active = task => !!task && !task.signal.aborted && task.epoch === epoch
        && tasks.get(task.slot) === task && getStorageId() === task.storageId;
    const finish = task => {
        task?.detachParent?.();
        if (tasks.get(task?.slot) !== task) return false;
        tasks.delete(task.slot);
        return true;
    };
    const cancel = reason => {
        epoch += 1;
        for (const task of tasks.values()) {
            task.controller.abort(reason);
            task.detachParent?.();
        }
        tasks.clear();
        return reason;
    };
    return { active, begin, cancel, finish };
}
