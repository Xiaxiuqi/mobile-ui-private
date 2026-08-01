import { saveTheme } from './storage.js';

export const PHONE_BASE_WIDTH = 330;
export const PHONE_BASE_HEIGHT = 580;
export const PHONE_MIN_SCALE = 0.6;
export const PHONE_MAX_SCALE = 1.5;

export function normalizePhoneScale(value, viewportWidth = globalThis.window?.innerWidth ?? 1200) {
    const width = Number(viewportWidth);
    const compact = width <= 500;
    const widthLimit = Math.max(0.1, (compact ? width * 0.92 : width - 24) / PHONE_BASE_WIDTH);
    const maximum = Math.max(Math.min(PHONE_MAX_SCALE, widthLimit), Math.min(PHONE_MIN_SCALE, widthLimit));
    const minimum = Math.min(PHONE_MIN_SCALE, maximum);
    const numeric = Number(value);
    const candidate = Number.isFinite(numeric) ? numeric : 1;
    return Math.round(Math.min(maximum, Math.max(minimum, candidate)) * 1000) / 1000;
}

export function phoneSizeForScale(scale) {
    const normalized = Number.isFinite(Number(scale)) ? Number(scale) : 1;
    return { width: Math.round(PHONE_BASE_WIDTH * normalized), height: Math.round(PHONE_BASE_HEIGHT * normalized) };
}

export function phoneSizeForViewport(
    scale,
    viewportWidth = globalThis.window?.innerWidth ?? 1200,
    viewportHeight = globalThis.window?.visualViewport?.height ?? globalThis.window?.innerHeight ?? 1000,
) {
    const normalized = normalizePhoneScale(scale, viewportWidth);
    const naturalSize = phoneSizeForScale(normalized);
    const height = Number(viewportHeight);
    const compact = Number(viewportWidth) <= 500 || height <= 700;
    const heightBudget = Math.max(Math.round(PHONE_BASE_HEIGHT * 0.1), Math.round(compact ? height * 0.82 : height - 24));
    return { scale: normalized, width: naturalSize.width, height: Math.min(naturalSize.height, heightBudget) };
}

export function applyPhoneScale(element, scale = globalThis.window?.__pmTheme?.phoneScale) {
    if (!element) return null;
    const size = phoneSizeForViewport(scale);
    element.style.setProperty('--pm-phone-width', `${size.width}px`);
    element.style.setProperty('--pm-phone-height', `${size.height}px`);
    return size;
}

export function createPhoneResize(state) {
    return function bindPhoneResize(el, handle, lifecycleScope) {
        if (!lifecycleScope) throw new Error('Phone resize requires a phone lifecycle scope');
        let resizing = false;
        let pointerId = null;
        let startX = 0;
        let startY = 0;
        let startScale = 1;
        let previousScale = 1;
        const visualViewport = window.visualViewport;
        const onViewportResize = () => applyPhoneScale(el);
        const onPointerMove = event => {
            if (!resizing || event.pointerId !== pointerId) return;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            const projected = (dx * PHONE_BASE_WIDTH + dy * PHONE_BASE_HEIGHT)
                / (PHONE_BASE_WIDTH ** 2 + PHONE_BASE_HEIGHT ** 2);
            const nextScale = normalizePhoneScale(startScale + projected);
            window.__pmTheme.phoneScale = nextScale;
            applyPhoneScale(el, nextScale);
            if (event.cancelable) event.preventDefault();
        };
        const finish = event => {
            if (!resizing || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
            resizing = false;
            el.classList.remove('is-resizing');
            try { handle.releasePointerCapture?.(pointerId); } catch (error) {}
            pointerId = null;
            const nextScale = normalizePhoneScale(window.__pmTheme.phoneScale);
            window.__pmTheme.phoneScale = nextScale;
            if (!saveTheme()) {
                window.__pmTheme.phoneScale = previousScale;
                applyPhoneScale(el, previousScale);
                alert('手机尺寸保存失败：浏览器存储不可用。');
            }
        };
        const onPointerDown = event => {
            if (state.isMinimized || event.button !== 0) return;
            resizing = true;
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            previousScale = Number(window.__pmTheme.phoneScale) || 1;
            startScale = normalizePhoneScale(previousScale);
            window.__pmTheme.phoneScale = startScale;
            el.classList.add('is-resizing');
            handle.setPointerCapture?.(pointerId);
            if (event.cancelable) event.preventDefault();
        };
        const releases = [];
        try {
            releases.push(lifecycleScope.listen(handle, 'pointerdown', onPointerDown));
            releases.push(lifecycleScope.listen(handle, 'lostpointercapture', finish));
            releases.push(lifecycleScope.listen(window, 'pointermove', onPointerMove, { passive: false }));
            releases.push(lifecycleScope.listen(window, 'pointerup', finish));
            releases.push(lifecycleScope.listen(window, 'pointercancel', finish));
            releases.push(lifecycleScope.listen(window, 'blur', finish));
            releases.push(lifecycleScope.listen(window, 'resize', onViewportResize));
            if (visualViewport) releases.push(lifecycleScope.listen(visualViewport, 'resize', onViewportResize));
            releases.push(lifecycleScope.addCleanup(() => finish()));
            applyPhoneScale(el);
        } catch (error) {
            for (const release of releases.reverse()) {
                try { release(); } catch (cleanupError) {
                    console.error('[phone-mode] 手机尺寸监听器安装失败后的清理失败', cleanupError);
                }
            }
            throw error;
        }
        return () => {
            finish();
            let released = false;
            for (const release of releases.reverse()) released = release() || released;
            return released;
        };
    };
}
