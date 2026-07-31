export function bindIsland(el, handle, {
    setTimer = globalThis.setTimeout,
    clearTimer = globalThis.clearTimeout,
    doubleTapDelay = 300,
    lifecycleScope,
} = {}) {
    if (!lifecycleScope) throw new Error('Island gesture requires a lifecycle scope');
    const scope = lifecycleScope.child('island-gesture');
    let active = true;
    let isDragging = false, startX, startY, startTX = 0, startTY = 0;
    let moved = false, secondTap = false, tapTimer = null;
    const getCoord = e => e.touches
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY };
    const getT = () => {
        const match = (el.style.transform || '').match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px/);
        return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : { x: 0, y: 0 };
    };
    const onStart = e => {
        if (!active) return;
        if (e.target.tagName === 'BUTTON') return;
        secondTap = el.classList.contains('is-min') && tapTimer !== null;
        if (secondTap) {
            tapTimer.cancel();
            tapTimer = null;
        }
        isDragging = true;
        moved = false;
        const coords = getCoord(e);
        startX = coords.x;
        startY = coords.y;
        const translation = getT();
        startTX = translation.x;
        startTY = translation.y;
        el.style.transition = 'none';
        if (e.cancelable) e.preventDefault();
    };
    const onMove = e => {
        if (!active) return;
        if (!isDragging) return;
        const coords = getCoord(e), dx = coords.x - startX, dy = coords.y - startY;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        moved = true;
        secondTap = false;
        if (e.cancelable) e.preventDefault();
        el.style.setProperty('transform', `translate(${startTX + dx}px, ${startTY + dy}px)`, 'important');
    };
    const cancelGesture = ({ clearPendingTap = false } = {}) => {
        isDragging = false;
        moved = false;
        secondTap = false;
        el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)';
        if (clearPendingTap && tapTimer !== null) {
            tapTimer.cancel();
            tapTimer = null;
        }
    };
    const cancelAll = () => cancelGesture({ clearPendingTap: true });
    const onEnd = () => {
        if (!active) return;
        if (!isDragging) return;
        isDragging = false;
        el.style.transition = '.35s cubic-bezier(.18,.89,.32,1.2)';
        if (moved) return;
        if (!el.classList.contains('is-min')) return window.__pmToggleMin();
        if (secondTap) {
            secondTap = false;
            window.__pmEnd();
            return;
        }
        let releaseTimer = () => false;
        const timerId = setTimer(() => {
            releaseTimer();
            tapTimer = null;
            if (active && el.classList.contains('is-min')) window.__pmToggleMin();
        }, doubleTapDelay);
        releaseTimer = scope.addCleanup(() => clearTimer(timerId), 'timeout');
        tapTimer = { id: timerId, cancel: releaseTimer };
    };
    scope.listen(handle, 'mousedown', onStart);
    scope.listen(window, 'mousemove', onMove);
    scope.listen(window, 'mouseup', onEnd);
    scope.listen(handle, 'touchstart', onStart, { passive: false });
    scope.listen(window, 'touchmove', onMove, { passive: false });
    scope.listen(window, 'touchend', onEnd);
    scope.listen(window, 'touchcancel', cancelAll);
    scope.listen(window, 'blur', cancelAll);
    scope.addCleanup(() => {
        active = false;
        cancelGesture({ clearPendingTap: true });
    }, 'gesture-state');
    return () => {
        scope.dispose('island-gesture-unbound');
    };
}
