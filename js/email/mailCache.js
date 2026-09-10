/**
 * MailCache — the email client's local copy of the message list (IndexedDB).
 *
 * Why: opening the inbox used to be a round trip per folder before anything
 * painted. Now the list paints from this cache immediately and reconciles with
 * the server through GET /api/messages/changes (a keyset delta feed with
 * tombstones), so a second visit shows mail before the network answers.
 *
 * What is stored: list rows only (no bodies — the reading pane fetches the
 * message on open), keyed by message id, per (tenant, user) database. Per
 * mailbox we keep the delta cursor; per folder we keep whether its first page
 * has ever been fetched ("seeded"), the server's total, and the "horizon" —
 * the oldest timestamp reached by contiguous list pages. Rows older than the
 * horizon (they arrive through the delta when an old message changes) are
 * kept but not shown until scrolling extends the horizon, so the list never
 * shows a gap.
 *
 * Privacy: the database name is derived from the JWT's tenant + user; every
 * other rz_mail_* database on the origin is deleted on open, and all of them
 * are deleted on logout (config.js clearAuthData).
 */
(function () {
    const PREFIX = 'rz_mail_';
    const VERSION = 1;
    const MAX_ROWS_PER_MAILBOX = 3000;
    const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

    let db = null;
    let name = null;

    const ts = m => Date.parse(m.received_at || m.sent_at || m.created_at) || 0;

    function slim(m) {
        const o = {};
        for (const k in m) {
            if (k[0] === '_' || k === 'body_html' || k === 'body_text') continue;
            o[k] = m[k];
        }
        o._ts = ts(m);
        o._fk = m.folder_id || '';
        return o;
    }

    function promisify(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    function run(stores, mode, body) {
        if (!db) return Promise.reject(new Error('MailCache not open'));
        return new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode);
            let out;
            t.oncomplete = () => resolve(out);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('aborted'));
            try { out = body(t); } catch (err) { reject(err); }
        });
    }

    function rowsOfMailbox(t, mailboxId) {
        return promisify(t.objectStore('messages').index('mbx').getAll(mailboxId));
    }

    const meta = {
        get: (t, key) => promisify(t.objectStore('meta').get(key)).then(r => (r ? r.value : undefined)),
        set: (t, key, value) => { t.objectStore('meta').put({ key, value }); },
    };

    const MailCache = {
        EMPTY_GUID,
        get ready() { return !!db; },

        async open(identity) {
            if (!window.indexedDB || !identity) return false;
            name = PREFIX + identity;
            db = await new Promise((resolve, reject) => {
                const r = indexedDB.open(name, VERSION);
                r.onupgradeneeded = () => {
                    const d = r.result;
                    const s = d.createObjectStore('messages', { keyPath: 'id' });
                    s.createIndex('mbx', 'mailbox_id');
                    d.createObjectStore('meta', { keyPath: 'key' });
                };
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
                r.onblocked = () => reject(new Error('IndexedDB open blocked'));
            });
            db.onversionchange = () => { try { db.close(); } catch (_) { /* ignore */ } db = null; };
            try { localStorage.setItem('rz_mail_db', name); } catch (_) { /* ignore */ }
            return true;
        },

        /** Rows of one folder, newest first, restricted to the contiguous window. */
        async listFolder(mailboxId, folderId) {
            const fk = folderId || '';
            return run(['messages', 'meta'], 'readonly', async t => {
                const [rows, horizon] = await Promise.all([
                    rowsOfMailbox(t, mailboxId),
                    meta.get(t, `horizon:${mailboxId}:${fk}`),
                ]);
                const floor = typeof horizon === 'number' ? horizon : Infinity;
                // A never-paged folder has no horizon: nothing is contiguous yet.
                if (floor === Infinity) return [];
                const list = rows.filter(r => r._fk === fk && r._ts >= floor);
                list.sort((a, b) => b._ts - a._ts || (a.id < b.id ? 1 : -1));
                return list;
            });
        },

        async putMessages(items) {
            if (!Array.isArray(items) || items.length === 0) return;
            return run(['messages'], 'readwrite', t => {
                const s = t.objectStore('messages');
                items.forEach(m => { if (m && m.id) s.put(slim(m)); });
            });
        },

        async deleteMessages(ids) {
            if (!Array.isArray(ids) || ids.length === 0) return;
            return run(['messages'], 'readwrite', t => {
                const s = t.objectStore('messages');
                ids.forEach(id => s.delete(id));
            });
        },

        async patchMany(ids, fields) {
            if (!Array.isArray(ids) || ids.length === 0) return;
            return run(['messages'], 'readwrite', async t => {
                const s = t.objectStore('messages');
                for (const id of ids) {
                    const row = await promisify(s.get(id));
                    if (!row) continue;
                    Object.assign(row, fields);
                    row._fk = row.folder_id || '';
                    row._ts = ts(row);
                    s.put(row);
                }
            });
        },

        /**
         * Record a list page fetched from the server: rows, the folder's total,
         * and the horizon this page reached. `short` = the server returned fewer
         * rows than asked, i.e. the folder's end — everything is contiguous.
         */
        async recordPage(mailboxId, folderId, items, total, requested, serverTime) {
            const fk = folderId || '';
            const rows = Array.isArray(items) ? items : [];
            const short = rows.length < requested;
            let pageFloor = short ? 0 : Infinity;
            rows.forEach(m => { const v = ts(m); if (v < pageFloor) pageFloor = v; });
            return run(['messages', 'meta'], 'readwrite', async t => {
                const s = t.objectStore('messages');
                rows.forEach(m => { if (m && m.id) s.put(slim(m)); });
                const prev = await meta.get(t, `horizon:${mailboxId}:${fk}`);
                const floor = Math.min(typeof prev === 'number' ? prev : Infinity, pageFloor);
                if (floor !== Infinity) meta.set(t, `horizon:${mailboxId}:${fk}`, floor);
                if (typeof total === 'number') meta.set(t, `total:${mailboxId}:${fk}`, total);
                meta.set(t, `seeded:${mailboxId}:${fk}`, true);
                const cursor = await meta.get(t, `cursor:${mailboxId}`);
                if (!cursor && serverTime) meta.set(t, `cursor:${mailboxId}`, { watermark: serverTime, watermark_id: EMPTY_GUID });
            });
        },

        getMeta: key => run(['meta'], 'readonly', t => meta.get(t, key)),
        setMeta: (key, value) => run(['meta'], 'readwrite', t => { meta.set(t, key, value); }),

        isSeeded: (mailboxId, folderId) => run(['meta'], 'readonly', t => meta.get(t, `seeded:${mailboxId}:${folderId || ''}`)).then(v => !!v),
        getTotal: (mailboxId, folderId) => run(['meta'], 'readonly', t => meta.get(t, `total:${mailboxId}:${folderId || ''}`)),
        setTotal: (mailboxId, folderId, total) => run(['meta'], 'readwrite', t => { meta.set(t, `total:${mailboxId}:${folderId || ''}`, total); }),
        getCursor: mailboxId => run(['meta'], 'readonly', t => meta.get(t, `cursor:${mailboxId}`)),
        setCursor: (mailboxId, cursor) => run(['meta'], 'readwrite', t => { meta.set(t, `cursor:${mailboxId}`, cursor); }),

        /** Forget one mailbox entirely (delta said "resync", or it was disconnected). */
        async dropMailbox(mailboxId) {
            return run(['messages', 'meta'], 'readwrite', async t => {
                const s = t.objectStore('messages');
                const keys = await promisify(s.index('mbx').getAllKeys(mailboxId));
                keys.forEach(k => s.delete(k));
                const m = t.objectStore('meta');
                const all = await promisify(m.getAllKeys());
                all.forEach(k => { if (typeof k === 'string' && k.includes(`:${mailboxId}`)) m.delete(k); });
            });
        },

        /** Drop cached mailboxes the server no longer lists for this user. */
        async keepOnly(mailboxIds) {
            const keep = new Set(mailboxIds || []);
            const present = await run(['meta'], 'readonly', async t => {
                const keys = await promisify(t.objectStore('meta').getAllKeys());
                const ids = new Set();
                keys.forEach(k => { const m = /^cursor:(.+)$/.exec(String(k)); if (m) ids.add(m[1]); });
                return Array.from(ids);
            });
            for (const id of present) if (!keep.has(id)) await MailCache.dropMailbox(id);
        },

        /** Keep the newest rows per mailbox; folders that lost rows get their horizon raised. */
        async trim(mailboxId) {
            return run(['messages', 'meta'], 'readwrite', async t => {
                const s = t.objectStore('messages');
                const rows = await rowsOfMailbox(t, mailboxId);
                if (rows.length <= MAX_ROWS_PER_MAILBOX) return;
                rows.sort((a, b) => b._ts - a._ts);
                const dropped = rows.slice(MAX_ROWS_PER_MAILBOX);
                const raise = {};
                dropped.forEach(r => { s.delete(r.id); if (!(r._fk in raise) || r._ts > raise[r._fk]) raise[r._fk] = r._ts; });
                for (const fk of Object.keys(raise)) {
                    const key = `horizon:${mailboxId}:${fk}`;
                    const prev = await meta.get(t, key);
                    if (typeof prev === 'number' && prev <= raise[fk]) meta.set(t, key, raise[fk] + 1);
                }
            });
        },

        /** Delete every other user's cache on this origin. */
        async sweepForeign() {
            try {
                if (!indexedDB.databases) return;
                const list = await indexedDB.databases();
                list.forEach(d => { if (d.name && d.name.startsWith(PREFIX) && d.name !== name) indexedDB.deleteDatabase(d.name); });
            } catch (_) { /* best effort */ }
        },

        async clearAll() {
            try { if (db) db.close(); } catch (_) { /* ignore */ }
            db = null;
            if (name) { try { indexedDB.deleteDatabase(name); } catch (_) { /* ignore */ } }
            await MailCache.sweepForeign();
        },
    };

    window.MailCache = MailCache;
})();
