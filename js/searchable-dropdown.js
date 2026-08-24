/**
 * Searchable Dropdown Component for Ragenaizer
 * A reusable searchable dropdown with virtual scroll support
 *
 * Usage:
 *   // Create new dropdown
 *   const dropdown = new SearchableDropdown(container, {
 *     options: [{ value: 'val1', label: 'Label 1', description: 'Optional desc' }, ...],
 *     placeholder: 'Select an option',
 *     searchPlaceholder: 'Search...',
 *     onChange: (value, option) => {},
 *     virtualScroll: true,  // Enable for large lists (50+ items)
 *     itemHeight: 40        // Height of each item for virtual scroll
 *   });
 *
 *   // Convert existing select element
 *   convertSelectToSearchable('selectId', {
 *     placeholder: 'Select...',
 *     onChange: (value) => {}
 *   });
 */

/**
 * Does this element open a stacking context?
 *
 * Anything inside one is sealed in: however high a descendant's z-index, it is
 * composited as part of this ancestor and can never rise above a sibling OF
 * the ancestor. For a dropdown that means opening underneath the next card on
 * the page with no way to style out of it — the menu has to leave the subtree.
 *
 * Positioned-with-z-index is deliberately NOT treated as trapping: it is far
 * too common (toolbars, sticky headers, cards) and on its own rarely traps
 * anything, because the menu usually shares that same context. The properties
 * below are the ones that isolate unconditionally.
 */
function createsStackingContext(el, cs) {
    cs = cs || getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.transform !== 'none' || cs.perspective !== 'none') return true;
    if (cs.filter !== 'none') return true;
    if (cs.backdropFilter && cs.backdropFilter !== 'none') return true;
    if (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') return true;
    if (parseFloat(cs.opacity) < 1) return true;
    if (cs.isolation === 'isolate') return true;
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return true;
    if (/transform|opacity|filter/.test(cs.willChange || '')) return true;
    if (/paint|layout|strict|content/.test(cs.contain || '')) return true;
    return false;
}

// Shared: the date picker needs the same test, and two copies of this list
// would drift the moment a new isolating property is added to CSS.
if (typeof window !== 'undefined') window.rzCreatesStackingContext = createsStackingContext;

const SearchableDropdown = (function() {
    'use strict';

    // Store for all dropdown instances
    const instances = new Map();

    // Close all open SearchableDropdowns when flatpickr custom dropdowns open
    document.addEventListener('fpDropdownOpened', () => {
        instances.forEach(instance => {
            if (instance.isOpen) instance.close();
        });
    });

    // HTML escape function to prevent XSS. Must be QUOTE-SAFE: escaped values are interpolated
    // into double-quoted attributes (data-value="…"), and the textContent→innerHTML trick alone
    // leaves " and ' unescaped — a value like `x" onclick="…"` would break out of the attribute.
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * SearchableDropdown Class
     */
    class Dropdown {
        constructor(container, options = {}) {
            this.container = typeof container === 'string' ? document.getElementById(container) : container;
            if (!this.container) {
                console.warn('SearchableDropdown: Container not found');
                return;
            }

            this.options = options.options || [];
            this.placeholder = options.placeholder || 'Select an option';
            this.searchPlaceholder = options.searchPlaceholder || 'Search...';
            this.onChange = options.onChange || (() => {});
            this.virtualScroll = options.virtualScroll !== undefined ? options.virtualScroll : this.options.length > 50;
            this.itemHeight = options.itemHeight || 40;
            this.selectedValue = options.value !== undefined ? options.value : null;
            this.filteredOptions = [...this.options];
            this.highlightedIndex = -1;
            this.isOpen = false;
            this.id = options.id || `sd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            this.disabled = options.disabled || false;
            this.compact = options.compact || false;
            this.linkedSelect = options.linkedSelect || null; // For form sync
            // Optional inline "+" button next to the search input.
            // Usage: quickAdd: { title: 'Add account', onClick: () => openModal() }
            // or simply quickAdd: () => openModal()   (shorthand)
            this.quickAdd = typeof options.quickAdd === 'function'
                ? { title: 'Add new', onClick: options.quickAdd }
                : (options.quickAdd || null);
            // Optional "create what you typed" row, for pickers backed by a resolve-or-create endpoint
            // (brands, tags) where making the user leave the form to define a value first is the whole
            // friction we are removing.
            // Usage: allowCreate: true   or   allowCreate: { label: 'Add' }
            //
            // ⭐ The typed name is held as a PENDING CREATE, never as a value. selectedValue stays null and
            // data-value stays empty, so nothing that reads getValue() or the DOM can mistake a name the
            // backend has not resolved yet for a real id. Callers opt in explicitly via getPendingCreate().
            this.allowCreate = options.allowCreate === true ? {} : (options.allowCreate || null);
            this.pendingCreate = null;
            this.lastQuery = '';

            // If a prior instance was registered under this SAME id, tear it down first. The accounts
            // full-page forms re-create dropdowns on fixed container ids (itCatDD, challanCustomerSD,
            // soCustomerSD, …) on every open; without this, each reopen orphans the prior instance's
            // persistent document 'click' listener (bindEvents' self-cleanup only removes its OWN handler),
            // stacking listeners → unbounded memory + per-click CPU growth across a back-office session.
            const prior = instances.get(this.id);
            // Listener-only teardown: render() below replaces the SAME container's innerHTML, so we must NOT
            // remove the container (full destroy() does) — only detach the prior instance's leaked document/window
            // listeners and registry entry.
            if (prior && prior !== this && typeof prior._teardownListeners === 'function') prior._teardownListeners();

            this.render();
            this.bindEvents();

            // Store reference
            instances.set(this.id, this);
        }

        render() {
            const selectedOption = this.options.find(o => String(o.value) === String(this.selectedValue));
            const displayText = selectedOption ? selectedOption.label : '';
            const compactClass = this.compact ? 'searchable-dropdown--compact' : '';
            const disabledClass = this.disabled ? 'searchable-dropdown--disabled' : '';

            this.container.innerHTML = `
                <div class="searchable-dropdown ${compactClass} ${disabledClass}" id="${this.id}-dropdown" data-value="${escapeHtml(String(this.selectedValue || ''))}">
                    <div class="searchable-dropdown-trigger" tabindex="${this.disabled ? -1 : 0}" role="combobox" aria-haspopup="listbox" aria-expanded="false">
                        <span class="searchable-dropdown-text ${!displayText ? 'placeholder' : ''}">${escapeHtml(displayText) || escapeHtml(this.placeholder)}</span>
                        <svg class="searchable-dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                    <div class="searchable-dropdown-menu" role="listbox">
                        <div class="searchable-dropdown-search">
                            <svg class="searchable-dropdown-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.35-4.35"></path>
                            </svg>
                            <input type="text" placeholder="${escapeHtml(this.searchPlaceholder)}" autocomplete="off" aria-label="Search options">
                            ${this.quickAdd ? `
                                <button type="button" class="searchable-dropdown-quick-add" aria-label="${escapeHtml(this.quickAdd.title || 'Add new')}" title="${escapeHtml(this.quickAdd.title || 'Add new')}">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                        <line x1="12" y1="5" x2="12" y2="19"></line>
                                        <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        <div class="searchable-dropdown-options">
                            ${this.renderOptions()}
                        </div>
                    </div>
                </div>
            `;

            this.dropdownEl = this.container.querySelector('.searchable-dropdown');
            this.triggerEl = this.container.querySelector('.searchable-dropdown-trigger');
            this.menuEl = this.container.querySelector('.searchable-dropdown-menu');
            this.searchInput = this.container.querySelector('.searchable-dropdown-search input');
            this.optionsEl = this.container.querySelector('.searchable-dropdown-options');
            this.textEl = this.container.querySelector('.searchable-dropdown-text');
        }

        /**
         * The "create «typed text»" row, or '' when it does not apply.
         * Suppressed on an EXACT case-insensitive label match, because offering to create something that
         * already exists is how a list ends up with "Sunfeast" and "sunfeast" as two separate records.
         */
        renderCreateRow() {
            if (!this.allowCreate) return '';
            const q = (this.lastQuery || '').trim();
            if (!q) return '';
            if (this.options.some(o => (o.label || '').trim().toLowerCase() === q.toLowerCase())) return '';

            const verb = this.allowCreate.label || 'Create';
            return `
                <div class="searchable-dropdown-create" role="option" data-query="${escapeHtml(q)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>${escapeHtml(verb)} &ldquo;<strong>${escapeHtml(q)}</strong>&rdquo;</span>
                </div>
            `;
        }

        renderOptions() {
            const createRow = this.renderCreateRow();

            if (this.filteredOptions.length === 0) {
                return createRow || '<div class="searchable-dropdown-empty">No results found</div>';
            }

            if (this.virtualScroll && this.filteredOptions.length > 50) {
                return createRow + this.renderVirtualOptions();
            }

            return createRow + this.filteredOptions.map((option, index) => `
                <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''} ${index === this.highlightedIndex ? 'highlighted' : ''}"
                     data-value="${escapeHtml(String(option.value))}"
                     data-index="${index}"
                     role="option"
                     aria-selected="${String(option.value) === String(this.selectedValue)}">
                    <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                    ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                    <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
            `).join('');
        }

        renderVirtualOptions() {
            const totalHeight = this.filteredOptions.length * this.itemHeight;
            const visibleCount = Math.ceil(220 / this.itemHeight) + 2;

            return `
                <div class="searchable-dropdown-virtual" style="height: ${totalHeight}px; position: relative;">
                    <div class="searchable-dropdown-virtual-viewport" style="position: absolute; top: 0; left: 0; right: 0;">
                        ${this.filteredOptions.slice(0, visibleCount).map((option, index) => `
                            <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''}"
                                 data-value="${escapeHtml(String(option.value))}"
                                 data-index="${index}"
                                 style="height: ${this.itemHeight}px;"
                                 role="option">
                                <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                                ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                                <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        bindEvents() {
            if (this.disabled) return;

            // Toggle dropdown on trigger click
            this.triggerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggle();
            });

            // Keyboard navigation on trigger
            this.triggerEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggle();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.open();
                } else if (e.key === 'Escape') {
                    this.close();
                }
            });

            // Search input
            this.searchInput.addEventListener('input', (e) => {
                this.filter(e.target.value);
            });

            this.searchInput.addEventListener('keydown', (e) => {
                this.handleKeydown(e);
            });

            // Prevent search input click from closing
            this.searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Quick-add button — fires the user's callback. The callback is
            // responsible for showing its own modal; after it resolves with
            // a new item, it can update this dropdown via refreshOptions().
            const quickAddBtn = this.container.querySelector('.searchable-dropdown-quick-add');
            if (quickAddBtn && this.quickAdd && this.quickAdd.onClick) {
                quickAddBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.close();
                    Promise.resolve(this.quickAdd.onClick(this)).catch(err => {
                        console.warn('[SearchableDropdown] quickAdd onClick threw', err);
                    });
                });
            }

            // Option click
            this.optionsEl.addEventListener('click', (e) => {
                // Checked BEFORE the option lookup: the create row deliberately carries no data-value, so
                // falling through to select() would resolve nothing and silently do nothing at all.
                const createEl = e.target.closest('.searchable-dropdown-create');
                if (createEl) { this.commitCreate(createEl.dataset.query); return; }

                const optionEl = e.target.closest('.searchable-dropdown-option');
                if (optionEl && !optionEl.classList.contains('disabled')) {
                    this.select(optionEl.dataset.value);
                }
            });

            // Virtual scroll
            if (this.virtualScroll) {
                this.optionsEl.addEventListener('scroll', () => this.handleVirtualScroll());
            }

            // Close on outside click. bindEvents() re-runs on every render()/refreshOptions(); the trigger/
            // search/options listeners live on freshly-rebuilt DOM (GC'd with the old innerHTML), but this one
            // is on the persistent `document`. Track it and remove the prior handler before re-adding, else
            // each refresh (quick-add refreshes every line dropdown) permanently stacks another document
            // listener → unbounded memory + per-click CPU growth within a session.
            if (this._docClickHandler) document.removeEventListener('click', this._docClickHandler);
            this._docClickHandler = (e) => {
                // Self-evict if our container has been removed from the DOM (e.g. a deleted invoice/challan/SO
                // line row whose dropdown used a generated id, so the constructor's same-id teardown can't catch
                // it). Without this, the instance lingers in the registry with this persistent listener forever.
                if (!this.container || !this.container.isConnected) { this._teardownListeners(); return; }
                if (this.isOpen && !this.container.contains(e.target)) {
                    this.close();
                }
            };
            document.addEventListener('click', this._docClickHandler);
        }

        handleKeydown(e) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.highlightNext();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.highlightPrev();
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (this.highlightedIndex >= 0 && this.filteredOptions[this.highlightedIndex]) {
                        this.select(this.filteredOptions[this.highlightedIndex].value);
                    } else if (this.renderCreateRow()) {
                        // Nothing highlighted and a create row is showing — i.e. the query matched no
                        // existing option. Enter is the natural key for "yes, that new one", and without
                        // this the keyboard path dead-ends where the mouse path works.
                        this.commitCreate(this.lastQuery);
                    }
                    break;
                case 'Escape':
                    this.close();
                    this.triggerEl.focus();
                    break;
                case 'Tab':
                    this.close();
                    break;
            }
        }

        handleVirtualScroll() {
            if (!this.virtualScroll) return;

            const scrollTop = this.optionsEl.scrollTop;
            const startIndex = Math.floor(scrollTop / this.itemHeight);
            const visibleCount = Math.ceil(220 / this.itemHeight) + 2;
            const endIndex = Math.min(startIndex + visibleCount, this.filteredOptions.length);

            const viewport = this.optionsEl.querySelector('.searchable-dropdown-virtual-viewport');
            if (viewport) {
                viewport.style.top = `${startIndex * this.itemHeight}px`;
                viewport.innerHTML = this.filteredOptions.slice(startIndex, endIndex).map((option, i) => `
                    <div class="searchable-dropdown-option ${String(option.value) === String(this.selectedValue) ? 'selected' : ''}"
                         data-value="${escapeHtml(String(option.value))}"
                         data-index="${startIndex + i}"
                         style="height: ${this.itemHeight}px;"
                         role="option">
                        <span class="searchable-dropdown-option-label">${escapeHtml(option.label)}</span>
                        ${option.description ? `<span class="searchable-dropdown-option-desc">${escapeHtml(option.description)}</span>` : ''}
                        <svg class="searchable-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                `).join('');
            }
        }

        highlightNext() {
            if (this.highlightedIndex < this.filteredOptions.length - 1) {
                this.highlightedIndex++;
                this.updateHighlight();
            }
        }

        highlightPrev() {
            if (this.highlightedIndex > 0) {
                this.highlightedIndex--;
                this.updateHighlight();
            }
        }

        updateHighlight() {
            const options = this.optionsEl.querySelectorAll('.searchable-dropdown-option');
            options.forEach((el, i) => {
                el.classList.toggle('highlighted', parseInt(el.dataset.index) === this.highlightedIndex);
            });

            // Scroll highlighted option into view
            const highlighted = this.optionsEl.querySelector('.searchable-dropdown-option.highlighted');
            if (highlighted) {
                highlighted.scrollIntoView({ block: 'nearest' });
            }
        }

        filter(query) {
            this.lastQuery = query;
            const q = query.toLowerCase().trim();
            this.filteredOptions = this.options.filter(option => {
                const label = (option.label || '').toLowerCase();
                const desc = (option.description || '').toLowerCase();
                const value = String(option.value || '').toLowerCase();
                return label.includes(q) || desc.includes(q) || value.includes(q);
            });
            this.highlightedIndex = this.filteredOptions.length > 0 ? 0 : -1;
            this.optionsEl.innerHTML = this.renderOptions();
        }

        toggle() {
            if (this.disabled) return;
            // Check actual class state instead of property (in case another dropdown forcibly closed us)
            const isCurrentlyOpen = this.dropdownEl.classList.contains('open');
            if (isCurrentlyOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        open() {
            if (this.disabled) return;

            // Close all other open dropdowns first
            instances.forEach((instance, id) => {
                if (id !== this.id && instance.isOpen) {
                    instance.close();
                }
            });

            // Also close any open MonthPickers
            document.querySelectorAll('.month-picker.open').forEach(picker => {
                picker.classList.remove('open');
            });

            // Close any open flatpickr custom month/year dropdowns
            // ⭐⭐ SWEEP ORPHANED MENUS BEFORE OPENING ANOTHER.
            //
            // While open, a menu is PORTALED to <body> to escape overflow and stacking ancestors. If the
            // thing that owned it — a dynamically created modal, a re-rendered table row — is removed from
            // the DOM without close() being called first, the menu stays in <body> forever: visible,
            // positioned, and belonging to nothing. It was reported as a list of GL accounts floating over
            // the page with no modal in sight.
            //
            // Every call site remembering to close first is the fragile fix; this is the one that holds. The
            // check is by OWNERSHIP, not by age or count: a portaled menu is orphaned exactly when its own
            // dropdown element is no longer in the document, which is cheap to ask and impossible to get
            // wrong. Menus belonging to live dropdowns are untouched.
            document.querySelectorAll('body > .searchable-dropdown-menu--portaled').forEach(m => {
                const owner = m._sdOwner;
                if (!owner || !document.contains(owner)) m.remove();
            });

            // A TRIGGER WITH NO LAYOUT BOX IS NOT ON SCREEN, AND ANCHORING TO IT LANDS IN THE CORNER.
            //
            // positionMenu() anchors the menu to triggerEl.getBoundingClientRect(). Inside a
            // `display: none` ancestor that rect is all zeros, so the escape path portals the menu into
            // <body> at `top: 4px; left: 0` — a full-width list pinned to the top-left corner of the
            // screen, over whatever page is actually showing. It was reported exactly that way.
            //
            // Zero rect means the trigger is not laid out, so no user can have clicked it; the open came
            // from code (a restored tab, a programmatic open, a race with a container being shown).
            // Refusing is therefore always right: there is nothing to anchor to and nobody watching.
            const triggerRect = this.triggerEl.getBoundingClientRect();
            if (triggerRect.width === 0 && triggerRect.height === 0) return;

            document.dispatchEvent(new CustomEvent('dropdownOpened'));

            this.isOpen = true;
            this.dropdownEl.classList.add('open');
            this.triggerEl.setAttribute('aria-expanded', 'true');
            this.searchInput.value = '';
            // Must track the cleared box: renderOptions() reads lastQuery, so a leftover query from the
            // previous open would draw a "Create «…»" row above a full, unfiltered list.
            this.lastQuery = '';
            this.filteredOptions = [...this.options];
            this.highlightedIndex = -1;
            this.optionsEl.innerHTML = this.renderOptions();

            // Position menu if needed (for dropdowns near bottom of screen)
            this.positionMenu();

            // Inside a glassmorphic modal, lay down a dim scrim over the
            // modal body so the active dropdown reads as the only thing in
            // focus. Without this, the row underneath the open trigger
            // remains visible (column 1 next to the 240px menu), which
            // looks like the menu is bleeding through transparent layers.
            this._showModalScrim();

            setTimeout(() => this.searchInput.focus(), 10);
        }

        _showModalScrim() {
            const modal = this.dropdownEl.closest('.gm-modal');
            if (!modal) return;
            let scrim = modal.querySelector(':scope > .gm-dropdown-scrim');
            if (!scrim) {
                scrim = document.createElement('div');
                scrim.className = 'gm-dropdown-scrim';
                modal.appendChild(scrim);
            }
            scrim.style.display = 'block';
            this._scrimEl = scrim;
        }

        _hideModalScrim() {
            if (this._scrimEl) {
                this._scrimEl.style.display = 'none';
                this._scrimEl = null;
            }
        }

        close() {
            this.isOpen = false;
            this.dropdownEl.classList.remove('open');
            this.dropdownEl.classList.remove('open-up');
            this.triggerEl.setAttribute('aria-expanded', 'false');
            this.highlightedIndex = -1;
            this._hideModalScrim();
            // Reset inline styles from fixed-escape positioning + restore the
            // menu element back to its original parent (we portaled it to
            // <body> on open to escape transformed ancestors).
            if (this.menuEl && this._fixedEscapeActive) {
                this.menuEl.classList.remove('searchable-dropdown-menu--portaled');
                this.menuEl.style.position = '';
                this.menuEl.style.top = '';
                this.menuEl.style.left = '';
                this.menuEl.style.width = '';
                this.menuEl.style.zIndex = '';
                this.menuEl.style.transform = '';
                this.menuEl.style.display = '';
                if (this._menuOriginalParent && this.menuEl.parentElement === document.body) {
                    if (this._menuOriginalNextSibling && this._menuOriginalNextSibling.parentElement === this._menuOriginalParent) {
                        this._menuOriginalParent.insertBefore(this.menuEl, this._menuOriginalNextSibling);
                    } else {
                        this._menuOriginalParent.appendChild(this.menuEl);
                    }
                }
                this._menuOriginalParent = null;
                this._menuOriginalNextSibling = null;
                this._fixedEscapeActive = false;
            }
            this._detachReposition();
        }

        /**
         * ⭐⭐⭐ THE HORIZONTAL AXIS, WHICH THIS COMPONENT NEVER HAD.
         *
         * positionMenu() handles the VERTICAL axis with real care — it flips to
         * `open-up` when there is not enough room below, treats a modal footer as
         * the bottom limit, and closes when the trigger scrolls off. For the
         * horizontal axis it did `left = rect.left` and nothing else.
         *
         * So a trigger near the right edge opened a menu straight off the screen.
         * Measured on the calendar's "Whose diary" filter: the menu ran 1319→1559
         * in a 1440px viewport — 119px of it outside — and because body.dashboard
         * is `overflow: hidden`, it was CLIPPED rather than scrollable. The search
         * box and every name were cut in half with no way to reach them.
         *
         * The component was not wrong about the axis it considered; it was blind
         * to the perpendicular one.
         *
         * Preference order: align left with the trigger (what it always did),
         * else right-align to the trigger so the menu grows back over its own
         * control, else clamp into the viewport. Returns a left coordinate.
         *
         * This is the ONLY place that decides it. `left` was being assigned in two
         * places — initial placement and the scroll handler — so fixing one would
         * have been fixing neither: the menu would jump back off-screen on the
         * first scroll.
         */
        static menuLeftFor(rect, menuWidth, viewportWidth) {
            const MARGIN = 8;
            let left = rect.left;
            if (left + menuWidth > viewportWidth - MARGIN) {
                left = rect.right - menuWidth;           // right-align to the trigger
            }
            if (left < MARGIN) left = MARGIN;            // and never off the other edge
            return left;
        }

        /** Width the menu will take, so placement and sizing cannot disagree. */
        static menuWidthFor(rect) {
            return Math.max(rect.width, 240);
        }

        positionMenu() {
            const rect = this.triggerEl.getBoundingClientRect();
            const menuHeight = 280; // Approximate max height
            // When the trigger is inside a glassmorphic modal, treat the
            // modal footer's top edge as the bottom limit — opening into
            // the footer crashes the menu over scrolling content + the
            // action buttons, which looks unfinished. Falls back to the
            // viewport bottom when not in a modal.
            // A modal's pinned footer bar is the real bottom limit — opening a menu down into it
            // crashes the list over the action buttons (or off-screen, past a full-page modal's
            // footer). Handle both the glassmorphic (.gm-modal/.gm-footer) and the standard/full-page
            // (.modal/.modal-footer) shells.
            const modal = this.dropdownEl.closest('.gm-modal, .modal');
            const footer = modal ? modal.querySelector('.gm-footer, .modal-footer') : null;
            const bottomLimit = footer
                ? footer.getBoundingClientRect().top
                : window.innerHeight;
            const spaceBelow = bottomLimit - rect.bottom;
            const spaceAbove = rect.top;

            if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                this.dropdownEl.classList.add('open-up');
            } else {
                this.dropdownEl.classList.remove('open-up');
            }

            // If ANY ancestor has overflow: auto/hidden/scroll, the menu (which
            // is absolutely positioned relative to the dropdown) will get
            // clipped. Detect that and promote the menu to position:fixed so
            // it escapes every overflow ancestor.
            this._fixedEscapeActive = false;
            let el = this.dropdownEl.parentElement;
            while (el && el !== document.body) {
                const cs = getComputedStyle(el);
                const ox = cs.overflowX, oy = cs.overflowY;
                if (ox === 'auto' || ox === 'hidden' || ox === 'scroll' ||
                    oy === 'auto' || oy === 'hidden' || oy === 'scroll') {
                    this._fixedEscapeActive = true;
                    break;
                }
                // An ancestor that opens a STACKING CONTEXT traps the menu just
                // as effectively as one that clips it, and the symptom is worse
                // because nothing looks broken: the menu opens, correctly
                // placed, underneath whatever paints next. No z-index on the
                // menu can win it, because the contest is settled between
                // ancestors, not between the menu and the thing covering it.
                // The CRM analytics filter bar hit exactly this — its team
                // filter opened behind the Executive Summary card below it.
                if (createsStackingContext(el, cs)) {
                    this._fixedEscapeActive = true;
                    break;
                }
                el = el.parentElement;
            }
            // The non-portaled path is positioned by CSS (`left: 0; right: 0`) and
            // overflows to the right exactly the same way when the trigger sits
            // near the viewport edge — the menu has a 240px floor, so a narrow
            // trigger cannot contain it. Fixing only the portaled path would have
            // left every dropdown NOT inside an overflow/stacking ancestor broken,
            // which is most of them.
            const cssMenuWidth = Dropdown.menuWidthFor(rect);
            this.dropdownEl.classList.toggle(
                'align-right', rect.left + cssMenuWidth > window.innerWidth - 8);

            if (this._fixedEscapeActive) {
                const openUp = this.dropdownEl.classList.contains('open-up');
                const top = openUp ? (rect.top - 4) : (rect.bottom + 4);
                // Portal the menu into <body> — any transformed/filtered
                // ancestor (e.g., modal-content has `transform: matrix(...)`)
                // would otherwise anchor `position: fixed` to the ancestor
                // instead of the viewport, throwing the menu way offset.
                if (this.menuEl.parentElement !== document.body) {
                    this._menuOriginalParent = this.menuEl.parentElement;
                    this._menuOriginalNextSibling = this.menuEl.nextSibling;
                    document.body.appendChild(this.menuEl);
                }
                // Tag the portaled menu so it can be styled/selected even
                // outside its original parent's stacking context.
                this.menuEl.classList.add('searchable-dropdown-menu--portaled');
                // Who this menu belongs to, so an orphan is identifiable once its owner is gone. A DOM
                // reference, not an id: ids are not unique across dynamically created modals.
                this.menuEl._sdOwner = this.dropdownEl;
                this.menuEl.style.position = 'fixed';
                this.menuEl.style.top = `${top}px`;
                const menuWidth = Dropdown.menuWidthFor(rect);
                this.menuEl.style.left =
                    `${Dropdown.menuLeftFor(rect, menuWidth, window.innerWidth)}px`;
                // Match trigger width as the FLOOR (so wide triggers still get a
                // wide menu) but never narrower than 240 px — same floor as the
                // CSS rule, kept in sync here so portaled menus don't truncate
                // labels like "Frontend Developer (2 yrs)" when the trigger is
                // a compact toolbar pill.
                this.menuEl.style.width = `${menuWidth}px`;
                // Must beat every modal z-index in the app. The research custom-table
                // modal alone uses 1000001; its code-include popover uses 1000010.
                // Portaled menu has to sit above both so dropdowns inside those modals
                // are still interactive.
                this.menuEl.style.zIndex = '2000000';
                // The default rule `.searchable-dropdown.open .searchable-dropdown-menu`
                // no longer applies once we've portaled out of that ancestor,
                // so reveal the menu explicitly.
                this.menuEl.style.display = 'block';
                if (openUp) {
                    this.menuEl.style.transform = 'translateY(-100%)';
                } else {
                    this.menuEl.style.transform = '';
                }
                // When anything scrolls, reposition — or close if the trigger
                // is clearly offscreen.
                if (!this._repositionHandler) {
                    this._repositionHandler = () => {
                        if (!this.isOpen) return;
                        const r = this.triggerEl.getBoundingClientRect();
                        if (r.bottom < 0 || r.top > window.innerHeight ||
                            r.right < 0 || r.left > window.innerWidth) {
                            this.close();
                            return;
                        }
                        this.menuEl.style.top  = `${openUp ? r.top - 4 : r.bottom + 4}px`;
                        this.menuEl.style.left = `${Dropdown.menuLeftFor(
                            r, Dropdown.menuWidthFor(r), window.innerWidth)}px`;
                    };
                    window.addEventListener('scroll', this._repositionHandler, true);
                    window.addEventListener('resize', this._repositionHandler);
                }
            } else {
                // Reset inline style if we previously used fixed
                this.menuEl.style.position = '';
                this.menuEl.style.top = '';
                this.menuEl.style.left = '';
                this.menuEl.style.width = '';
                this.menuEl.style.zIndex = '';
                this.menuEl.style.transform = '';
            }
        }

        _detachReposition() {
            if (this._repositionHandler) {
                window.removeEventListener('scroll', this._repositionHandler, true);
                window.removeEventListener('resize', this._repositionHandler);
                this._repositionHandler = null;
            }
        }

        /**
         * Replace the option list and optionally set a new selected value.
         * Used by quick-add flows: user opens a "create new" modal, saves,
         * and the dropdown re-pulls the refreshed list with the new item
         * auto-selected.
         */
        refreshOptions(newOptions, newValue) {
            // The usual caller is a quick-add flow that has just PERSISTED the thing — so a staged name is
            // now either a real option or abandoned. Either way it must not survive into the save payload.
            this.pendingCreate = null;
            this.lastQuery = '';
            this.options = newOptions || [];
            this.filteredOptions = [...this.options];
            if (newValue !== undefined) this.selectedValue = newValue;
            this.render();
            this.bindEvents();
        }

        /**
         * Adopt the typed text as a pending new value. See the allowCreate note in the constructor for why
         * this never becomes selectedValue.
         */
        commitCreate(query) {
            const q = (query || '').trim();
            if (!q) return;

            this.pendingCreate = q;
            this.selectedValue = null;
            this.textEl.textContent = q;
            this.textEl.classList.remove('placeholder');
            this.dropdownEl.dataset.value = '';
            if (this.linkedSelect) {
                this.linkedSelect.value = '';
                this.linkedSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            this.close();

            this.onChange(null, { value: null, label: q, isNew: true });
        }

        /** The name the user typed and asked to create, or null. Cleared by any real selection. */
        getPendingCreate() {
            return this.pendingCreate;
        }

        select(value) {
            const option = this.options.find(o => String(o.value) === String(value));
            if (option) {
                // Picking a real option abandons any pending name — otherwise a user who types "Sunfest",
                // notices the typo, and then picks the existing "Sunfeast" would still create the typo.
                this.pendingCreate = null;
                this.selectedValue = option.value;
                this.textEl.textContent = option.label;
                this.textEl.classList.remove('placeholder');
                this.dropdownEl.dataset.value = option.value;
                this.close();

                // Sync with linked select element
                if (this.linkedSelect) {
                    this.linkedSelect.value = option.value;
                    this.linkedSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }

                this.onChange(option.value, option);
            }
        }

        getValue() {
            return this.selectedValue;
        }

        setValue(value, triggerChange = false) {
            // Programmatic assignment is authoritative — it replaces whatever the user had staged, including
            // a pending create. Reopening a form on a saved record must not resurrect a name from last time.
            this.pendingCreate = null;
            const option = this.options.find(o => String(o.value) === String(value));
            if (option) {
                this.selectedValue = option.value;
                this.textEl.textContent = option.label;
                this.textEl.classList.remove('placeholder');
                this.dropdownEl.dataset.value = option.value;

                if (this.linkedSelect) {
                    this.linkedSelect.value = option.value;
                }

                if (triggerChange) {
                    this.onChange(option.value, option);
                }
            } else {
                this.selectedValue = null;
                this.textEl.textContent = this.placeholder;
                this.textEl.classList.add('placeholder');
                this.dropdownEl.dataset.value = '';

                if (this.linkedSelect) {
                    this.linkedSelect.value = '';
                }
            }
        }

        setOptions(options, preserveValue = true) {
            this.pendingCreate = null;
            this.lastQuery = '';
            const previousValue = this.selectedValue;
            this.options = options;
            this.filteredOptions = [...options];

            // Check if previous value still exists
            if (preserveValue && previousValue !== null) {
                const stillExists = options.find(o => String(o.value) === String(previousValue));
                if (!stillExists) {
                    this.selectedValue = null;
                    this.textEl.textContent = this.placeholder;
                    this.textEl.classList.add('placeholder');
                    this.dropdownEl.dataset.value = '';
                }
            }

            // Sync options to linked native select for form validation
            if (this.linkedSelect) {
                this.linkedSelect.innerHTML = options.map(opt =>
                    `<option value="${escapeHtml(String(opt.value))}">${escapeHtml(String(opt.label))}</option>`
                ).join('');
                // Sync the current value
                if (this.selectedValue !== null) {
                    this.linkedSelect.value = this.selectedValue;
                }
            }

            // Update virtual scroll threshold
            this.virtualScroll = options.length > 50;

            // Always re-render options (not just when open) so they're ready when dropdown opens
            this.optionsEl.innerHTML = this.renderOptions();
        }

        setDisabled(disabled) {
            this.disabled = disabled;
            this.dropdownEl.classList.toggle('searchable-dropdown--disabled', disabled);
            this.triggerEl.tabIndex = disabled ? -1 : 0;
            if (disabled && this.isOpen) {
                this.close();
            }
        }

        // Detach everything this instance attached OUTSIDE its own container (the persistent document 'click'
        // listener + the window reposition listeners) and drop it from the registry — WITHOUT touching the
        // container DOM. Safe to call when the container will be reused (constructor same-id teardown, in-place
        // uom rebuild) or is already detached (deleted line row). This is the leak-safe teardown.
        _teardownListeners() {
            instances.delete(this.id);
            if (this._docClickHandler) { document.removeEventListener('click', this._docClickHandler); this._docClickHandler = null; }
            this._detachReposition();
            // Detach the wrapper-level subscriptions convertSelectToSearchable attached on the linked <select> /
            // parent form (change/reset listeners + the options MutationObserver). These live on elements OUTSIDE
            // this dropdown's container, so without explicit teardown they leak on every re-conversion.
            if (this._linkedChangeHandler && this._linkedSelectEl) { this._linkedSelectEl.removeEventListener('change', this._linkedChangeHandler); this._linkedChangeHandler = null; }
            if (this._linkedResetHandler && this._linkedResetForm) { this._linkedResetForm.removeEventListener('reset', this._linkedResetHandler); this._linkedResetHandler = null; }
            if (this._linkedOptionsObserver) { this._linkedOptionsObserver.disconnect(); this._linkedOptionsObserver = null; }
            // NOTE: do NOT restore the linkedSelect's visibility here. This runs on the REUSE paths
            // (constructor same-id teardown, self-eviction, uom rebuild) where the container is kept and a new
            // instance is about to render over it — un-hiding the native <select> would leave a duplicate
            // control stacked next to the searchable dropdown (e.g. re-conversion via convertSelectToSearchable).
            // The linkedSelect is only un-hidden on TRUE disposal (destroy()).
        }

        destroy() {
            this._teardownListeners();
            // True disposal: restore the original native <select> and remove the container from the DOM.
            if (this.linkedSelect) {
                this.linkedSelect.style.display = '';
                this.linkedSelect.removeAttribute('data-searchable');
            }
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
        }

        // Static method to get instance by ID
        static getInstance(id) {
            return instances.get(id);
        }

        // Static method to get all instances
        static getAllInstances() {
            return instances;
        }
    }

    return Dropdown;
})();

/**
 * Helper function to convert existing select element to searchable dropdown
 * @param {string} selectId - ID of the select element to convert
 * @param {object} options - Additional options
 * @returns {SearchableDropdown} The created dropdown instance
 */
function convertSelectToSearchable(selectId, options = {}) {
    const select = document.getElementById(selectId);
    if (!select) {
        console.warn(`convertSelectToSearchable: Select element '${selectId}' not found`);
        return null;
    }

    // Remove any existing searchable container for this select
    const existingContainer = document.getElementById(`${selectId}-searchable-container`);
    if (existingContainer) {
        existingContainer.remove();
    }
    // Also remove any container created by the global auto-searchable-select
    // helper (it inserts a `.sd-auto-container` as a sibling to convert every
    // native <select> at page load). Without this cleanup, calling
    // convertSelectToSearchable explicitly in page code would leave a
    // duplicate dropdown stacked on top.
    const prev = select.previousElementSibling;
    const next = select.nextElementSibling;
    if (prev && prev.classList?.contains('sd-auto-container')) prev.remove();
    if (next && next.classList?.contains('sd-auto-container')) next.remove();
    delete select.dataset.sdConverted;
    select.style.display = '';
    select.removeAttribute('data-searchable');

    // Extract options from select
    const selectOptions = Array.from(select.options).map(opt => ({
        value: opt.value,
        label: opt.textContent.trim(),
        description: opt.dataset.description || ''
    }));

    // Create container for the dropdown
    const container = document.createElement('div');
    container.id = `${selectId}-searchable-container`;
    container.className = 'searchable-dropdown-wrapper';
    select.parentNode.insertBefore(container, select);

    // Hide original select but keep it for form submission
    select.style.display = 'none';
    select.setAttribute('data-searchable', 'true');

    // Create dropdown
    const dropdown = new SearchableDropdown(container, {
        id: selectId,
        options: selectOptions,
        value: select.value,
        placeholder: options.placeholder || select.options[0]?.textContent || 'Select...',
        searchPlaceholder: options.searchPlaceholder || 'Search...',
        virtualScroll: options.virtualScroll !== undefined ? options.virtualScroll : selectOptions.length > 50,
        compact: options.compact || false,
        linkedSelect: select,
        onChange: (value, option) => {
            // Additional onChange handler if provided
            if (options.onChange) {
                options.onChange(value, option);
            }
        }
    });

    // Observe external mutations of the linked native <select>. When other code
    // does `select.value = "foo"; select.dispatchEvent(new Event("change"))`,
    // the wrapper's visible label, internal selectedValue, and data-value attr
    // would otherwise stay stale. The value-comparison guard prevents recursion
    // when the wrapper itself triggers the change event from setValue().
    const syncFromLinked = () => {
        if (String(select.value) !== String(dropdown.getValue() ?? '')) {
            dropdown.setValue(select.value, false);
        }
    };
    select.addEventListener('change', syncFromLinked);
    // Track the wrapper-level subscriptions on the instance so _teardownListeners()/destroy() can detach them.
    // Re-converting the SAME select id (dependent dropdowns, PMS Time Tracking project switch, etc.) runs the
    // constructor's same-id teardown on the prior instance — which now also removes these — instead of stacking
    // a fresh change/reset/observer set on the live <select> every time (unbounded listeners + retained dead
    // instances whose observer closures keep rewriting the shared <select>).
    dropdown._linkedSelectEl = select;
    dropdown._linkedChangeHandler = syncFromLinked;

    // form.reset() does NOT fire 'change' on selects, so we also need to listen
    // on the parent form's 'reset' event. Without this, reopening a modal after
    // a previous fill-and-cancel leaves stale labels in every wrapped dropdown
    // (the underlying select gets reset to the first option, but the wrapper's
    // visible text and data-value attribute stay frozen at the previous values).
    const parentForm = select.closest('form');
    if (parentForm) {
        const resetHandler = () => {
            // 'reset' fires before the form actually resets the controls; wait
            // one tick so we read the post-reset value of the linked select.
            setTimeout(syncFromLinked, 0);
        };
        parentForm.addEventListener('reset', resetHandler);
        dropdown._linkedResetForm = parentForm;
        dropdown._linkedResetHandler = resetHandler;
    }

    // Watch for external code rewriting the linked <select>.innerHTML — for
    // example, dependent dropdowns where the available options change when a
    // parent field is picked (Account Group filtered by Account Type, City
    // filtered by Country, etc.). Without this MutationObserver, the wrapper
    // would still hold the option list snapshot from conversion time and
    // wouldn't recognise newly-added options.
    if (typeof MutationObserver !== 'undefined') {
        const optionsObserver = new MutationObserver(() => {
            const newOpts = Array.from(select.options).map(opt => ({
                value: opt.value,
                label: opt.textContent.trim(),
                description: opt.dataset.description || ''
            }));
            // Skip if options haven't actually changed (avoids resetting the
            // user's selection on every spurious mutation).
            const oldKey = (dropdown.options || []).map(o => o.value + '|' + o.label).join('||');
            const newKey = newOpts.map(o => o.value + '|' + o.label).join('||');
            if (oldKey === newKey) return;
            dropdown.setOptions(newOpts, true);
            // After re-loading options, re-sync to the current native value
            // in case the rewrite also changed the selected value.
            syncFromLinked();
        });
        optionsObserver.observe(select, { childList: true, subtree: true, characterData: true });
        dropdown._linkedOptionsObserver = optionsObserver;
    }

    // Expose the dropdown instance on the linked <select> for callers that
    // want to manipulate it directly (rare; the observer above handles most
    // cases without anyone needing to know about the wrapper).
    select._searchableDropdown = dropdown;

    return dropdown;
}

/**
 * Batch convert multiple select elements
 * @param {Array} configs - Array of { id, options } objects
 * @returns {Map} Map of dropdown instances by ID
 */
function convertMultipleSelectsToSearchable(configs) {
    const dropdowns = new Map();
    configs.forEach(config => {
        const dropdown = convertSelectToSearchable(config.id, config.options || {});
        if (dropdown) {
            dropdowns.set(config.id, dropdown);
        }
    });
    return dropdowns;
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SearchableDropdown, convertSelectToSearchable, convertMultipleSelectsToSearchable };
}

// Make available globally
window.SearchableDropdown = SearchableDropdown;
window.convertSelectToSearchable = convertSelectToSearchable;
window.convertMultipleSelectsToSearchable = convertMultipleSelectsToSearchable;
