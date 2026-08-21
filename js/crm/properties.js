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

    /**
     * THE FILTER KEYS, IN ONE PLACE.
     *
     * ⭐⭐ A FILTER USED TO HAVE TO BE REMEMBERED IN FIVE PLACES: the state
     * seed, query(), renderChips(), the Clear handler's object literal, and
     * anyFilter(). `category` reached three of them — so filtering to a
     * category with no matches sent the right request and then told the user
     * "No units listed yet. Add the first one to start selling from the CRM."
     * over a tenant that had three units, offering a Create button instead of a
     * way back. The Clear literal had the same hole: a key omitted there is not
     * reset, it is DELETED.
     *
     * Deriving the blank state, the "is anything filtered" predicate and the
     * chips from one list means a new filter can only be added in one place.
     */
    const FILTER_KEYS = [
        'project', 'status', 'category', 'propertyType',
        'availableOnly', 'minPrice', 'maxPrice', 'bedrooms', 'search',
    ];

    /** Keys whose empty value is `false` rather than an empty string. */
    const BOOLEAN_FILTERS = new Set(['availableOnly']);

    function blankFilter() {
        const f = {};
        for (const key of FILTER_KEYS) f[key] = BOOLEAN_FILTERS.has(key) ? false : '';
        return f;
    }

    const state = {
        properties: [],
        projects: [],
        types: [],            // the closed vocabulary, fetched once
        categories: [],
        visits: [],           // the selected unit's viewing history
        editorType: null,     // the type chosen in the editor
        editorCategory: null,
        categoryDropdown: null,
        typeDropdown: null,
        filter: blankFilter(),
        editing: null,
        selectedId: null,       // the unit shown in the detail pane
        sort: 'unit',
        page: 1,
        pageSize: 50,
        // Presigned URLs live ~15 minutes and the same photograph appears in a
        // row, a cover and a strip shot; caching by image id turns three round
        // trips into one.
        urlCache: new Map(),
        projectDropdown: null,
        filterCategoryDropdown: null,
        filterTypeDropdown: null,
    };

    const STATUS_LABEL = { available: 'Available', held: 'On hold', booked: 'Booked', sold: 'Sold' };

    /**
     * The view tabs, mirroring the Lead Desk.
     *
     * Counts come from the CURRENT result set rather than a separate stats call:
     * one endpoint, and the number beside a tab always agrees with what clicking
     * it shows. A stats call computed differently is how two numbers on one
     * screen come to disagree.
     */
    const TABS = [
        { status: '',          label: 'All units' },
        { status: 'available', label: 'Available' },
        { status: 'held',      label: 'On hold' },
        { status: 'booked',    label: 'Booked' },
        { status: 'sold',      label: 'Sold' },
    ];

    function categoryLabel(code) {
        return state.categories.find(c => c.code === code)?.label ?? code;
    }

    function typeLabel(code) {
        return state.types.find(t => t.code === code)?.label ?? code ?? '';
    }

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
    /**
     * What the unit's status EFFECTIVELY is.
     *
     * ⭐ THE SERVER DECIDES THIS, NOT THIS FILE.
     *
     * There used to be a second derivation here — `status === 'held' &&
     * holdHasExpired(p)` — and it was already WRONG in a way nobody would have
     * noticed for a long time: it did not know that deleting the holding deal
     * nulls held_by_deal_id and leaves the word 'held' behind. So a unit whose
     * buyer's deal had been deleted showed as "On hold" in the grid while the
     * claim endpoint happily handed it to somebody else. Two surfaces, one
     * fact, two answers.
     *
     * Property.EffectiveStatus on the server is now the single authority and
     * arrives as effective_status. The fallback is for a cached response from
     * before the field existed, and deliberately does NOT re-implement the rule
     * — it degrades to the stored word rather than to a second opinion.
     */
    function effectiveStatus(p) {
        return p.effective_status || p.status;
    }

    function holdHasExpired(p) {
        return !!p.hold_expires_at && new Date(p.hold_expires_at) <= new Date();
    }

    /**
     * The rows the grid shows.
     *
     * Search and the status TAB are applied here rather than server-side: the
     * tab counts have to be computed over the same set the tabs filter, so one
     * fetch feeds both. Project, price and bedrooms stay server-side because
     * they narrow the fetch itself.
     */
    function visibleRows() {
        const q = state.filter.search.trim().toLowerCase();
        const cmp = (SORTS.find(x => x.key === state.sort) || SORTS[0]).cmp;
        return state.properties.filter(p => {
            if (state.filter.status && effectiveStatus(p) !== state.filter.status) return false;
            if (!q) return true;
            return [p.project, p.tower, p.unit_number, p.property_type, p.facing]
                .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
        }).sort(cmp);
    }

    function statusCounts() {
        const counts = { '': state.properties.length };
        for (const t of TABS) if (t.status) counts[t.status] = 0;
        for (const p of state.properties) {
            const s = effectiveStatus(p);
            if (s in counts) counts[s]++;
        }
        return counts;
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    const SORTS = [
        { key: 'unit',  label: 'Unit',        cmp: (a, b) => (a.project + a.display_name).localeCompare(b.project + b.display_name) },
        { key: 'price', label: 'Price',       cmp: (a, b) => (b.price ?? -1) - (a.price ?? -1) },
        { key: 'area',  label: 'Area',        cmp: (a, b) => (b.area_sqft ?? -1) - (a.area_sqft ?? -1) },
        { key: 'beds',  label: 'Bedrooms',    cmp: (a, b) => (b.bedrooms ?? -1) - (a.bedrooms ?? -1) },
    ];

    function render() {
        renderTabs();
        renderChips();
        renderCount();
        renderFlow();
        renderRows();
        renderDetail();
        mountProjectFilter();
        mountFilterPickers();
        hydrateImages();
    }

    function renderCount() {
        const el = document.getElementById('prpTotalNum');
        if (el) el.textContent = state.properties.length.toLocaleString('en-IN');
    }

    function renderTabs() {
        const el = document.getElementById('prpTabs');
        if (!el) return;
        const counts = statusCounts();
        el.innerHTML = TABS.map(t => `
            <button type="button" class="ldk-vtab${state.filter.status === t.status ? ' active' : ''}"
                    data-prp-status="${t.status}">
                ${esc(t.label)} <b>${counts[t.status] ?? 0}</b>
            </button>`).join('');
    }

    /**
     * The inventory mix as one 3px bar.
     *
     * The property analogue of the Lead Desk's pipeline flow: at a glance, how
     * much of this project is still sellable. Proportions come from the SAME
     * rows the tabs count, so the bar and the numbers beside the tabs can never
     * tell different stories.
     */
    function renderFlow() {
        const bar = document.getElementById('prpFlowBar');
        if (!bar) return;
        const counts = statusCounts();
        const total = state.properties.length || 1;
        const segs = ['available', 'held', 'booked', 'sold'];

        bar.className = 'ldk-flowline' + (state.filter.status ? ' has-active' : '');
        bar.innerHTML = segs.map(s => {
            const pct = ((counts[s] ?? 0) / total) * 100;
            if (pct <= 0) return '';
            const active = state.filter.status === s ? ' active' : '';
            return `<span class="prp-flow-seg s-${s}${active}" style="width:${pct}%"
                          title="${esc(STATUS_LABEL[s])}: ${counts[s]}"></span>`;
        }).join('');
    }

    function anyFilter() {
        return FILTER_KEYS.some((key) => !!state.filter[key]);
    }

    /**
     * How each filter names itself on a chip. `status` is null on purpose — it
     * is shown as the tab strip above, not as a removable chip.
     */
    const CHIP_LABEL = {
        project: (v) => `Project: ${v}`,
        status: null,
        category: (v) => categoryLabel(v),
        propertyType: (v) => typeLabel(v),
        availableOnly: () => 'Only what I can sell',
        minPrice: (v) => `From ${money(Number(v), 'INR')}`,
        maxPrice: (v) => `To ${money(Number(v), 'INR')}`,
        bedrooms: (v) => `${v} BHK`,
        search: (v) => `\u201C${v}\u201D`,
    };

    /** Active filters as removable chips, exactly as the Lead Desk shows them. */
    function renderChips() {
        const el = document.getElementById('prpChips');
        if (!el) return;
        const f = state.filter;
        // Walked in FILTER_KEYS order so an added filter cannot be silently
        // chipless — an active filter with no chip is one the user can neither
        // see nor remove. `status` is deliberately null: it is the tab strip.
        const chips = FILTER_KEYS
            .filter((key) => !!f[key] && CHIP_LABEL[key])
            .map((key) => [key, CHIP_LABEL[key](f[key])]);

        el.innerHTML = chips.map(([key, label]) => `
            <span class="lp-chip">${esc(label)}
                <button type="button" class="lp-chip-x" data-prp-chip="${key}" aria-label="Remove filter">\u00d7</button>
            </span>`).join('');

        const badge = document.getElementById('prpFiltersCount');
        if (badge) {
            badge.textContent = String(chips.length);
            badge.style.display = chips.length ? '' : 'none';
        }
    }

    /**
     * One unit = one row.
     *
     * ⭐ THE THUMBNAIL IS THE AVATAR. Leads identifies a person by initials;
     * a flat is identified by how it looks, so the photograph takes that slot.
     * The sub-line carries the specification an agent quotes out loud —
     * bedrooms, area, facing — because that is what a buyer asks next.
     */
    function rowMarkup(p) {
        const status = effectiveStatus(p);
        const sel = state.selectedId === p.id ? ' sel' : '';
        const spec = [
            typeLabel(p.property_type) || null,
            p.bedrooms ? `${p.bedrooms} BHK` : null,
            p.area_sqft ? `${Number(p.area_sqft).toLocaleString('en-IN')} sq ft` : null,
            p.facing ? `${p.facing} facing` : null,
        ].filter(Boolean).join(' · ');

        const cover = p.cover_image;
        return `
        <div class="ldk-row${sel}" data-prp-id="${esc(p.id)}">
            ${cover
                ? `<img class="prp-thumb" alt="" data-prp-image="${esc(cover.id)}" loading="lazy">`
                : `<span class="prp-thumb-none" title="No photographs yet">
                     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                   </span>`}
            <div class="lmid">
                <div class="lname"><span class="lname-t">${esc(p.display_name)}</span></div>
                <div class="lsub">${esc(p.project)}${spec ? ' · ' + esc(spec) : ''}</div>
            </div>
            <div class="lright">
                <span class="ldk-pill p-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
                <span class="lprice">${esc(money(p.price, p.currency))}</span>
                <span class="prp-shots">
                    ${p.image_count ? `${esc(p.image_count)} photo${p.image_count === 1 ? '' : 's'}` : 'no photos'}
                    ${p.visit_count ? ` · ${esc(p.visit_count)} viewing${p.visit_count === 1 ? '' : 's'}` : ''}
                </span>
            </div>
        </div>`;
    }

    /** The slice of matching rows on the current page. */
    function pagedRows() {
        const rows = visibleRows();
        const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
        // A filter that shrinks the result below the current page would
        // otherwise leave the list blank on a page that no longer exists.
        if (state.page > pages) state.page = pages;
        const from = (state.page - 1) * state.pageSize;
        return { rows, pages, from, slice: rows.slice(from, from + state.pageSize) };
    }

    function renderListFoot(total, pages, from, shown) {
        const range = document.getElementById('prpRange');
        if (range) {
            range.textContent = total === 0 ? 'No units'
                : `${from + 1}\u2013${from + shown} of ${total}`;
        }
        const pager = document.getElementById('prpPager');
        if (!pager) return;

        if (pages <= 1) { pager.innerHTML = ''; return; }
        const btn = (label, page, opts = {}) =>
            `<button type="button" class="prp-page${opts.on ? ' is-on' : ''}" data-prp-page="${page}"
                     ${opts.disabled ? 'disabled' : ''}>${label}</button>`;

        // A short window around the current page — a project with 400 units
        // should not render 400 buttons.
        const win = [];
        for (let i = Math.max(1, state.page - 1); i <= Math.min(pages, state.page + 1); i++) win.push(i);

        pager.innerHTML = [
            btn('\u2039', state.page - 1, { disabled: state.page === 1 }),
            ...(win[0] > 1 ? [btn('1', 1), win[0] > 2 ? '<span>\u2026</span>' : ''] : []),
            ...win.map(i => btn(String(i), i, { on: i === state.page })),
            ...(win[win.length - 1] < pages
                ? [win[win.length - 1] < pages - 1 ? '<span>\u2026</span>' : '', btn(String(pages), pages)] : []),
            btn('\u203a', state.page + 1, { disabled: state.page === pages }),
        ].join('');
    }

    function renderRows() {
        const host = document.getElementById('prpRows');
        if (!host) return;
        const { rows, pages, from, slice } = pagedRows();
        renderListFoot(rows.length, pages, from, slice.length);

        const showing = document.getElementById('prpShowing');
        if (showing) {
            showing.textContent = rows.length === state.properties.length
                ? `${rows.length} unit${rows.length === 1 ? '' : 's'}`
                : `${rows.length} of ${state.properties.length}`;
        }
        const sortLabel = document.getElementById('prpSortLabel');
        if (sortLabel) sortLabel.textContent = SORTS.find(s => s.key === state.sort)?.label ?? 'Unit';

        if (rows.length === 0) {
            host.innerHTML = `
                <div class="ldk-empty">
                    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    <p>${state.properties.length === 0 && !anyFilter()
                        ? 'No units listed yet. Add the first one to start selling from the CRM.'
                        : 'No units match these filters.'}</p>
                    ${state.properties.length === 0 && !anyFilter()
                        ? '<button class="btn btn-sm btn-primary" data-prp="first">List your first unit</button>' : ''}
                </div>`;
            return;
        }

        host.innerHTML = slice.map(rowMarkup).join('');
    }

    /**
     * The unit detail — the gallery first, because that is what a buyer sees
     * first and what an agent is judged on having.
     */
    /**
     * The selected unit's viewing history.
     *
     * ⚠ THIS WAS NEVER WRITTEN. state.visits was declared, read by
     * visitsMarkup() and populated by nothing, so the Viewings section rendered
     * its empty state for every unit no matter how many times it had been
     * shown — while GET /crm/properties/{id}/visits sat there answering
     * correctly the whole time. The feature was complete at the database, the
     * business layer, the controller and the renderer, and absent at the one
     * line that joins the last two.
     *
     * Cleared BEFORE the request so switching units cannot show the previous
     * unit's viewings while this one loads.
     */
    async function loadVisits(propertyId) {
        state.visits = [];
        if (!propertyId) return;
        try {
            const rows = await api.request(`/crm/properties/${encodeURIComponent(propertyId)}/visits`);
            // A slow request for a unit the user has already clicked away from
            // must not overwrite the one they are now looking at.
            if (state.selectedId !== propertyId) return;
            state.visits = Array.isArray(rows) ? rows : [];
        } catch (e) {
            console.error('Failed to load the viewing history:', e);
            state.visits = [];
        }
        // ⚠ RE-RENDERING THE DETAIL BLANKS THE PHOTOGRAPHS.
        // renderDetail() rebuilds the markup with empty <img> tags that
        // hydrateImages() fills in afterwards. This render happens LATER than
        // the one on selection, so without re-hydrating here every unit showed
        // its alt text instead of its cover the moment the viewing history
        // arrived — a correct fix breaking a working feature next door.
        if (state.selectedId === propertyId) {
            renderDetail();
            hydrateImages();
        }
    }

    function renderDetail() {
        const host = document.getElementById('prpDetailHost');
        if (!host) return;

        const p = state.properties.find(x => x.id === state.selectedId);
        if (!p) {
            host.innerHTML = `
                <div class="prd-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    <p>Pick a unit to see its photographs and specification.</p>
                </div>`;
            return;
        }

        const status = effectiveStatus(p);
        const images = p.images || [];
        const cover = images[0];
        const spec = (label, value) => value
            ? `<div class="prd-spec"><span class="prd-spec-label">${esc(label)}</span><span class="prd-spec-value">${esc(value)}</span></div>`
            : '';

        host.innerHTML = `
        <div class="prd">
          <div class="prd-scroll">
            <div class="prd-cover${cover ? '' : ' is-empty'}">
                ${cover ? `<img class="prd-cover-img" alt="${esc(p.display_name)}" data-prp-image="${esc(cover.id)}">` : ''}
                <span class="prd-cover-none">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    No photographs yet
                </span>
                <span class="prd-cover-unavail">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="3"/></svg>
                    Photographs are temporarily unavailable
                </span>
                <span class="ldk-pill p-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
            </div>

            <div class="prd-strip">
                ${images.map((im, i) => `
                    <img class="prd-shot${i === 0 ? ' is-cover' : ''}" alt="${esc(im.file_name)}"
                         data-prp-image="${esc(im.id)}" data-prd-shot="${esc(im.id)}"
                         title="${i === 0 ? 'Cover' : 'Click to make this the cover'}">`).join('')}
                <button type="button" class="prd-addshot" data-prd="add" title="Add photographs">+</button>
            </div>

            <div class="prd-body">
                <div class="prd-head">
                    <div>
                        <h2 class="prd-title">${esc(p.display_name)}</h2>
                        <p class="prd-project">${esc(p.project)}</p>
                    </div>
                    <span class="prd-price">${esc(money(p.price, p.currency))}</span>
                </div>

                <div class="prd-specs">
                    ${spec('Category', p.category ? categoryLabel(p.category) : null)}
                    ${spec('Type', typeLabel(p.property_type) || null)}
                    ${spec('Bedrooms', p.bedrooms ? `${p.bedrooms} BHK` : null)}
                    ${spec('Area', p.area_sqft ? `${Number(p.area_sqft).toLocaleString('en-IN')} sq ft` : null)}
                    ${spec('Facing', p.facing)}
                    ${spec('Tower', p.tower)}
                    ${spec('Floor', p.floor_number != null ? p.floor_number : null)}
                </div>

                ${holdMarkup(p)}
                ${p.notes ? `<p class="prd-notes">${esc(p.notes)}</p>` : ''}
                ${visitsMarkup(p)}
            </div>
          </div>

          <!-- Pinned pane footer, mirroring the Lead Desk's workspace actions
               bar: it sits outside the scroll so it never drifts away as the
               specification grows. -->
          <div class="prd-foot">
              <button type="button" class="btn btn-sm btn-outline-primary" data-prd="edit">Edit unit</button>
              <button type="button" class="btn btn-sm btn-outline-primary" data-prd="add">Add photographs</button>
              ${images.length ? '<button type="button" class="btn btn-sm btn-outline-primary" data-prd="removeshot">Remove cover</button>' : ''}
              <button type="button" class="btn btn-sm btn-outline-primary" data-prd="delete">Remove unit</button>
          </div>
        </div>`;
    }

    /**
     * The unit's viewing history.
     *
     * ⭐ NO CUSTOMER APPEARS HERE, AND THAT IS THE SERVER'S DOING. The listing
     * is shared with every agent, so the endpoint returns a redacted shape with
     * no lead or deal on it — this renders what a flat's history legitimately
     * is: when it was shown, for how long, by which colleague, and how it went.
     *
     * Plenty of viewings and no offer is a different problem from no viewings
     * at all, which is the whole reason to put this on the unit.
     */
    function visitsMarkup(p) {
        const visits = state.visits;
        const shown = p.visit_count || 0;

        if (!visits.length) {
            return `<div class="prd-visits">
                <h3 class="prd-visits-head">Viewings <span class="prd-visits-n">0</span></h3>
                <p class="prd-visits-none">Nobody has been shown this unit yet.
                   Book a site visit from a lead or a deal to start its history.</p>
            </div>`;
        }

        return `<div class="prd-visits">
            <h3 class="prd-visits-head">Viewings <span class="prd-visits-n">${esc(shown)}</span></h3>
            <ul class="prd-visits-list">
                ${visits.map(v => `
                    <li class="prd-visit is-${esc(v.status)}">
                        <span class="prd-visit-when">${esc(visitWhen(v.starts_at))}</span>
                        <span class="prd-visit-title">${esc(v.title)}</span>
                        ${v.shown_by ? `<span class="prd-visit-by">${esc(v.shown_by)}</span>` : ''}
                        <span class="ldk-pill p-visit-${esc(v.status)}">${esc(VISIT_STATUS[v.status] || v.status)}</span>
                    </li>`).join('')}
            </ul>
        </div>`;
    }

    const VISIT_STATUS = {
        scheduled: 'Booked', confirmed: 'Confirmed', completed: 'Attended',
        no_show: 'No show', cancelled: 'Cancelled',
    };

    /**
     * A viewing is an INSTANT, so a local render is correct — the opposite of a
     * renewal date, which is a calendar day and must never go through Date.
     */
    function visitWhen(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function holdMarkup(p) {
        if (!p.held_by_deal_id) {
            return `<p class="prd-hold is-free">This unit is <strong>free to sell</strong>. Reserve it against a deal from the deal itself.</p>`;
        }
        const who = p.held_by_deal_name ? ` for <strong>${esc(p.held_by_deal_name)}</strong>` : '';
        const when = p.hold_expires_at
            ? new Date(p.hold_expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '';
        // ⭐ A LAPSED HOLD IS GOOD NEWS AND MUST NOT LOOK LIKE A LIVE ONE — it
        // is the state an agent is most likely to misread as "taken".
        return holdHasExpired(p)
            ? `<p class="prd-hold is-lapsed">The hold${who} lapsed on ${esc(when)} — this unit is <strong>back on the market</strong>.</p>`
            : `<p class="prd-hold">Held${who} until ${esc(when)}.</p>`;
    }

    /**
     * Swap every image placeholder for its presigned URL.
     *
     * ⭐ THE URL IS FETCHED, NOT BUILT, and the bytes never touch this origin.
     * Images live on the storage origin behind a short-lived signature, so a
     * mislabelled file cannot execute as a page on the CRM — the conclusion the
     * document download proxy arrived at the hard way.
     *
     * Resolved URLs are cached per image id: the same photograph appears as a
     * row thumbnail, a detail cover and a strip shot, and presigning it three
     * times is three round trips for one file.
     */
    async function hydrateImages() {
        const pending = [...document.querySelectorAll('[data-prp-image]')].filter(i => !i.src);
        await Promise.all(pending.map(async (img) => {
            const id = img.getAttribute('data-prp-image');
            const cover = img.closest('.prd-cover');
            try {
                if (!state.urlCache.has(id)) {
                    const { url } = await api.request(`/crm/properties/images/${encodeURIComponent(id)}/url`);
                    state.urlCache.set(id, url || null);
                }
                const url = state.urlCache.get(id);
                if (url) img.src = url;
                else cover?.classList.add('is-empty');
            } catch (e) {
                // ⭐ A STORE THAT DID NOT ANSWER IS NOT A DELETED PHOTOGRAPH.
                //
                // 503 means the server has the image and could not reach object
                // storage. Caching that would make a thirty-second blip look
                // permanent for the rest of the session — the agent reloads,
                // sees nothing, and concludes the photographs are gone. So the
                // id is left OUT of the cache and the next render asks again.
                if (e && e.status === 503) {
                    cover?.classList.add('is-unavailable');
                    return;
                }
                // Anything else really is missing: cache it so the gallery
                // stops asking for a photograph that will never arrive.
                state.urlCache.set(id, null);
                cover?.classList.add('is-empty');
            }
        }));
    }

    function mountProjectFilter() {
        const host = document.querySelector('[data-prp="project-host"]');
        if (!host) return;

        // ⭐⭐ CLOSE, NEVER DESTROY — SEE buildTypeDropdown FOR THE FULL STORY.
        //
        // render() calls this on every load, and the filter bar is NOT rebuilt
        // in between: the host is the same live element each time. destroy() is
        // true disposal and removes its container from the DOM, so switching a
        // status tab deleted <span data-prp="project-host"> and mounted the
        // replacement into a detached node — measured: after one click on
        // "Available" the project filter was gone from the page and only a
        // reload brought it back.
        //
        // The fixed id is what makes the in-place rebuild safe: the constructor
        // finds the previous instance by id and detaches its document/window
        // listeners, which is the leak destroy() was reached for.
        if (state.projectDropdown) {
            try { state.projectDropdown.close?.(); } catch (_) { /* gone */ }
            state.projectDropdown = null;
        }

        if (typeof SearchableDropdown === 'function') {
            state.projectDropdown = new SearchableDropdown(host, {
                id: 'prp-project-filter-dropdown',
                options: [{ value: '', label: 'All projects' }]
                    .concat(state.projects.map(n => ({ value: n, label: n }))),
                placeholder: 'All projects',
                searchPlaceholder: 'Search projects…',
                compact: true,
                value: state.filter.project || '',
                onChange: (value) => { state.filter.project = value || ''; load(); },
            });
        }
    }

    // ─── Data ───────────────────────────────────────────────────────────────

    function query() {
        const f = state.filter;
        const q = new URLSearchParams();
        if (f.project) q.set('project', f.project);
        if (f.status) q.set('status', f.status);
        if (f.category) q.set('category', f.category);
        if (f.propertyType) q.set('propertyType', f.propertyType);
        if (f.bedrooms) q.set('bedrooms', f.bedrooms);
        if (f.minPrice) q.set('minPrice', f.minPrice);
        if (f.maxPrice) q.set('maxPrice', f.maxPrice);
        if (f.availableOnly) q.set('availableOnly', 'true');
        const s = q.toString();
        return s ? `?${s}` : '';
    }

    async function load() {
        try {
            const [properties, projects, vocab] = await Promise.all([
                api.request(`/crm/properties${query()}`),
                api.request('/crm/properties/projects'),
                // Fetched from the server rather than hard-coded here, so the
                // picker offers exactly what the validator accepts — a list
                // duplicated in the UI drifts the first time a type is added.
                state.types.length ? Promise.resolve(null) : api.request('/crm/properties/types'),
            ]);
            state.properties = Array.isArray(properties) ? properties : [];
            state.projects = Array.isArray(projects) ? projects : [];
            if (vocab) {
                state.types = vocab.types || [];
                state.categories = vocab.categories || [];
            }
        } catch (e) {
            console.error('Failed to load properties:', e);
            Toast.error(e.message || 'Could not load the property listing');
            state.properties = [];
        }

        // Keep the open unit open across a reload, and open the first one when
        // nothing is selected — a detail pane that empties itself every time the
        // list refreshes makes the page feel like it lost your place.
        if (!state.properties.some(p => p.id === state.selectedId)) {
            state.selectedId = state.properties.length ? state.properties[0].id : null;
        }
        render();
        // The first unit is selected automatically, so its history has to be
        // fetched here too — otherwise the unit a user LANDS on is the one unit
        // whose viewings never appear.
        loadVisits(state.selectedId);
    }

    function readFilters() {
        const get = (k) => document.querySelector(`[data-prp="${k}"]`)?.value ?? '';
        state.filter.bedrooms = get('bedrooms');
        state.filter.minPrice = get('minPrice');
        state.filter.maxPrice = get('maxPrice');
        state.filter.availableOnly = !!document.querySelector('[data-prp="availableOnly"]')?.checked;
    }

    function writeFilters() {
        const set = (k, v) => { const el = document.querySelector(`[data-prp="${k}"]`); if (el) el.value = v ?? ''; };
        set('bedrooms', state.filter.bedrooms);
        set('minPrice', state.filter.minPrice);
        set('maxPrice', state.filter.maxPrice);
        const toggle = document.querySelector('[data-prp="availableOnly"]');
        if (toggle) toggle.checked = state.filter.availableOnly;
        const search = document.getElementById('prpSearch');
        if (search) search.value = state.filter.search;
    }

    /**
     * The Category and Type filters — Category narrows Type, as in the editor.
     *
     * Fixed ids for the same reason every other picker on this page has one:
     * render() rebuilds these against the SAME live host, and destroy() would
     * delete that host. close() plus a stable id lets the constructor find the
     * previous instance and detach its listeners.
     */
    const FILTER_CATEGORY_ID = 'prp-filter-category-dropdown';
    const FILTER_TYPE_ID = 'prp-filter-type-dropdown';

    function mountFilterPickers() {
        if (typeof SearchableDropdown !== 'function') return;

        const catHost = document.querySelector('[data-prp="category-host"]');
        const typeHost = document.querySelector('[data-prp="type-host"]');
        if (!catHost || !typeHost) return;

        if (state.filterCategoryDropdown) {
            try { state.filterCategoryDropdown.close?.(); } catch (_) { /* gone */ }
            state.filterCategoryDropdown = null;
        }

        state.filterCategoryDropdown = new SearchableDropdown(catHost, {
            id: FILTER_CATEGORY_ID,
            options: [{ value: '', label: 'Any category' }]
                .concat(state.categories.map(c => ({ value: c.code, label: c.label }))),
            placeholder: 'Any category',
            compact: true,
            value: state.filter.category || '',
            onChange: (value) => {
                state.filter.category = value || '';
                // A type from the old category would contradict the new one, and
                // the two together select nothing at all.
                if (state.filter.propertyType &&
                    state.types.find(t => t.code === state.filter.propertyType)?.category !== state.filter.category) {
                    state.filter.propertyType = '';
                }
                buildFilterTypeDropdown(typeHost);
            },
        });

        buildFilterTypeDropdown(typeHost);
    }

    function buildFilterTypeDropdown(host) {
        if (state.filterTypeDropdown) {
            try { state.filterTypeDropdown.close?.(); } catch (_) { /* gone */ }
            state.filterTypeDropdown = null;
        }
        const inCategory = state.filter.category
            ? state.types.filter(t => t.category === state.filter.category)
            : state.types;

        state.filterTypeDropdown = new SearchableDropdown(host, {
            id: FILTER_TYPE_ID,
            options: [{ value: '', label: 'Any type' }]
                .concat(inCategory.map(t => ({ value: t.code, label: t.label }))),
            placeholder: 'Any type',
            searchPlaceholder: 'Search types…',
            compact: true,
            value: state.filter.propertyType || '',
            onChange: (value) => {
                state.filter.propertyType = value || '';
                // Picking a type SETTLES the category, so the two controls can
                // never show a pair that describes nothing.
                if (value) {
                    state.filter.category = state.types.find(t => t.code === value)?.category || '';
                }
            },
        });
    }

    /**
     * Show or hide the filter popover.
     *
     * Toggled by the .open CLASS, not the hidden attribute — the panel's
     * `display:none` default and its absolute positioning both live on
     * `.lp-filter-panel` / `.lp-filter-panel.open`, exactly as on Leads. Using
     * the attribute instead left the panel unstyled and in flow.
     */
    function toggleFiltersPanel(force) {
        const panel = document.getElementById('prpFiltersPanel');
        if (!panel) return;
        const show = force !== undefined ? force : !panel.classList.contains('open');
        panel.classList.toggle('open', show);
    }

    // ─── Photographs ────────────────────────────────────────────────────────

    async function uploadImages(fileList) {
        const propertyId = state.selectedId;
        if (!propertyId || !fileList || !fileList.length) return;

        // Sequential on purpose: the server assigns sort_order from the current
        // maximum, so uploading in parallel makes the resulting ORDER depend on
        // which request happens to land first — and the first image is the cover.
        let added = 0;
        for (const file of Array.from(fileList)) {
            const form = new FormData();
            form.append('file', file);
            try {
                await api.request(`/crm/properties/${encodeURIComponent(propertyId)}/images`,
                    { method: 'POST', body: form });
                added++;
            } catch (e) {
                console.error('Failed to upload an image:', e);
                Toast.error(e.message || `Could not upload ${file.name}`);
            }
        }
        if (added) Toast.success(added === 1 ? 'Photograph added' : `${added} photographs added`);
        await load();
    }

    /** Promote a photograph to the cover by sending the whole new order. */
    async function makeCover(imageId) {
        const p = state.properties.find(x => x.id === state.selectedId);
        if (!p || !p.images?.length) return;
        if (p.images[0].id === imageId) return;      // already the cover

        // The server refuses a partial list — omitted images would keep their
        // old positions and collide — so the full permutation is sent.
        const ids = p.images.map(i => i.id);
        const reordered = [imageId, ...ids.filter(i => i !== imageId)];
        try {
            await api.request(`/crm/properties/${encodeURIComponent(p.id)}/images/order`,
                { method: 'PUT', body: JSON.stringify({ image_ids: reordered }) });
            Toast.success('Cover updated');
            await load();
        } catch (e) {
            console.error('Failed to set the cover:', e);
            Toast.error(e.message || 'Could not set the cover');
        }
    }

    async function removeCoverImage() {
        const p = state.properties.find(x => x.id === state.selectedId);
        const image = p?.images?.[0];
        if (!image) return;

        const ok = await showConfirm(
            `Remove “${image.file_name}”? It is deleted from storage as well, and the next `
            + 'photograph becomes the cover.',
            'Remove photograph', 'danger');
        if (!ok) return;
        try {
            await api.request(`/crm/properties/images/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
            state.urlCache.delete(image.id);
            Toast.success('Photograph removed');
            await load();
        } catch (e) {
            console.error('Failed to remove the image:', e);
            Toast.error(e.message || 'Could not remove the photograph');
        }
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

        set('bedrooms', p.bedrooms);
        set('areaSqft', p.area_sqft);
        set('price', p.price);
        set('facing', p.facing);
        set('notes', p.notes);

        // Only the OVERLAY carries `active` — the CSS hides the modal through
        // its parent's opacity, so toggling the modal itself does nothing.
        mountTypePickers(p.property_type || null);
        document.getElementById('propertyModalOverlay')?.classList.add('active');
    }

    /**
     * The category picker and the type picker it narrows.
     *
     * ⭐ THE TYPE PICKER IS REBUILT WHENEVER THE CATEGORY CHANGES, and the
     * chosen type is CLEARED when it no longer belongs to the new category —
     * otherwise picking "Commercial" over a saved "apartment" leaves a
     * residential type selected under a commercial heading, and the save stores
     * a pairing the UI showed as impossible.
     */
    function mountTypePickers(currentType) {
        state.editorType = currentType;
        state.editorCategory = currentType ? (state.types.find(t => t.code === currentType)?.category ?? null) : null;

        const catHost = document.querySelector('[data-prf="category-host"]');
        const typeHost = document.querySelector('[data-prf="type-host"]');
        if (!catHost || !typeHost || typeof SearchableDropdown !== 'function') return;

        // Portaled menus outlive their host — close AND destroy before replacing.
        for (const key of ['categoryDropdown', 'typeDropdown']) {
            if (state[key]) {
                try { state[key].close?.(); state[key].destroy?.(); } catch (_) { /* gone */ }
                state[key] = null;
            }
        }

        state.categoryDropdown = new SearchableDropdown(catHost, {
            options: [{ value: '', label: 'Any category' }]
                .concat(state.categories.map(c => ({ value: c.code, label: c.label }))),
            placeholder: 'Residential or commercial?',
            compact: true,
            value: state.editorCategory || '',
            onChange: (value) => {
                state.editorCategory = value || null;
                if (state.editorType &&
                    state.types.find(t => t.code === state.editorType)?.category !== state.editorCategory) {
                    state.editorType = null;
                }
                buildTypeDropdown(typeHost);
            },
        });

        buildTypeDropdown(typeHost);
    }

    /**
     * The stable id is what makes rebuilding this picker IN PLACE possible.
     *
     * ⭐⭐ DO NOT CALL destroy() HERE. SearchableDropdown.destroy() is TRUE
     * disposal: it removes its container from the DOM. This function re-runs on
     * every category change against the SAME live host, so destroying meant
     * deleting <span data-prf="type-host"> and then mounting the replacement
     * into a detached node — the Type field vanished from the dialog the moment
     * anybody switched Residential to Commercial, and there was no way to give a
     * commercial unit a type at all.
     *
     * The constructor already handles re-initialising on the same container: it
     * looks the previous instance up BY ID and detaches its document/window
     * listeners, which is the leak destroy() was being used to avoid. That
     * lookup only works with a fixed id — the generated one is unique per
     * instance, so an anonymous rebuild would leak exactly what the old code
     * feared. close() first so a portaled menu is not orphaned in the body.
     */
    const TYPE_DROPDOWN_ID = 'prf-type-dropdown';

    function buildTypeDropdown(host) {
        if (state.typeDropdown) {
            try { state.typeDropdown.close?.(); } catch (_) { /* gone */ }
            state.typeDropdown = null;
        }
        const inCategory = state.editorCategory
            ? state.types.filter(t => t.category === state.editorCategory)
            : state.types;

        state.typeDropdown = new SearchableDropdown(host, {
            id: TYPE_DROPDOWN_ID,
            options: [{ value: '', label: 'Not specified' }]
                .concat(inCategory.map(t => ({ value: t.code, label: t.label, description: categoryLabel(t.category) }))),
            placeholder: 'What kind of unit?',
            searchPlaceholder: 'Search types…',
            compact: true,
            value: state.editorType || '',
            onChange: (value) => {
                state.editorType = value || null;
                // Choosing a type FIXES the category — they cannot disagree,
                // and the server derives one from the other anyway.
                if (value) state.editorCategory = state.types.find(t => t.code === value)?.category ?? null;
            },
        });
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
            property_type: state.editorType || null,
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
        if (!document.getElementById('prpRows')) return;

        // ── The list: pick a unit ───────────────────────────────────────────
        document.getElementById('prpRows').addEventListener('click', (e) => {
            if (e.target.closest('[data-prp="first"]')) return openEditor(null);
            const row = e.target.closest('[data-prp-id]');
            if (!row) return;
            state.selectedId = row.getAttribute('data-prp-id');
            renderRows();
            renderDetail();
            hydrateImages();
            loadVisits(state.selectedId);
        });

        // ── The detail pane ─────────────────────────────────────────────────
        const detail = document.getElementById('prpDetailHost');
        detail.addEventListener('click', (e) => {
            const shot = e.target.closest('[data-prd-shot]');
            if (shot) return makeCover(shot.getAttribute('data-prd-shot'));
            if (e.target.closest('[data-prd="add"]')) return document.getElementById('prpFileInput')?.click();
            if (e.target.closest('[data-prd="edit"]'))
                return openEditor(state.properties.find(p => p.id === state.selectedId));
            if (e.target.closest('[data-prd="delete"]')) return removeProperty(state.selectedId);
            if (e.target.closest('[data-prd="removeshot"]')) return removeCoverImage();
        });

        // ── The hero: tabs, chips, filters ──────────────────────────────────
        //
        // Bound to the hero rather than to the list, because the tabs, the chips
        // and the filter popover all live OUTSIDE the rows container — a
        // listener on the list alone would never see them, which is how a tab
        // row ships inert.
        document.querySelector('.ldk-hero')?.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-prp-status]');
            if (tab) {
                state.filter.status = tab.getAttribute('data-prp-status');
                state.page = 1;
                return render();          // status filters client-side; no refetch
            }
            const chip = e.target.closest('[data-prp-chip]');
            if (chip) {
                const key = chip.getAttribute('data-prp-chip');
                state.filter[key] = key === 'availableOnly' ? false : '';
                writeFilters();
                return load();
            }
            if (e.target.closest('#prpFiltersToggle')) return toggleFiltersPanel();
            if (e.target.closest('[data-prp="apply"]')) { readFilters(); toggleFiltersPanel(false); return load(); }
            if (e.target.closest('[data-prp="clear"]')) {
                state.filter = blankFilter();
                writeFilters();
                mountFilterPickers();
                toggleFiltersPanel(false);
                return load();
            }
        });

        // Search narrows what is already loaded, so it is instant.
        document.getElementById('prpSearch')?.addEventListener('input', (e) => {
            state.filter.search = e.target.value;
            state.page = 1;
            renderRows(); renderChips(); hydrateImages();
        });

        // Sort cycles through the orders an agent actually asks for.
        document.getElementById('prpSortBtn')?.addEventListener('click', () => {
            const i = SORTS.findIndex(x => x.key === state.sort);
            state.sort = SORTS[(i + 1) % SORTS.length].key;
            renderRows(); hydrateImages();
        });

        // The list footer: pager and rows-per-page.
        document.getElementById('prpListFoot')?.addEventListener('click', (e) => {
            const b = e.target.closest('[data-prp-page]');
            if (!b || b.disabled) return;
            state.page = Number(b.getAttribute('data-prp-page'));
            renderRows(); hydrateImages();
        });
        document.getElementById('prpPageSize')?.addEventListener('change', (e) => {
            state.pageSize = Number(e.target.value) || 50;
            state.page = 1;                 // page 7 of 3 is not a page
            renderRows(); hydrateImages();
        });

        document.getElementById('addPropertyBtn')?.addEventListener('click', () => openEditor(null));
        document.getElementById('prpFileInput')?.addEventListener('change', (e) => {
            uploadImages(e.target.files);
            e.target.value = '';   // so re-picking the same file fires change again
        });

        // The editor modal
        document.querySelector('[data-prf="save"]')?.addEventListener('click', saveEditor);
        document.querySelector('[data-prf="cancel"]')?.addEventListener('click', closeEditor);
        document.getElementById('propertyModalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeEditor();
        });

        load();
    }

    return { init, load, effectiveStatus, holdHasExpired, visibleRows, statusCounts };
})();

document.addEventListener('DOMContentLoaded', () => {
    // ⚠ THE SITE NAVBAR IS RENDERED PER PAGE, BY THE PAGE.
    //
    // Every other CRM screen calls this from its own module — leads.js,
    // deals.js, contacts.js, companies.js, settings.js — and this one never
    // did, so the avatar and the whole application menu behind it (Home,
    // Drive, HRMS, Accounts, Change Password, Dark Mode…) simply did not
    // exist on Properties. The <div class="navbar-menu"> was in the markup
    // with a comment saying Navigation.init() fills it, and nothing called it.
    Navigation.init('crm', '../');
    PropertiesPage.init();
});
