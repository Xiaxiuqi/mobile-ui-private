export class LifecycleScopeDisposedError extends Error {
    constructor(label) {
        super(`Lifecycle scope is disposed: ${label}`);
        this.name = 'LifecycleScopeDisposedError';
    }
}

export function createLifecycleDiagnostics() {
    const counts = new Map();
    const change = (kind, delta) => {
        const next = (counts.get(kind) || 0) + delta;
        if (next < 0) throw new Error(`Lifecycle diagnostic underflow: ${kind}`);
        if (next === 0) counts.delete(kind);
        else counts.set(kind, next);
    };
    return Object.freeze({
        track(kind) {
            change(kind, 1);
            let active = true;
            return () => {
                if (!active) return false;
                active = false;
                change(kind, -1);
                return true;
            };
        },
        snapshot() {
            return Object.freeze(Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))));
        },
    });
}

export function createLifecycleScope({
    label = 'anonymous',
    parent = null,
    diagnostics = parent?.diagnostics || createLifecycleDiagnostics(),
    timers = globalThis,
} = {}) {
    const controller = new AbortController();
    const cleanups = new Set();
    let disposed = false;
    let releaseParent = null;
    let untrackScope = diagnostics.track('scope');
    const assertActive = () => {
        if (disposed) throw new LifecycleScopeDisposedError(label);
    };
    const addCleanup = (cleanup, kind = 'cleanup') => {
        assertActive();
        if (typeof cleanup !== 'function') throw new TypeError('Lifecycle cleanup must be a function');
        const untrack = diagnostics.track(kind);
        let active = true;
        const wrapped = () => {
            if (!active) return false;
            active = false;
            cleanups.delete(wrapped);
            try { cleanup(); } finally { untrack(); }
            return true;
        };
        cleanups.add(wrapped);
        return wrapped;
    };
    const listen = (target, type, handler, options) => {
        assertActive();
        if (!target?.addEventListener || !target?.removeEventListener) throw new TypeError('Lifecycle event target is invalid');
        target.addEventListener(type, handler, options);
        return addCleanup(() => target.removeEventListener(type, handler, options), 'listener');
    };
    const timeout = (handler, delay, ...args) => {
        assertActive();
        const id = timers.setTimeout(() => {
            cancel();
            if (!disposed) handler(...args);
        }, delay);
        const cancel = addCleanup(() => timers.clearTimeout(id), 'timeout');
        return Object.freeze({ id, cancel });
    };
    const interval = (handler, delay, ...args) => {
        assertActive();
        const id = timers.setInterval(() => { if (!disposed) handler(...args); }, delay);
        const cancel = addCleanup(() => timers.clearInterval(id), 'interval');
        return Object.freeze({ id, cancel });
    };

    const abortController = () => {
        assertActive();
        const childController = new AbortController();
        const release = addCleanup(
            () => childController.abort(controller.signal.reason || 'scope-disposed'),
            'controller',
        );
        childController.signal.addEventListener('abort', release, { once: true });
        return childController;
    };
    const child = childLabel => {
        assertActive();
        return createLifecycleScope({
            label: childLabel ? `${label}/${childLabel}` : `${label}/child`,
            parent: scope,
            diagnostics,
            timers,
        });
    };
    const run = task => {
        assertActive();
        if (typeof task !== 'function') throw new TypeError('Lifecycle task must be a function');
        return Promise.resolve().then(() => {
            assertActive();
            return task(controller.signal);
        });
    };
    const dispose = (reason = 'scope-disposed') => {
        if (disposed) return false;
        disposed = true;
        releaseParent?.();
        controller.abort(reason);
        const errors = [];
        for (const cleanup of [...cleanups].reverse()) {
            try { cleanup(); } catch (error) { errors.push(error); }
        }
        untrackScope?.();
        untrackScope = null;
        if (errors.length) throw new AggregateError(errors, `Lifecycle scope disposal failed: ${label}`);
        return true;
    };
    const scope = Object.freeze({
        label,
        signal: controller.signal,
        diagnostics,
        get isDisposed() { return disposed; },
        addCleanup,
        listen,
        timeout,
        interval,
        abortController,
        child,
        run,
        dispose,
    });
    if (parent) {
        try {
            releaseParent = parent.addCleanup(
                () => dispose(parent.signal.reason || 'parent-disposed'),
                'child-scope',
            );
        } catch (error) {
            disposed = true;
            controller.abort('parent-registration-failed');
            untrackScope?.();
            untrackScope = null;
            throw error;
        }
    }
    return scope;
}

export const LIFECYCLE_SCOPE_RELATIONSHIPS = Object.freeze({
    app: Object.freeze(['phone']),
    phone: Object.freeze(['overlay', 'calendar-page', 'community-page', 'cropper']),
    overlay: Object.freeze([]),
    'calendar-page': Object.freeze([]),
    'community-page': Object.freeze([]),
    cropper: Object.freeze([]),
});
