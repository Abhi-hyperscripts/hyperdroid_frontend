/**
 * Property listings — the developer's inventory, unit by unit
 * ----------------------------------------------------------------------------
 * Real estate sells a NAMED UNIT, not a quantity of a fungible good, and the CRM
 * had nowhere to say which flat. Accounts' stock machinery cannot help: its
 * holds carry a quantity with no serial, its serials carry no price, and its
 * locations are a flat store/warehouse/rack with no project → tower → floor.
 *
 *   GET    /crm/properties            the inventory, filtered
 *   GET    /crm/properties/projects   distinct project names for the filter
 *   POST   /crm/properties            list a unit
 *   PUT    /crm/properties/{id}       edit a listing
 *   DELETE /crm/properties/{id}       remove a listing
 *   POST   /crm/properties/{id}/claim hold it for a deal
 *   POST   /crm/properties/{id}/release
 *   PATCH  /crm/properties/{id}/status
 *
 * ⭐ TWO RULES DRIVE EVERY SCREEN HERE.
 * A unit cannot be sold twice — the server takes the hold with one conditional
 * UPDATE and answers 409 with the incumbent's hold when it loses. And a hold
 * EXPIRES: a unit whose hold has lapsed is back on the market even though its
 * row still says 'held', so this UI must compute availability from the clock
 * rather than trusting the status word.
 */
const PropertiesPage = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const state = {
        properties: [],
        projects: [],
        filter: { project: '', status: '', availableOnly: false, minPrice: '', maxPrice: '', bedrooms: '' },
        editing: null,
    };

    const STATUS_LABEL = { available: 'Available', held: 'On hold', booked: 'Booked', sold: 'Sold' };

    function money(amount, currency) {
        return amount === null || amount === undefined ? '—' : formatMoney(amount, currency);
    }

    /**
     * ⭐ AVAILABILITY IS COMPUTED FROM THE CLOCK, NOT READ FROM status.
     *
     * A unit whose hold has run out is sellable, and its row keeps saying 'held'
     * until something touches it — there is no sweep, deliberately, because the
     * expiry IS the truth. A screen that trusts the word turns buyers away from
     * flats nobody holds.
     */
    function effectiveStatus(p) {
        if (p.status === 'held' && holdHasExpired(p)) return 'available';
        return p.status;
    }

    function holdHasExpired(p) {
        return !!p.hold_expires_at && new Date(p.hold_expires_at) <= new Date();
    }

    function holdNote(p) {
        if (!p.held_by_deal_id) return '';
        const who = p.held_by_deal_name ? ` for ${esc(p.held_by_deal_name)}` : '';
        if (holdHasExpired(p)) return `Hold lapsed${who} — back on the market`;
        const until = new Date(p.hold_expires_at);
        return `Held${who} until ${esc(until.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}`;
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    function render() {
        const host = document.getElementById('propertiesContent');
        if (!host) return;

        const rows = state.properties;
        host.innerHTML = `
            ${filterMarkup()}
            ${rows.length === 0
                ? `<p class="prp-none">${state.properties.length === 0 && !anyFilter()
                    ? 'No units listed yet. Add the first one to start selling from the CRM.'
                    : 'No units match these filters.'}</p>`
                : `<div class="prp-grid">${rows.map(card).join('')}</div>`}
        `;
        mountProjectFilter();
    }

    function anyFilter() {
        const f = state.filter;
        return !!(f.project || f.status || f.availableOnly || f.minPrice || f.maxPrice || f.bedrooms);
    }

    function filterMarkup() {
        const f = state.filter;
        return `
        <div class="prp-filters">
            <label class="prp-filter">Project<span data-prp="project-host"></span></label>
            <label class="prp-filter">Status
                <span class="prp-chips" role="group" aria-label="Status">
                    ${['', 'available', 'held', 'booked', 'sold'].map(s => `
                        <button type="button" class="prp-chip${f.status === s ? ' is-on' : ''}" data-prp-status="${s}">
                            ${s ? esc(STATUS_LABEL[s]) : 'Any'}
                        </button>`).join('')}
                </span>
            </label>
            <label class="prp-filter">Bedrooms
                <input type="number" step="0.5" min="0" data-prp="bedrooms" value="${esc(f.bedrooms)}" placeholder="any">
            </label>
            <label class="prp-filter">Budget
                <span class="prp-range">
                    <input type="number" min="0" data-prp="minPrice" value="${esc(f.minPrice)}" placeholder="min">
                    <span>to</span>
                    <input type="number" min="0" data-prp="maxPrice" value="${esc(f.maxPrice)}" placeholder="max">
                </span>
            </label>
            <label class="prp-toggle">
                <input type="checkbox" data-prp="availableOnly" ${f.availableOnly ? 'checked' : ''}>
                <span>Only what I can sell</span>
            </label>
            <button type="button" class="btn btn-sm btn-secondary" data-prp="apply">Apply</button>
            <button type="button" class="btn btn-sm btn-secondary" data-prp="clear">Clear</button>
        </div>`;
    }

    function card(p) {
        const status = effectiveStatus(p);
        const note = holdNote(p);
        return `
        <article class="prp-card is-${esc(status)}" data-prp-id="${esc(p.id)}">
            <header class="prp-card-head">
                <div>
                    <h4 class="prp-card-title">${esc(p.display_name)}</h4>
                    <p class="prp-card-project">${esc(p.project)}</p>
                </div>
                <span class="prp-badge is-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
            </header>

            <p class="prp-card-price">${esc(money(p.price, p.currency))}</p>

            <ul class="prp-card-specs">
                ${p.bedrooms ? `<li>${esc(p.bedrooms)} BHK</li>` : ''}
                ${p.area_sqft ? `<li>${esc(Number(p.area_sqft).toLocaleString('en-IN'))} sq ft</li>` : ''}
                ${p.facing ? `<li>${esc(p.facing)} facing</li>` : ''}
                ${p.property_type ? `<li>${esc(p.property_type)}</li>` : ''}
            </ul>

            ${note ? `<p class="prp-card-hold${holdHasExpired(p) ? ' is-lapsed' : ''}">${note}</p>` : ''}
            ${p.notes ? `<p class="prp-card-notes">${esc(p.notes)}</p>` : ''}

            <footer class="prp-card-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-prp="edit">Edit</button>
                <button type="button" class="btn btn-sm btn-secondary" data-prp="delete">Remove</button>
            </footer>
        </article>`;
    }

    function mountProjectFilter() {
        const host = document.querySelector('[data-prp="project-host"]');
        if (!host) return;

        // A portaled menu outlives its host, so the previous instance is closed
        // AND destroyed before a new one replaces it.
        if (state.projectDropdown) {
            try { state.projectDropdown.close?.(); state.projectDropdown.destroy?.(); } catch (_) { /* gone */ }
            state.projectDropdown = null;
        }

        if (typeof SearchableDropdown === 'function') {
            state.projectDropdown = new SearchableDropdown(host, {
                options: [{ value: '', label: 'All projects' }]
                    .concat(state.projects.map(n => ({ value: n, label: n }))),
                placeholder: 'All projects',
                searchPlaceholder: 'Search projects…',
                compact: true,
                value: state.filter.project || '',
                onChange: (value) => { state.filter.project = value || ''; load(); },
            });
        } else {
            host.innerHTML = '<input type="text" data-prp="projectText" placeholder="All projects">';
        }
    }

    // ─── Data ───────────────────────────────────────────────────────────────

    function query() {
        const f = state.filter;
        const q = new URLSearchParams();
        if (f.project) q.set('project', f.project);
        if (f.status) q.set('status', f.status);
        if (f.bedrooms) q.set('bedrooms', f.bedrooms);
        if (f.minPrice) q.set('minPrice', f.minPrice);
        if (f.maxPrice) q.set('maxPrice', f.maxPrice);
        if (f.availableOnly) q.set('availableOnly', 'true');
        const s = q.toString();
        return s ? `?${s}` : '';
    }

    async function load() {
        try {
            const [properties, projects] = await Promise.all([
                api.request(`/crm/properties${query()}`),
                api.request('/crm/properties/projects'),
            ]);
            state.properties = Array.isArray(properties) ? properties : [];
            state.projects = Array.isArray(projects) ? projects : [];
        } catch (e) {
            console.error('Failed to load properties:', e);
            Toast.error(e.message || 'Could not load the property listing');
            state.properties = [];
        }
        render();
    }

    function readFilters() {
        const get = (k) => document.querySelector(`[data-prp="${k}"]`)?.value ?? '';
        state.filter.bedrooms = get('bedrooms');
        state.filter.minPrice = get('minPrice');
        state.filter.maxPrice = get('maxPrice');
        state.filter.availableOnly = !!document.querySelector('[data-prp="availableOnly"]')?.checked;
    }

    // ─── Editing ────────────────────────────────────────────────────────────

    function openEditor(property) {
        state.editing = property || null;
        const modal = document.getElementById('propertyModal');
        if (!modal) return;

        const p = property || {};
        document.getElementById('propertyModalTitle').textContent =
            property ? 'Edit unit' : 'List a unit';

        const set = (k, v) => { const el = modal.querySelector(`[data-prf="${k}"]`); if (el) el.value = v ?? ''; };
        set('project', p.project);
        set('tower', p.tower);
        set('floorNumber', p.floor_number);
        set('unitNumber', p.unit_number);
        set('propertyType', p.property_type);
        set('bedrooms', p.bedrooms);
        set('areaSqft', p.area_sqft);
        set('price', p.price);
        set('facing', p.facing);
        set('notes', p.notes);

        // Only the OVERLAY carries `active` — the CSS hides the modal through
        // its parent's opacity, so toggling the modal itself does nothing.
        document.getElementById('propertyModalOverlay')?.classList.add('active');
    }

    function closeEditor() {
        state.editing = null;
        document.getElementById('propertyModalOverlay')?.classList.remove('active');
    }

    async function saveEditor() {
        const modal = document.getElementById('propertyModal');
        const get = (k) => modal.querySelector(`[data-prf="${k}"]`)?.value?.trim() ?? '';
        const num = (k) => { const v = get(k); return v === '' ? null : Number(v); };

        const body = {
            project: get('project'),
            tower: get('tower') || null,
            floor_number: num('floorNumber'),
            unit_number: get('unitNumber'),
            property_type: get('propertyType') || null,
            bedrooms: num('bedrooms'),
            area_sqft: num('areaSqft'),
            price: num('price'),
            facing: get('facing') || null,
            notes: get('notes') || null,
        };

        // Checked here so the message lands beside the field. The server refuses
        // these too — this is the courtesy in front of the gate.
        if (!body.project) { Toast.error('The unit needs a project'); return; }
        if (!body.unit_number) { Toast.error('The unit needs a number'); return; }

        const btn = modal.querySelector('[data-prf="save"]');
        if (btn) btn.disabled = true;
        try {
            if (state.editing) {
                await api.request(`/crm/properties/${encodeURIComponent(state.editing.id)}`,
                    { method: 'PUT', body: JSON.stringify(body) });
                Toast.success('Unit updated');
            } else {
                await api.request('/crm/properties', { method: 'POST', body: JSON.stringify(body) });
                Toast.success('Unit listed');
            }
            closeEditor();
            await load();
        } catch (e) {
            console.error('Failed to save the property:', e);
            Toast.error(e.message || 'Could not save the unit');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function removeProperty(id) {
        const property = state.properties.find(p => p.id === id);
        const ok = await showConfirm(
            `Remove ${property ? property.display_name : 'this unit'} from the listing? `
            + 'It stops appearing in the inventory and the unit number becomes free again.',
            'Remove unit', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/properties/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Toast.success('Unit removed');
            await load();
        } catch (e) {
            console.error('Failed to remove the property:', e);
            Toast.error(e.message || 'Could not remove the unit');
        }
    }

    // ─── Wiring ─────────────────────────────────────────────────────────────

    function init() {
        const host = document.getElementById('propertiesContent');
        if (!host) return;

        // Delegated and bound once — the grid re-renders on every filter change
        // and every save, and a per-render listener would multiply every action.
        host.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-prp-status]');
            if (chip) {
                state.filter.status = chip.getAttribute('data-prp-status');
                readFilters();
                return load();
            }
            if (e.target.closest('[data-prp="apply"]')) { readFilters(); return load(); }
            if (e.target.closest('[data-prp="clear"]')) {
                state.filter = { project: '', status: '', availableOnly: false, minPrice: '', maxPrice: '', bedrooms: '' };
                return load();
            }
            const card = e.target.closest('[data-prp-id]');
            if (!card) return;
            const id = card.getAttribute('data-prp-id');
            if (e.target.closest('[data-prp="edit"]')) return openEditor(state.properties.find(p => p.id === id));
            if (e.target.closest('[data-prp="delete"]')) return removeProperty(id);
        });

        document.getElementById('addPropertyBtn')?.addEventListener('click', () => openEditor(null));
        document.querySelector('[data-prf="save"]')?.addEventListener('click', saveEditor);
        document.querySelector('[data-prf="cancel"]')?.addEventListener('click', closeEditor);
        // Backdrop-only: now that the modal is INSIDE the overlay, a bare click
        // handler on the overlay fires for every click within the form and shuts
        // the editor as soon as anybody touches a field.
        document.getElementById('propertyModalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeEditor();
        });

        load();
    }

    return { init, load, effectiveStatus, holdHasExpired, holdNote };
})();

document.addEventListener('DOMContentLoaded', () => PropertiesPage.init());
