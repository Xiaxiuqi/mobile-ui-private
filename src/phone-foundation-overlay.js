import { POPOVER_SUPPORTED } from './constants.js';

export function createPhoneOverlay(runtime, applyTheme) {
    function closeOverlay(reason = 'close') {
        const current = document.getElementById('pm-overlay');
        if (!current) return false;
        const onClose = current.__pmOnClose;
        const opener = current.__pmOpener;
        current.remove();
        if (typeof onClose === 'function') onClose(reason);
        if (!['replace', 'phone-close', 'conversation-switch'].includes(reason)
            && opener?.isConnected && typeof opener.focus === 'function') {
            opener.focus({ preventScroll: true });
        }
        return true;
    }

    function makeOverlay(html, options = {}) {
        const previous = document.getElementById('pm-overlay');
        const active = document.activeElement;
        const opener = options.opener || runtime.overlayOpener || previous?.__pmOpener
            || (active && active !== document.body ? active : null);
        runtime.overlayOpener = null;
        closeOverlay('replace');
        const ov = document.createElement('div'); ov.id = 'pm-overlay';
        ov.dataset.theme = window.__pmTheme?.darkMode || 'light';
        if (POPOVER_SUPPORTED) ov.setAttribute('popover', 'manual');
        ov.__pmOnClose = typeof options.onClose === 'function' ? options.onClose : null;
        ov.__pmOpener = opener;
        ov.innerHTML = html;
        ov.addEventListener('click', e => { if (e.target === ov) closeOverlay('backdrop'); });
        document.body.appendChild(ov);
        applyTheme();
        if (ov.showPopover) try { ov.showPopover(); } catch (e) {}
        return ov;
    }

    return { makeOverlay, closeOverlay };
}
