/**
 * ⭐ WHAT NEEDS ATTENTION, ON THE MENU ITSELF.
 *
 * <p>The Explore menu and the palette are an index: they tell you where things are,
 * not whether anything is waiting for you there. These badges turn the index into a
 * status board — "AR aging 6", "Batches & expiry 4" — so overdue money and expiring
 * stock are visible before you go looking for them.</p>
 *
 * <p>⭐ FOUR CALLS, ONCE PER SESSION, NEVER ON THE CRITICAL PATH. The naive version
 * asks each of 91 destinations for its own count on every page load. These are the
 * four facts worth interrupting someone for, they come from endpoints the dashboard
 * already calls, and the result is cached in sessionStorage for three minutes so
 * moving between pages does not re-fetch. Loading is deferred and every call is
 * independently swallowed: a badge that cannot be computed is simply absent, and a
 * failing endpoint must never stop the menu rendering.</p>
 *
 * <p>⭐ THE APPROVALS CALL IS ROLE-GATED BEFORE IT IS MADE. AuditController is
 * MANAGER/ADMIN/AUDITOR/SUPERADMIN, so firing it as a plain ACCOUNTS_USER earns a
 * guaranteed 403 on every session — noise in the log and a request that can never
 * succeed. Asking only when the role permits it is the same rule the menu applies to
 * the link itself.</p>
 */
(function () {
    'use strict';

    const KEY = 'acct_badges_v1';
    const TTL_MS = 3 * 60 * 1000;
    let inflight = null;

    /** Which destination each fact belongs to, and how loud it is. `alert` is money
     *  already late; `warn` is something that will bite if ignored. */
    const TONE = { ALERT: 'alert', WARN: 'warn' };

    function cached() {
        try {
            const raw = JSON.parse(sessionStorage.getItem(KEY) || 'null');
            if (raw && Date.now() - raw.at < TTL_MS) return raw.data;
        } catch (_) {}
        return null;
    }

    function store(data) {
        try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch (_) {}
    }

    const canRead = (roles) => {
        try {
            const mine = (typeof getUserRoles === 'function' ? getUserRoles() : []) || [];
            return roles.some(r => mine.includes(r));
        } catch (_) { return false; }
    };

    /** One count, or null. Never throws — the caller must not care which of the four failed. */
    async function ask(path, params, pick) {
        try {
            const res = await api.request(AccountsCommon.buildUrl(path, params), { _skipSpinner: true });
            const n = pick(res);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch (_) { return null; }
    }

    /** The KPI response is an OBJECT carrying two counts, so it cannot go through ask(),
     *  which coerces to a number and would hand back null for every object it is given. */
    async function raw(path) {
        try { return await api.request(AccountsCommon.buildUrl(path), { _skipSpinner: true }); }
        catch (_) { return null; }
    }

    const rows = (r) => Array.isArray(r) ? r.length : (Array.isArray(r?.data) ? r.data.length
                      : Array.isArray(r?.rows) ? r.rows.length : NaN);

    async function fetchAll() {
        if (typeof api === 'undefined' || typeof AccountsCommon === 'undefined') return {};
        const out = {};
        const put = (href, count, tone) => { if (count) out[href] = { count, tone }; };

        const [kpis, expiring, reorder, approvals] = await Promise.all([
            raw('dashboard/kpis'),
            ask('inventory/expiry-report', { withinDays: 90 }, rows),
            ask('inventory/reorder-report', undefined, rows),
            // AuditController: MANAGER / ADMIN / AUDITOR / SUPERADMIN. See the class note.
            canRead(['ACCOUNTS_MANAGER', 'ACCOUNTS_ADMIN', 'ACCOUNTS_AUDITOR', 'SUPERADMIN'])
                ? ask('audit/approvals/pending', undefined, r =>
                    Number(r?.total_pending ?? (Array.isArray(r?.expense_claims) ? r.expense_claims.length : NaN)))
                : Promise.resolve(null),
        ]);

        // `total_pending`, NOT `total` — the dashboard shipped a badge reading r.total,
        // which does not exist on this response, so it displayed 0 forever. Same trap here.
        put('admin.html#pending-approvals', approvals, TONE.WARN);
        put('inventory.html#inv-batches', expiring, TONE.WARN);
        put('inventory.html#inv-reorder', reorder, TONE.WARN);
        if (kpis) {
            put('receivables.html#ar-aging', Number(kpis.ar_overdue_count) || 0, TONE.ALERT);
            put('payables.html#ap-aging', Number(kpis.ap_overdue_count) || 0, TONE.ALERT);
        }
        return out;
    }

    /** Resolves to a map of href -> {count, tone}. Shared promise, so the menu and the
     *  palette asking at the same moment produce one round of requests, not two. */
    function load() {
        const hit = cached();
        if (hit) return Promise.resolve(hit);
        if (inflight) return inflight;
        inflight = fetchAll().then(d => { store(d); inflight = null; return d; })
                             .catch(() => { inflight = null; return {}; });
        return inflight;
    }

    /** Paint badges onto already-rendered .xg-link rows, and roll a dot up to the group
     *  header so a collapsed group still says "something in here wants you". */
    function applyToExplore(host) {
        if (!host) return;
        load().then(map => {
            if (!Object.keys(map).length) return;
            host.querySelectorAll('.xg').forEach(sec => {
                let worst = null;
                sec.querySelectorAll('.xg-link').forEach(a => {
                    const b = map[a.getAttribute('href')];
                    if (!b || a.querySelector('.xg-badge')) return;
                    const el = document.createElement('span');
                    el.className = `xg-badge xg-badge-${b.tone}`;
                    el.textContent = b.count > 99 ? '99+' : b.count;
                    a.appendChild(el);
                    if (b.tone === TONE.ALERT || !worst) worst = b.tone;
                });
                if (worst && !sec.querySelector('.xg-dot')) {
                    const d = document.createElement('span');
                    d.className = `xg-dot xg-dot-${worst}`;
                    sec.querySelector('.xg-count').insertAdjacentElement('beforebegin', d);
                }
            });
        });
    }

    window.AccountsBadges = { load, applyToExplore, TONE };
})();
