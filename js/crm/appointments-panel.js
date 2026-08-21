/**
 * Appointments panel — a time booked with a named person
 * ----------------------------------------------------------------------------
 * A clinic consultation, a site visit, a branch meeting. The CRM could record
 * that a call HAPPENED but never that one was ARRANGED, so healthcare and
 * high-ticket local services kept their diary somewhere else.
 *
 *   GET    /crm/appointments/{entityType}/{entityId}
 *   POST   /crm/appointments
 *   PUT    /crm/appointments/{id}
 *   PATCH  /crm/appointments/{id}/status
 *   DELETE /crm/appointments/{id}
 *
 * ⭐ ONE PERSON CANNOT BE IN TWO PLACES AT ONCE, and the server proves it with a
 * database constraint rather than a check. A refused booking comes back 409 with
 * the CLASH in the body, so this panel can say who is busy and until when
 * instead of "conflict" — which is the difference between offering the next slot
 * and hunting for the problem.
 *
 * Usage:  AppointmentsPanel.mount(el, 'lead'|'deal', entityId, { canEdit: true });
 */
const AppointmentsPanel = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const mounted = new WeakMap();

    const STATUS_LABEL = {
        scheduled: 'Scheduled',
        confirmed: 'Confirmed',
        completed: 'Attended',
        no_show: 'No show',
        cancelled: 'Cancelled',
    };

    /**
     * Statuses a user can set from here, in the order a visit actually moves.
     *
     * They mirror the server's vocabulary — it refuses anything else — and the
     * two RELEASING ones are last because they free the slot, which is a
     * different kind of action from confirming attendance.
     */
    const SETTABLE = ['scheduled', 'confirmed', 'completed', 'no_show', 'cancelled'];
    const RELEASING = ['cancelled', 'no_show'];

    const DURATIONS = [15, 30, 45, 60, 90, 120];

    /**
     * ⭐ AN APPOINTMENT IS AN INSTANT, NOT A CALENDAR DAY — the opposite of the
     * renewal date, and the distinction matters in the other direction.
     *
     * starts_at is a timestamptz: a real moment carrying a zone. Parsing it with
     * `new Date` and rendering locally is CORRECT here, because 14:30 in the
     * clinic's zone should read as 14:30 to the person in the clinic. It is the
     * DATE-typed columns (renewal_date) that must never go through Date, and
     * RenewalPanel documents why.
     */
    function when(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '—';
        return d.toLocaleString('en-IN', {
            weekday: 'short', day: 'numeric', month: 'short',
            hour: '2-digit', minute: '2-digit', hour12: true,
        });
    }

    function timeOnly(iso) {
        const d = new Date(iso);
        return isNaN(d) ? '' : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    /** Local YYYY-MM-DD — for a date input, which speaks local days. */
    function localDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    /** Local HH:MM rounded up to the next half hour — the sensible default slot. */
    function nextHalfHour() {
        const d = new Date();
        d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    /**
     * Combine a local date and time into an instant.
     *
     * ⭐ BUILT FROM PARTS, NEVER FROM A CONCATENATED STRING.
     * `new Date("2026-11-10T14:30")` is parsed as LOCAL by modern browsers but
     * "2026-11-10 14:30" is implementation-defined, and appending "Z" would
     * declare a local wall-clock time to be UTC — booking a 14:30 clinic slot at
     * 20:00 IST. Constructing from the numbers is unambiguous everywhere.
     */
    function instantFrom(dateStr, timeStr) {
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
        const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ''));
        if (!dm || !tm) return null;
        const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
        return isNaN(d) ? null : d;
    }

    // ─── Rendering ──────────────────────────────────────────────────────────

    function shell(state) {
        const { appointments, canEdit } = state;
        const upcoming = appointments.filter(a => !RELEASING.includes(a.status) && new Date(a.starts_at) >= new Date());

        return `
        <div class="apt">
            <div class="apt-head">
                <h4 class="apt-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Appointments
                </h4>
                ${upcoming.length
                    ? `<span class="apt-next">Next: ${esc(when(upcoming[upcoming.length - 1].starts_at))}</span>`
                    : ''}
            </div>

            <details class="crm-help crm-help-sm">
                <summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>What is this? — Appointments</summary>
                <div class="crm-help-body">
                    <p>Time booked with a named person — a consultation, a site visit, a meeting.
                       Nobody can be booked twice for the same time, so a clash is refused and
                       you are told what is already there.</p>
                    <p><em>Marking one cancelled or a no-show frees the slot for someone else.
                       A reminder goes out the day before.</em></p>
                </div>
            </details>

            ${state.clashes && state.clashes.length ? clashMarkup(state) : ''}

            ${canEdit ? formMarkup(state) : ''}

            ${appointments.length === 0
                ? '<p class="apt-none">Nothing booked yet.</p>'
                : `<ul class="apt-list">${appointments.map(a => item(a, state)).join('')}</ul>`}
        </div>`;
    }

    function clashMarkup(state) {
        return `
            <div class="apt-clash" role="alert">
                <p class="apt-clash-head">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    ${esc(state.clashMessage || 'That time is already booked.')}
                </p>
                <ul class="apt-clash-list">
                    ${state.clashes.map(c => `
                        <li><strong>${esc(c.title)}</strong> — ${esc(timeOnly(c.starts_at))} to ${esc(timeOnly(c.ends_at))}</li>
                    `).join('')}
                </ul>
            </div>`;
    }

    function formMarkup(state) {
        return `
            <div class="apt-form">
                <label class="apt-full">Title
                    <input type="text" data-apt="title" maxlength="200"
                           value="${esc(state.draft.title)}" placeholder="e.g. Initial consultation">
                </label>

                <div class="apt-fields">
                    <label>Date
                        <input type="date" data-apt="date" value="${esc(state.draft.date)}">
                    </label>
                    <label>Time
                        <input type="time" data-apt="time" value="${esc(state.draft.time)}" step="300">
                    </label>
                    <label>Duration
                        <span class="apt-durations" role="group" aria-label="Duration">
                            ${DURATIONS.map(m => `
                                <button type="button" class="apt-dur${m === state.draft.duration ? ' is-on' : ''}"
                                        data-apt-duration="${m}">${m >= 60 ? (m / 60) + 'h' : m + 'm'}</button>`).join('')}
                        </span>
                    </label>
                </div>

                <label class="apt-full">With
                    <span data-apt="assignee-host"></span>
                </label>

                <label class="apt-full">Location
                    <input type="text" data-apt="location" maxlength="300"
                           value="${esc(state.draft.location)}" placeholder="e.g. Clinic — Room 2, or a video link">
                </label>

                <div class="apt-actions">
                    <button type="button" class="btn btn-sm btn-primary" data-apt="book">Book appointment</button>
                </div>
            </div>`;
    }

    function item(a, state) {
        const released = RELEASING.includes(a.status);
        return `
        <li class="apt-item is-${esc(a.status)}" data-apt-id="${esc(a.id)}">
            <div class="apt-item-main">
                <span class="apt-item-title">${esc(a.title)}</span>
                <span class="apt-badge is-${esc(a.status)}">${esc(STATUS_LABEL[a.status] || a.status)}</span>
            </div>
            <div class="apt-item-meta">
                <span>${esc(when(a.starts_at))} · ${esc(a.duration_minutes)} min</span>
                ${a.assigned_user_name ? `<span>with ${esc(a.assigned_user_name)}</span>` : ''}
                ${a.location ? `<span>${esc(a.location)}</span>` : ''}
            </div>
            ${a.cancelled_reason ? `<p class="apt-item-reason">${esc(a.cancelled_reason)}</p>` : ''}
            ${a.notes ? `<p class="apt-item-notes">${esc(a.notes)}</p>` : ''}
            ${state.canEdit ? `
            <div class="apt-item-actions" role="group" aria-label="Change status">
                ${SETTABLE.filter(s => s !== a.status).map(s => `
                    <button type="button" class="apt-step${RELEASING.includes(s) ? ' is-off' : ''}"
                            data-apt-status="${s}">${esc(STATUS_LABEL[s])}</button>`).join('')}
            </div>` : ''}
            ${released ? '<p class="apt-item-freed">This slot is free again.</p>' : ''}
        </li>`;
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    function readDraft(container) {
        const st = mounted.get(container);
        return {
            title: container.querySelector('[data-apt="title"]')?.value ?? '',
            date: container.querySelector('[data-apt="date"]')?.value ?? '',
            time: container.querySelector('[data-apt="time"]')?.value ?? '',
            location: container.querySelector('[data-apt="location"]')?.value ?? '',
            duration: st.draft.duration,
            assignee: st.draft.assignee,
        };
    }

    async function book(container) {
        const st = mounted.get(container);
        const draft = readDraft(container);

        if (!draft.title.trim()) { Toast.error('Give the appointment a title'); return; }
        const starts = instantFrom(draft.date, draft.time);
        if (!starts) { Toast.error('Pick a date and a time'); return; }

        const ends = new Date(starts.getTime() + draft.duration * 60000);

        // ⭐ KEEP WHAT WAS TYPED, BEFORE ANYTHING CAN FAIL.
        //
        // The panel re-renders from st.draft, and a refused booking re-renders
        // to show the clash — so without this the date, time and title the user
        // just entered were replaced by the defaults the panel loaded with. The
        // clash block says "pick another slot" while having thrown away the slot
        // they picked, which makes the most useful error in the feature the most
        // annoying one.
        st.draft = { ...st.draft, ...draft };

        const btn = container.querySelector('[data-apt="book"]');
        if (btn) btn.disabled = true;
        try {
            const body = {
                title: draft.title.trim(),
                // toISOString sends UTC with an explicit Z, so the instant the
                // user picked survives the trip whatever the server's zone is.
                starts_at: starts.toISOString(),
                ends_at: ends.toISOString(),
                location: draft.location.trim() || null,
            };
            body[st.entityType === 'lead' ? 'lead_id' : 'deal_id'] = st.entityId;
            if (draft.assignee) body.assigned_user_id = draft.assignee;

            await api.request('/crm/appointments', { method: 'POST', body: JSON.stringify(body) });

            // Keep the assignee and duration — a receptionist books several in a
            // row for the same consultant — and clear what changes per booking.
            st.draft = { ...st.draft, title: '', location: '' };
            st.clashes = null;
            st.clashMessage = null;
            Toast.success('Appointment booked');
            await reload(container);
        } catch (e) {
            showClash(container, e);
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async function setStatus(container, id, status) {
        let reason = null;
        if (RELEASING.includes(status)) {
            reason = await Prompt.show({
                title: STATUS_LABEL[status],
                message: status === 'cancelled'
                    ? 'Why is this being cancelled? This stays on the record, and the slot is freed.'
                    : 'Anything to note? The slot is freed either way.',
                placeholder: 'e.g. patient rang to postpone',
                confirmText: 'Save',
            });
            if (reason === null) return;
        }
        try {
            await api.request(`/crm/appointments/${encodeURIComponent(id)}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status, reason: reason || null }),
            });
            Toast.success(`Marked ${(STATUS_LABEL[status] || status).toLowerCase()}`);
            await reload(container);
        } catch (e) {
            showClash(container, e);
        }
    }

    /**
     * ⭐ A 409 CARRIES THE CLASH; EVERYTHING ELSE IS JUST AN ERROR.
     *
     * Reporting both as a toast would throw away the one thing that makes the
     * refusal actionable — WHICH appointment is in the way and until when. The
     * clash is rendered into the panel and survives until the next attempt,
     * because a toast is gone before the receptionist has finished reading it.
     */
    function showClash(container, error) {
        const st = mounted.get(container);
        const clashes = error && error.data && Array.isArray(error.data.clashes) ? error.data.clashes : null;

        if (clashes && clashes.length) {
            st.clashes = clashes;
            st.clashMessage = error.message;
            render(container);
            // Not a toast as well: the panel now says it, in place, permanently.
            return;
        }

        console.error('Appointment request failed:', error);
        Toast.error((error && error.message) || 'Could not save the appointment');
    }

    // ─── Mounting ───────────────────────────────────────────────────────────

    function render(container) {
        const st = mounted.get(container);
        container.innerHTML = shell(st);
        mountAssigneePicker(container);
    }

    function mountAssigneePicker(container) {
        const st = mounted.get(container);
        const host = container.querySelector('[data-apt="assignee-host"]');
        if (!host) return;

        // A portaled menu outlives its host element, so the previous instance is
        // closed AND destroyed before a new one is built. Three panel opens
        // otherwise leave three live menus behind — a defect this codebase has
        // already shipped once, in the documents panel.
        if (st.assigneeDropdown) {
            try { st.assigneeDropdown.close?.(); st.assigneeDropdown.destroy?.(); } catch (_) { /* already gone */ }
            st.assigneeDropdown = null;
        }

        if (typeof SearchableDropdown === 'function' && st.users.length) {
            st.assigneeDropdown = new SearchableDropdown(host, {
                options: st.users.map(u => ({ value: u.user_id, label: u.display_name || u.email })),
                placeholder: 'Whose diary?',
                searchPlaceholder: 'Search people…',
                compact: true,
                value: st.draft.assignee || undefined,
                onChange: (value) => { st.draft.assignee = value; },
            });
        } else {
            // The roster is admin-only, so a member legitimately cannot load it.
            // Saying "yourself" is honest: the server defaults an omitted
            // assignee to the caller, and a member may only book their own diary
            // anyway — so this is the whole truth for them, not a degradation.
            host.innerHTML = '<span class="apt-self">yourself</span>';
            st.draft.assignee = null;
        }
    }

    async function reload(container) {
        const st = mounted.get(container);
        try {
            st.appointments = await api.request(
                `/crm/appointments/${st.entityType}/${encodeURIComponent(st.entityId)}`) || [];
        } catch (e) {
            console.error('Failed to load appointments:', e);
            st.appointments = [];
        }
        render(container);
    }

    async function loadUsers(container) {
        const st = mounted.get(container);
        try {
            const users = await api.request('/crm/teams/users');
            st.users = Array.isArray(users) ? users : (users?.data || []);
        } catch (_) {
            // /teams/users is admin-only. A member falls back to their own
            // diary, which is the only one they may book anyway.
            st.users = [];
        }
        mountAssigneePicker(container);
    }

    function mount(container, entityType, entityId, opts = {}) {
        if (!container || !entityId) return;
        const prev = mounted.get(container);

        mounted.set(container, {
            entityType,
            entityId,
            canEdit: opts.canEdit !== false,
            appointments: [],
            users: [],
            clashes: null,
            clashMessage: null,
            assigneeDropdown: null,
            draft: {
                title: '',
                date: localDate(new Date()),
                time: nextHalfHour(),
                duration: 30,
                location: '',
                assignee: null,
            },
            bound: prev ? prev.bound : false,
        });

        container.innerHTML = '<p class="apt-loading">Loading appointments…</p>';
        reload(container).then(() => loadUsers(container));

        if (mounted.get(container).bound) return;
        mounted.get(container).bound = true;

        // Delegated and bound ONCE — this panel re-renders after every booking
        // and every status change, and a listener re-added per render would fire
        // one POST per render.
        container.addEventListener('click', (e) => {
            const dur = e.target.closest('[data-apt-duration]');
            if (dur) {
                mounted.get(container).draft = {
                    ...readDraft(container),
                    duration: Number(dur.getAttribute('data-apt-duration')),
                };
                render(container);
                return;
            }
            const status = e.target.closest('[data-apt-status]');
            if (status) {
                const id = status.closest('[data-apt-id]')?.getAttribute('data-apt-id');
                if (id) return setStatus(container, id, status.getAttribute('data-apt-status'));
            }
            if (e.target.closest('[data-apt="book"]')) return book(container);
        });
    }

    return { mount, instantFrom, when };
})();
