/**
 * CRM Settings → Documents
 * ----------------------------------------------------------------------------
 * Picks which document types a lead or deal must have before its file counts
 * as complete. That list is what the checklist on every record is computed
 * against, so it is a tenant-wide decision and the endpoint behind it is
 * admin-only.
 *
 *   GET  /crm/entity-documents/types      the vocabulary
 *   GET  /crm/entity-documents/required   what is currently required
 *   PUT  /crm/entity-documents/required   replace it
 *
 * The saved list comes back CANONICALISED — de-duplicated and in vocabulary
 * order — so this renders the server's answer rather than what was ticked.
 * Echoing the request would show an order the checklist does not use.
 */

let requiredDocsTypes = null;      // [{code,label}] — the vocabulary
let requiredDocsSelected = null;   // Set of codes currently ticked

function requiredDocsEsc(t) {
    return String(t ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function loadRequiredDocumentsTab() {
    const loading = document.getElementById('requiredDocsLoading');
    const box = document.getElementById('requiredDocsBox');
    if (!box) return;

    if (loading) loading.style.display = '';
    box.style.display = 'none';

    try {
        const [types, current] = await Promise.all([
            api.request('/crm/entity-documents/types'),
            api.request('/crm/entity-documents/required')
        ]);
        requiredDocsTypes = Array.isArray(types) ? types : [];
        requiredDocsSelected = new Set((current && current.required) || []);
        renderRequiredDocuments();
    } catch (e) {
        console.error('Failed to load required documents:', e);
        Toast.error(e.message || 'Could not load the document checklist');
        // Leave the box hidden rather than rendering an empty grid that reads
        // as "this tenant requires nothing" — that is a real configuration and
        // a load failure must not be mistaken for it.
        return;
    } finally {
        if (loading) loading.style.display = 'none';
    }

    box.style.display = '';
}

function renderRequiredDocuments() {
    const grid = document.getElementById('requiredDocsGrid');
    const summary = document.getElementById('requiredDocsSummary');
    if (!grid) return;

    grid.innerHTML = (requiredDocsTypes || []).map(t => {
        const on = requiredDocsSelected.has(t.code);
        return `
        <label class="reqdoc-item${on ? ' is-on' : ''}">
            <input type="checkbox" data-reqdoc="${requiredDocsEsc(t.code)}"${on ? ' checked' : ''}>
            <span>${requiredDocsEsc(t.label)}</span>
        </label>`;
    }).join('');

    if (summary) {
        const n = requiredDocsSelected.size;
        summary.textContent = n === 0
            ? 'No checklist — records will not show one.'
            : (n === 1 ? '1 document required on every record'
                       : `${n} documents required on every record`);
    }
}

function bindRequiredDocumentsTab() {
    const grid = document.getElementById('requiredDocsGrid');
    const save = document.getElementById('requiredDocsSave');
    if (!grid || !save || grid.dataset.bound === '1') return;
    grid.dataset.bound = '1';

    // Delegated, and bound once: this tab can be re-entered, and re-adding the
    // listener each time would fire one save per visit.
    grid.addEventListener('change', (e) => {
        const cb = e.target.closest('[data-reqdoc]');
        if (!cb) return;
        const code = cb.getAttribute('data-reqdoc');
        if (cb.checked) requiredDocsSelected.add(code); else requiredDocsSelected.delete(code);
        cb.closest('.reqdoc-item')?.classList.toggle('is-on', cb.checked);
        const summary = document.getElementById('requiredDocsSummary');
        if (summary) renderSummaryOnly(summary);
    });

    save.addEventListener('click', saveRequiredDocuments);
}

function renderSummaryOnly(summary) {
    const n = requiredDocsSelected.size;
    summary.textContent = n === 0
        ? 'No checklist — records will not show one.'
        : (n === 1 ? '1 document required on every record'
                   : `${n} documents required on every record`);
}

async function saveRequiredDocuments() {
    const btn = document.getElementById('requiredDocsSave');
    if (!btn) return;
    btn.disabled = true;
    try {
        const res = await api.request('/crm/entity-documents/required', {
            method: 'PUT',
            body: JSON.stringify({ required: Array.from(requiredDocsSelected) })
        });
        // Re-seed from the RESPONSE. The server canonicalises, so this is what
        // the checklist will actually use — showing the ticks back from local
        // state would hide any difference.
        requiredDocsSelected = new Set((res && res.required) || []);
        renderRequiredDocuments();
        Toast.success('Document checklist saved');
    } catch (e) {
        console.error('Failed to save required documents:', e);
        Toast.error(e.message || 'Could not save the checklist');
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', bindRequiredDocumentsTab);
