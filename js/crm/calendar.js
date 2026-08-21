/**
 * CRM calendar — the diary GET /crm/appointments/calendar was written for
 * ----------------------------------------------------------------------------
 * Appointments could be booked from a lead or a deal and read back on that one
 * record, but nothing in the product ever answered "what is happening this
 * week" — the endpoint existed, scoped and range-filtered, with no caller.
 *
 *   GET /crm/appointments/calendar?from=&to=&assignedUserId=
 *
 * A WEEK, not a month: the working unit of a viewing diary is the week, and a
 * month grid at this row height either truncates or lies about how full a day
 * is. Prev/next/today move the range; the assignee filter maps straight onto the
 * endpoint's third parameter rather than filtering client-side, so a large
 * tenant is not made to download every colleague's diary to look at one.
 */
const CrmCalendar = (() => {
    'use strict';

    const esc = (t) => String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const STATUS_LABEL = {
        scheduled: 'Scheduled', confirmed: 'Confirmed', completed: 'Attended',
        no_show: 'No show', cancelled: 'Cancelled',
    };
    /** Statuses that free the slot — shown faded, because they still happened. */
    const RELEASING = ['cancelled', 'no_show'];

    const state = {
        weekStart: startOfWeek(new Date()),
        users: [],
        assignee: '',
        appointments: [],
        assigneeDropdown: null,
    };

    /**
     * Monday, in LOCAL time.
     *
     * ⚠ Built from the local Y/M/D, never from an ISO string: a date parsed out
     * of toISOString() is a UTC instant, and east of Greenwich that lands on the
     * previous day — the whole grid would show the wrong week for half the world.
     */
    function startOfWeek(d) {
        const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dow = (local.getDay() + 6) % 7;          // Monday = 0
        local.setDate(local.getDate() - dow);
        return local;
    }

    function addDays(d, n) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        c.setDate(c.getDate() + n);
        return c;
    }

    const isToday = (d) => {
        const now = new Date();
        return d.getFullYear() === now.getFullYear()
            && d.getMonth() === now.getMonth()
            && d.getDate() === now.getDate();
    };

    const dayName  = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
    const dayNum   = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const clock    = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    function rangeLabel() {
        const from = state.weekStart;
        const to = addDays(from, 6);
        const sameMonth = from.getMonth() === to.getMonth();
        const left = from.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? undefined : 'short' });
        const right = to.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        return `${left} – ${right}`;
    }

    async function load() {
        const from = state.weekStart;
        const to = addDays(from, 7);
        const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
        // Sent to the SERVER, not filtered here: the endpoint takes it, and a
        // tenant with fifty agents should not ship fifty diaries to show one.
        if (state.assignee) q.set('assignedUserId', state.assignee);

        try {
            const rows = await api.request(`/crm/appointments/calendar?${q}`);
            state.appointments = Array.isArray(rows) ? rows : (rows?.data || []);
        } catch (e) {
            console.error('Failed to load the calendar:', e);
            Toast.error((e && e.message) || 'Could not load the calendar');
            state.appointments = [];
        }
        render();
    }

    async function loadUsers() {
        try {
            const users = await api.request('/crm/teams/users');
            state.users = Array.isArray(users) ? users : (users?.data || []);
        } catch (_) {
            // Admin-only. A member simply gets no filter, which is correct —
            // scope already limits them to what they may see.
            state.users = [];
        }
        mountAssigneePicker();
    }

    function mountAssigneePicker() {
        const host = document.querySelector('[data-cal="assignee-host"]');
        if (!host) return;

        // ⚠ NO ROSTER, NO LABEL. /crm/teams/users is admin-only and returns an
        // empty list for a tenant that has not set up teams — leaving the
        // "Whose diary" caption sitting in the app bar with nothing beside it,
        // which reads as a control that failed to load rather than one that
        // does not apply. Scope already limits a member to their own diary, so
        // there is nothing to choose between.
        const label = host.closest('.cal-whose');
        const usable = state.users.length > 0 && typeof SearchableDropdown === 'function';
        if (label) label.style.display = usable ? '' : 'none';
        if (!usable) return;

        // close(), never destroy() — destroy() removes its host from the DOM and
        // this remounts in place.
        if (state.assigneeDropdown) {
            try { state.assigneeDropdown.close?.(); } catch (_) { /* gone */ }
            state.assigneeDropdown = null;
        }
        state.assigneeDropdown = new SearchableDropdown(host, {
            id: 'cal-assignee-dropdown',
            options: [{ value: '', label: 'Everyone' }]
                .concat(state.users.map(u => ({ value: u.user_id, label: u.display_name || u.email }))),
            placeholder: 'Everyone',
            searchPlaceholder: 'Search people…',
            compact: true,
            value: state.assignee,
            onChange: (value) => { state.assignee = value || ''; load(); },
        });
    }

    /**
     * One appointment, ordered by what a person actually needs at a glance.
     *
     * ⭐ WHO COMES FIRST. The earlier card led with the agent's own title text
     * and never named the customer at all, so a week of "16:45 — Viewing" told
     * you nothing you could act on. The order is: WHEN, WHO you are meeting,
     * what it is about, then how to reach it, then state.
     *
     * Everything below WHO is conditional, because this calendar is not a
     * real-estate calendar — a clinic has no unit, a consultancy has no site
     * visit, and a card should carry only the rows that mean something for the
     * business looking at it.
     */
    function card(a) {
        const released = RELEASING.includes(a.status);
        const online = a.meeting_url && /^https?:\/\//i.test(a.meeting_url);
        return `
            <li class="cal-appt is-${esc(a.status)}${released ? ' is-released' : ''}${online ? ' is-online' : ''}">
                <span class="cal-appt-time">${esc(clock(a.starts_at))}</span>

                <span class="cal-appt-with">${a.customer_name
                    ? esc(a.customer_name)
                    : '<em class="cal-appt-noone">No one named</em>'}</span>

                <span class="cal-appt-title">${esc(a.title)}</span>

                ${a.property_name ? `<span class="cal-appt-unit">${esc(a.property_name)}</span>` : ''}
                ${a.location && !online ? `<span class="cal-appt-where">${esc(a.location)}</span>` : ''}

                ${online ? `
                    <a class="cal-appt-join" href="${esc(a.meeting_url)}" target="_blank" rel="noopener noreferrer">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
                        </svg>
                        Join
                    </a>` : ''}

                <span class="cal-appt-foot">
                    ${a.assigned_user_name ? `<span class="cal-appt-who">${esc(a.assigned_user_name)}</span>` : ''}
                    <span class="cal-appt-status">${esc(STATUS_LABEL[a.status] || a.status)}</span>
                </span>
            </li>`;
    }

    function render() {
        const label = document.getElementById('calRangeLabel');
        if (label) label.textContent = rangeLabel();

        const grid = document.getElementById('calGrid');
        if (!grid) return;

        // Bucket by LOCAL day. Grouping on the ISO date would put an 00:30
        // appointment on the previous day for anyone east of Greenwich.
        const byDay = new Map();
        for (const a of state.appointments) {
            const d = new Date(a.starts_at);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(a);
        }

        const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
        grid.innerHTML = days.map(d => {
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            const list = (byDay.get(key) || []).sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at));
            return `
                <section class="cal-day${isToday(d) ? ' is-today' : ''}">
                    <header class="cal-day-head">
                        <span class="cal-day-name">${esc(dayName(d))}</span>
                        <span class="cal-day-num">${esc(dayNum(d))}</span>
                        ${list.length ? `<span class="cal-day-n">${list.length}</span>` : ''}
                    </header>
                    ${list.length
                        ? `<ul class="cal-day-list">${list.map(card).join('')}</ul>`
                        : '<p class="cal-day-empty">Nothing booked</p>'}
                </section>`;
        }).join('');
    }

    function bind() {
        document.addEventListener('click', (e) => {
            if (e.target.closest('[data-cal="prev"]'))  { state.weekStart = addDays(state.weekStart, -7); return load(); }
            if (e.target.closest('[data-cal="next"]'))  { state.weekStart = addDays(state.weekStart, 7);  return load(); }
            if (e.target.closest('[data-cal="today"]')) { state.weekStart = startOfWeek(new Date());      return load(); }
        });
    }

    function init() {
        bind();
        render();
        load();
        loadUsers();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
    Navigation.init('crm', '../');
    CrmCalendar.init();
});
