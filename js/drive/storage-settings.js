/**
 * Drive → Storage settings.
 *
 * Where an organisation connects the S3-compatible storage Drive will use for
 * every file it holds on their behalf. There is no platform bucket behind this:
 * until it is connected, Drive cannot accept an upload from anyone in the
 * organisation, which is why the screen leads with status rather than a form.
 *
 * Two rules shape the flow:
 *
 *   1. Test before save. Storing credentials that do not work would leave the
 *      organisation with a Drive that looks configured and fails on every
 *      upload, and the person who would notice is not the person who typed it.
 *      The backend refuses to save anything that fails the probe.
 *
 *   2. Report per step. "Connection failed" covers a wrong region, a key
 *      without write permission, a bucket that denies listing and an endpoint
 *      that cannot presign — four different fixes. Each step is shown with its
 *      own outcome.
 */

/* The provider list is FETCHED, not restated.
   It used to be duplicated here — the endpoint templates, the fixed regions
   and the path-style flags all existed in this file and again in the backend.
   Two lists of the same set drift, and this one decides where a customer's
   files physically land. The backend derives the connection from these facts,
   so the backend is the one that publishes them. */
let PROVIDERS = [];
let selectedProvider = null;
let lastProbe = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadProviders();
    buildProviderOptions();
    if (PROVIDERS.length) applyProvider(PROVIDERS[0]);
    wireEvents();
    await loadStatus();
});

async function loadProviders() {
    try {
        const res = await api.request('/drive/storage/providers');
        PROVIDERS = (res && res.providers) || [];
    } catch (err) {
        PROVIDERS = [];
        Toast.error('Could not load the list of storage providers. Reload to try again.');
    }
}

/* ── Status ─────────────────────────────────────────────────────────── */

async function loadStatus() {
    const el = document.getElementById('storageStatus');
    el.innerHTML = '<div class="storage-status storage-status--pending">Checking…</div>';

    try {
        const res = await api.request('/drive/storage');
        if (res && res.configured) {
            el.innerHTML = `
                <div class="storage-status storage-status--ok">
                    <span class="storage-status__dot"></span>
                    <div>
                        <strong>Storage connected</strong>
                        <p>Files are stored in <code>${escapeHtml(res.bucket)}</code> under <code>${escapeHtml(res.key_prefix || '(bucket root)')}</code>.</p>
                    </div>
                </div>`;
        } else {
            el.innerHTML = `
                <div class="storage-status storage-status--warn">
                    <span class="storage-status__dot"></span>
                    <div>
                        <strong>Storage not connected</strong>
                        <p>${escapeHtml(res?.message || 'Connect an S3-compatible bucket to start using Drive.')}</p>
                    </div>
                </div>`;
        }
    } catch (err) {
        el.innerHTML = `
            <div class="storage-status storage-status--warn">
                <span class="storage-status__dot"></span>
                <div><strong>Could not read storage status</strong><p>${escapeHtml(err.message || '')}</p></div>
            </div>`;
    }
}

/* ── Provider picker (custom, per project convention — never a native select) */

function buildProviderOptions() {
    const list = document.getElementById('providerOptions');
    list.innerHTML = PROVIDERS.map(p => `
        <button type="button" class="provider-option" data-provider="${p.id}" role="option" aria-selected="false">
            ${escapeHtml(p.label)}
        </button>`).join('');

    list.querySelectorAll('.provider-option').forEach(btn => {
        btn.addEventListener('click', () => {
            applyProvider(PROVIDERS.find(p => p.id === btn.dataset.provider));
            closeProviderMenu();
        });
    });
}

function applyProvider(provider) {
    if (!provider) return;
    selectedProvider = provider;
    document.getElementById('providerTrigger').textContent = provider.label;
    document.getElementById('providerOptions')
        .querySelectorAll('.provider-option')
        .forEach(b => b.setAttribute('aria-selected', String(b.dataset.provider === provider.id)));

    // Exactly one locating field is shown, chosen by what the backend says
    // this provider needs. Everything else — endpoint, path-style, bucket,
    // key prefix — is derived there and never asked for.
    const fields = { region: 'regionField', accountid: 'accountField', endpoint: 'endpointField' };
    Object.values(fields).forEach(id => { document.getElementById(id).hidden = true; });
    const show = fields[(provider.needs || '').toLowerCase()];
    if (show) document.getElementById(show).hidden = false;

    // A fixed region is the provider's, not the customer's, so it is filled
    // in and the field stays hidden.
    const region = document.getElementById('region');
    if (provider.fixed_region) {
        region.value = provider.fixed_region;
    } else if (provider.needs === 'region') {
        // Clear a value carried over from a provider whose region it was.
        if (PROVIDERS.some(p => p.fixed_region && p.fixed_region === region.value)) region.value = '';
    }

    const note = document.getElementById('providerNote');
    note.textContent = provider.hint || '';
    note.hidden = !provider.hint;
}

function openProviderMenu() {
    document.getElementById('providerOptions').hidden = false;
    document.getElementById('providerTrigger').setAttribute('aria-expanded', 'true');
}
function closeProviderMenu() {
    document.getElementById('providerOptions').hidden = true;
    document.getElementById('providerTrigger').setAttribute('aria-expanded', 'false');
}

/* ── Events ─────────────────────────────────────────────────────────── */

function wireEvents() {
    const trigger = document.getElementById('providerTrigger');
    trigger.addEventListener('click', () => {
        document.getElementById('providerOptions').hidden ? openProviderMenu() : closeProviderMenu();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.provider-picker')) closeProviderMenu();
    });

    document.getElementById('testBtn').addEventListener('click', () => submit('/drive/storage/test', 'POST', false));
    document.getElementById('saveBtn').addEventListener('click', () => submit('/drive/storage', 'PUT', true));

    document.getElementById('copyCorsBtn')?.addEventListener('click', async () => {
        const json = document.getElementById('corsJson').textContent;
        try {
            await navigator.clipboard.writeText(json);
            Toast.success('CORS policy copied');
        } catch {
            Toast.error('Could not copy — select the text and copy it manually');
        }
    });
}

function readForm() {
    // The lean shape. Anything not here is the backend's to decide, which is
    // the whole point of the screen no longer asking for it.
    return {
        provider: selectedProvider ? selectedProvider.id : '',
        region: document.getElementById('region').value.trim(),
        account_id: document.getElementById('accountId').value.trim(),
        endpoint: document.getElementById('endpoint').value.trim(),
        bucket: document.getElementById('bucket').value.trim(),   // empty = make one for us
        access_key_id: document.getElementById('accessKeyId').value.trim(),
        secret_access_key: document.getElementById('secretAccessKey').value
    };
}

async function submit(endpoint, method, isSave) {
    const btn = document.getElementById(isSave ? 'saveBtn' : 'testBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = isSave ? 'Saving…' : 'Testing…';

    try {
        const res = await api.request(endpoint, {
            method,
            body: JSON.stringify(readForm())
        });

        lastProbe = res;
        renderSteps(res.steps, res);
        renderCors(res);

        if (res.success) {
            // The bucket is ours to name and create, so the customer never
            // typed it. Say which one it is, or they have no idea what
            // appeared in their account.
            Toast.success(
                res.bucket_created ? `Storage connected — created ${res.bucket}`
                : isSave ? 'Storage connected'
                : 'All checks passed');
            if (isSave) await loadStatus();
        } else {
            Toast.error(isSave ? 'Not saved — see the checks below' : 'Some checks failed');
        }
    } catch (err) {
        // The backend returns the per-step detail even on failure; surface it
        // rather than collapsing everything into the exception message.
        const payload = err.data || err.response || null;
        if (payload && payload.steps) {
            renderSteps(payload.steps, payload);
            renderCors(payload);
        }
        Toast.error(payload?.message || err.message || 'Storage check failed');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/* ── Rendering ──────────────────────────────────────────────────────── */

function renderSteps(steps, res) {
    const el = document.getElementById('probeResults');
    if (!steps || !steps.length) { el.hidden = true; return; }

    // Which bucket these checks ran against. We chose the name, so showing it
    // is the only way the customer can find it in their own console.
    const bucketLine = res && res.bucket
        ? `<p class="probe-bucket">${res.bucket_created ? 'Created and checked' : 'Checked'}
             <code>${escapeHtml(res.bucket)}</code></p>`
        : '';

    el.hidden = false;
    el.innerHTML = `
        <h3 class="probe-heading">Connection checks</h3>
        ${bucketLine}
        <ul class="probe-list">
            ${steps.map(s => `
                <li class="probe-step probe-step--${s.passed ? 'pass' : (s.fatal ? 'fail' : 'warn')}">
                    <span class="probe-step__icon" aria-hidden="true">${s.passed ? '✓' : (s.fatal ? '✕' : '!')}</span>
                    <div>
                        <strong>${escapeHtml(s.name)}</strong>
                        ${s.detail ? `<p>${escapeHtml(s.detail)}</p>` : ''}
                        ${!s.passed && !s.fatal ? '<p class="probe-step__note">This does not block saving.</p>' : ''}
                    </div>
                </li>`).join('')}
        </ul>`;
}

function renderCors(res) {
    const box = document.getElementById('corsBox');
    if (!res || !res.suggested_cors) { box.hidden = true; return; }
    box.hidden = false;
    document.getElementById('corsJson').textContent = res.suggested_cors;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
