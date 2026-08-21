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

const PROVIDERS = [
    {
        id: 'aws',
        name: 'Amazon S3',
        endpointHint: 'https://s3.eu-central-1.amazonaws.com',
        regionHint: 'eu-central-1',
        // Path-style addressing is deprecated for new AWS buckets.
        forcePathStyle: false,
        note: 'Use an IAM user with read, write and delete on the bucket.'
    },
    {
        id: 'r2',
        name: 'Cloudflare R2',
        endpointHint: 'https://<account-id>.r2.cloudflarestorage.com',
        regionHint: 'auto',
        forcePathStyle: true,
        note: 'R2 always uses the region "auto". Create an R2 API token with Object Read & Write.'
    },
    {
        id: 'spaces',
        name: 'DigitalOcean Spaces',
        endpointHint: 'https://blr1.digitaloceanspaces.com',
        regionHint: 'blr1',
        forcePathStyle: true,
        note: 'Use a Spaces access key, not a DigitalOcean API token.'
    },
    {
        id: 'backblazeb2',
        name: 'Backblaze B2',
        endpointHint: 'https://s3.us-west-004.backblazeb2.com',
        regionHint: 'us-west-004',
        forcePathStyle: true,
        note: 'Use an application key scoped to this bucket.'
    },
    {
        id: 'wasabi',
        name: 'Wasabi',
        endpointHint: 'https://s3.ap-southeast-1.wasabisys.com',
        regionHint: 'ap-southeast-1',
        forcePathStyle: true,
        note: ''
    },
    {
        id: 'minio',
        name: 'MinIO (self-hosted)',
        endpointHint: 'https://minio.example.com',
        regionHint: 'us-east-1',
        forcePathStyle: true,
        note: 'The endpoint must be reachable from the internet and use HTTPS.'
    },
    {
        id: 'generic',
        name: 'Other S3-compatible',
        endpointHint: 'https://storage.example.com',
        regionHint: 'us-east-1',
        forcePathStyle: true,
        note: ''
    }
];

let selectedProvider = PROVIDERS[0];
let lastProbe = null;

document.addEventListener('DOMContentLoaded', async () => {
    buildProviderOptions();
    applyProvider(PROVIDERS[0]);
    wireEvents();
    await loadStatus();
});

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
            ${escapeHtml(p.name)}
        </button>`).join('');

    list.querySelectorAll('.provider-option').forEach(btn => {
        btn.addEventListener('click', () => {
            applyProvider(PROVIDERS.find(p => p.id === btn.dataset.provider));
            closeProviderMenu();
        });
    });
}

function applyProvider(provider) {
    selectedProvider = provider;
    document.getElementById('providerTrigger').textContent = provider.name;
    document.getElementById('providerOptions')
        .querySelectorAll('.provider-option')
        .forEach(b => b.setAttribute('aria-selected', String(b.dataset.provider === provider.id)));

    // Prefill rather than overwrite: an admin who has already typed an
    // endpoint should not lose it by browsing the provider list.
    const endpoint = document.getElementById('endpoint');
    const region = document.getElementById('region');
    endpoint.placeholder = provider.endpointHint;
    region.placeholder = provider.regionHint;
    if (!endpoint.value) endpoint.value = '';
    if (!region.value || PROVIDERS.some(p => p.regionHint === region.value)) region.value = provider.regionHint;

    document.getElementById('forcePathStyle').checked = provider.forcePathStyle;
    const note = document.getElementById('providerNote');
    note.textContent = provider.note || '';
    note.hidden = !provider.note;
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
    return {
        endpoint: document.getElementById('endpoint').value.trim(),
        region: document.getElementById('region').value.trim(),
        bucket: document.getElementById('bucket').value.trim(),
        access_key_id: document.getElementById('accessKeyId').value.trim(),
        secret_access_key: document.getElementById('secretAccessKey').value,
        force_path_style: document.getElementById('forcePathStyle').checked,
        key_prefix: document.getElementById('keyPrefix').value.trim() || 'ragenaizer/',
        flavour: selectedProvider.id
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
        renderSteps(res.steps);
        renderCors(res);

        if (res.success) {
            Toast.success(isSave ? 'Storage connected' : 'All checks passed');
            if (isSave) await loadStatus();
        } else {
            Toast.error(isSave ? 'Not saved — see the checks below' : 'Some checks failed');
        }
    } catch (err) {
        // The backend returns the per-step detail even on failure; surface it
        // rather than collapsing everything into the exception message.
        const payload = err.data || err.response || null;
        if (payload && payload.steps) {
            renderSteps(payload.steps);
            renderCors(payload);
        }
        Toast.error(payload?.message || err.message || 'Storage check failed');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

/* ── Rendering ──────────────────────────────────────────────────────── */

function renderSteps(steps) {
    const el = document.getElementById('probeResults');
    if (!steps || !steps.length) { el.hidden = true; return; }

    el.hidden = false;
    el.innerHTML = `
        <h3 class="probe-heading">Connection checks</h3>
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
