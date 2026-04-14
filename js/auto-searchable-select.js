/**
 * Auto SearchableDropdown
 * ----------------------------------------------------------------------------
 * Repository-wide rule: native `<select>` elements break the brand theme and
 * are not searchable. This helper scans the DOM at load and any time new
 * selects are added, and transparently replaces each one with a
 * `SearchableDropdown` instance — without requiring every page to be hand-
 * converted (there are 351+ native selects across the app).
 *
 * Behavior
 *   - Hides the original <select> but keeps it in the DOM so existing form
 *     submission, validation, and `select.value` reads keep working.
 *   - Mirrors every change back to the native select and fires a `change`
 *     event so existing JS handlers run unchanged.
 *   - Watches for new selects via MutationObserver (covers modals, dynamic
 *     row grids, async-loaded forms).
 *   - Re-renders the SearchableDropdown when the underlying <select>'s
 *     option list is repopulated (cascading dropdowns: country -> state).
 *
 * Opt-out
 *   - Add `data-no-sd="true"` on a <select> to skip auto-conversion.
 *   - `<select multiple>` and `<select size="N">` (N>1) are skipped.
 *   - Selects already inside an `.searchable-dropdown` container are skipped.
 *
 * Required globals: `SearchableDropdown` from /js/searchable-dropdown.js.
 */
(function () {
    'use strict';

    if (typeof SearchableDropdown === 'undefined') {
        console.warn('[auto-sd] SearchableDropdown not loaded — auto-conversion disabled');
        return;
    }

    const CONVERTED_FLAG = 'sdConverted';
    const INSTANCE_KEY   = '_sdAutoInstance';

    function isConvertible(select) {
        if (!select || select.tagName !== 'SELECT') return false;
        if (select.dataset[CONVERTED_FLAG] === 'true') return false;
        if (select.dataset.noSd === 'true') return false;
        if (select.multiple) return false;
        if (select.size && Number(select.size) > 1) return false;
        if (select.closest('.searchable-dropdown')) return false;
        // Hidden selects we leave alone — usually they're driven by some other
        // widget already, or not meant to be user-facing.
        if (select.type === 'hidden') return false;
        // Already wired by some page-specific code (setup.js, etc.)? The
        // SearchableDropdown lives as an immediate sibling — usually the
        // container is positioned right before or right after the select.
        // If we find one, this select is being driven by it; don't double-wire.
        const prev = select.previousElementSibling;
        const next = select.nextElementSibling;
        if (prev && prev.classList?.contains('searchable-dropdown-container')) return false;
        if (next && next.classList?.contains('searchable-dropdown-container')) return false;
        if (prev && prev.classList?.contains('searchable-dropdown'))           return false;
        if (next && next.classList?.contains('searchable-dropdown'))           return false;
        return true;
    }

    function buildOptions(select) {
        return Array.from(select.options).map(o => ({
            value: o.value,
            label: (o.textContent || '').trim() || o.value,
            description: o.dataset.description || ''
        }));
    }

    function convertOne(select) {
        if (!isConvertible(select)) return;

        const options = buildOptions(select);

        // Guess "compactness" based on neighboring class hints — many filter
        // bars use `compact`, `form-control-sm`, `inline-select`, etc.
        const compact = select.classList.contains('compact')
                     || select.classList.contains('form-control-sm')
                     || select.classList.contains('inline-select')
                     || select.closest('table')                       // inline grids
                     || select.closest('.filters-bar')
                     || select.closest('.toolbar');

        const placeholder = select.dataset.placeholder
                         || select.getAttribute('placeholder')
                         || (options.find(o => o.value === '')?.label || '— select —');

        // Insert container right before the select, then hide the select but
        // keep it for form submission + native value reads.
        const container = document.createElement('div');
        container.className = 'searchable-dropdown-container sd-auto-container';
        // Inherit width from the select so layouts don't shift.
        const cs = window.getComputedStyle(select);
        if (cs.width) container.style.width = cs.width;
        select.parentNode.insertBefore(container, select);

        select.style.display = 'none';
        select.dataset[CONVERTED_FLAG] = 'true';
        // Tag with a stable id so we can find it again on option-list changes.
        if (!select.id) select.id = 'sd-auto-src-' + Math.random().toString(36).slice(2, 9);

        const dd = new SearchableDropdown(container, {
            id: 'sd-auto-' + select.id,
            options,
            value: select.value,
            placeholder,
            compact: !!compact,
            disabled: select.disabled,
            onChange: (val) => {
                if (select.value === val) return;
                select.value = val;
                select.dispatchEvent(new Event('change',  { bubbles: true }));
                select.dispatchEvent(new Event('input',   { bubbles: true }));
            }
        });
        select[INSTANCE_KEY] = dd;

        // Keep enabled/disabled in sync — some pages flip `select.disabled`
        // dynamically (e.g. "edit mode"). Observe attribute changes.
        const attrObs = new MutationObserver(() => {
            if (!dd) return;
            dd.disabled = !!select.disabled;
            dd.render();
            dd.bindEvents();
        });
        attrObs.observe(select, { attributes: true, attributeFilter: ['disabled'] });

        // Repopulate when the option list changes (cascading dropdowns).
        const childObs = new MutationObserver(() => {
            const inst = select[INSTANCE_KEY];
            if (!inst) return;
            inst.options = buildOptions(select);
            inst.filteredOptions = [...inst.options];
            const desired = select.value;
            if (desired && inst.options.some(o => String(o.value) === String(desired))) {
                inst.selectedValue = desired;
            } else {
                inst.selectedValue = inst.options[0]?.value ?? '';
            }
            inst.render();
            inst.bindEvents();
        });
        childObs.observe(select, { childList: true, subtree: true, characterData: true });

        // Mirror programmatic `select.value = ...` writes back into the
        // SearchableDropdown. There's no native event for this, so we patch
        // the `value` setter — but only on this individual element so we
        // don't poison the prototype.
        try {
            const proto = Object.getPrototypeOf(select);
            const desc  = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.configurable) {
                Object.defineProperty(select, 'value', {
                    get: function () { return desc.get.call(this); },
                    set: function (v) {
                        desc.set.call(this, v);
                        const inst = select[INSTANCE_KEY];
                        if (inst && inst.selectedValue !== v) {
                            inst.selectedValue = v;
                            inst.render();
                            inst.bindEvents();
                        }
                    },
                    configurable: true
                });
            }
        } catch (e) {
            // Some browsers refuse to redefine `value` on the instance — that's
            // fine, the dropdown just won't catch programmatic writes.
        }
    }

    function convertAll(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('select').forEach(convertOne);
    }

    // Watch for new selects added to the DOM.
    function startObserver() {
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.tagName === 'SELECT') {
                        convertOne(node);
                    } else if (node.querySelectorAll) {
                        node.querySelectorAll('select').forEach(convertOne);
                    }
                });
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        try { convertAll(document); } catch (e) { console.warn('[auto-sd] initial pass failed', e); }
        try { startObserver(); }      catch (e) { console.warn('[auto-sd] observer failed', e); }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose a manual trigger for late-loaded fragments that the observer
    // somehow misses.
    window.AutoSearchableSelect = {
        convertAll,
        convertOne
    };
})();
