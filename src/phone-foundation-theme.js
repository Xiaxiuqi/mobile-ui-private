import { normalizeInjectionConfig } from './behavior-config.js';
import { normalizeBudgetConfig } from './budget.js';
import { THEME_PRESETS } from './config.js';
import { contrastText } from './ui.js';

export function initializePhoneFoundationGlobals(windowRef = window) {
    windowRef.__pmHistories = windowRef.__pmHistories || {};
    windowRef.__pmConfig = windowRef.__pmConfig || { apiUrl: '', apiKey: '', model: '', temperature: 1.2, useIndependent: false };
    windowRef.__pmProfiles = windowRef.__pmProfiles || [];
    windowRef.__pmInjectionConfig = normalizeInjectionConfig(windowRef.__pmInjectionConfig);
    windowRef.__pmBidirectional = windowRef.__pmBidirectional || {};
    windowRef.__pmTheme = windowRef.__pmTheme || {
        preset: 'default', customRight: '', customLeft: '', borderColor: '', layout: 'standard',
        darkMode: 'light', ambientStatusEnabled: false, customTitle: '', qrLabel: '天音', phoneScale: 1,
    };
    windowRef.__pmDesktopBg = windowRef.__pmDesktopBg || '';
    windowRef.__pmBgGlobal = windowRef.__pmBgGlobal || '';
    windowRef.__pmBgLocal = windowRef.__pmBgLocal || {};
    windowRef.__pmGroupMeta = windowRef.__pmGroupMeta || {};
    windowRef.__pmPokeConfig = windowRef.__pmPokeConfig || {};
    windowRef.__pmCharacterBehavior = windowRef.__pmCharacterBehavior || {};
    windowRef.__pmWordyLimit = windowRef.__pmWordyLimit || false;
    windowRef.__pmBudgetConfig = normalizeBudgetConfig(windowRef.__pmBudgetConfig);
    windowRef.__pmEmojis = windowRef.__pmEmojis || [];
}

export function createPhoneTheme(state) {
    return function applyTheme() {
        const t = window.__pmTheme || {}, p = THEME_PRESETS[t.preset] || THEME_PRESETS.default;
        const interfaceMode = t.preset === 'apple' ? 'light' : (t.darkMode || 'light');
        const customAccent = t.preset === 'custom' ? String(t.customAccent || '').trim() : '';
        const defaultRight = t.preset === 'custom' && customAccent ? customAccent : interfaceMode === 'dark' ? p.rightDark || p.right : p.right;
        const defaultLeft = interfaceMode === 'dark' ? p.leftDark || p.left : p.left;
        const rBg = t.customRight || defaultRight, lBg = t.customLeft || defaultLeft;
        const rTxt = t.customRight || (t.preset === 'custom' && customAccent) ? contrastText(rBg) : p.rightText;
        const lTxt = t.customLeft ? contrastText(t.customLeft) : interfaceMode === 'dark' ? p.leftTextDark || p.leftText : p.leftText;
        const border = t.borderColor || '#1a1a1a';
        const skinTokens = { ...THEME_PRESETS.apple?.ui, ...THEME_PRESETS.pink?.uiDark };
        const uiTokens = interfaceMode === 'dark' ? p.uiDark || {} : p.ui || {};
        const applyProperties = element => {
            if (!element) return;
            element.style.setProperty('--pm-r-bg', rBg); element.style.setProperty('--pm-l-bg', lBg);
            element.style.setProperty('--pm-r-txt', rTxt); element.style.setProperty('--pm-l-txt', lTxt);
            element.style.setProperty('--pm-border', border);
            element.style.setProperty('--pm-frost', p.frost ? '1' : '0');
            element.style.setProperty('--pm-color-accent', customAccent || p.accent || p.right);
            for (const token of Object.keys(skinTokens)) element.style.removeProperty(token);
            for (const [token, value] of Object.entries(uiTokens)) element.style.setProperty(token, value);
            element.setAttribute('data-theme', interfaceMode);
            if (t.preset === 'apple') element.setAttribute('data-skin', 'apple');
            else element.removeAttribute('data-skin');
        };
        applyProperties(document.getElementById('pm-overlay'));
        applyProperties(document.getElementById('pm-overlay-sub'));
        applyProperties(document.getElementById('pm-model-dropdown'));
        applyProperties(state.phoneWindow);
        const desktopTitle = state.phoneWindow?.querySelector('.pm-desktop-toolbar span');
        if (desktopTitle) desktopTitle.textContent = String(t.customTitle || '').trim() || '天音小笺';
    };
}
