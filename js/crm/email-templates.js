// ─────────────────────────────────────────────────────────────────────────
// CRM Settings → Email Templates tab
//
// Reusable template library. Each template has a name, subject, and HTML
// body. Variables use {{snake_case}} — {{first_name}}, {{company}}, etc.
// The backend extracts declared variables automatically.
// ─────────────────────────────────────────────────────────────────────────

(function () {
    let templates = [];
    let editingId = null;

    let _mailboxIndex = {}; // id → email_address, for quick "Sends from" lookup

    window.loadTemplatesTab = async function () {
        try {
            const [tplResp, mbResp] = await Promise.all([
                api.request('/email-templates'),
                api.request('/crm/mailbox-attachments/shared-mailboxes').catch(() => ({ mailboxes: [] })),
            ]);
            templates = (tplResp && tplResp.items) || [];
            _mailboxIndex = {};
            ((mbResp && mbResp.mailboxes) || []).forEach(m => {
                _mailboxIndex[m.id] = m.email_address;
            });
        } catch (e) {
            console.error('Failed to load templates:', e);
            templates = [];
        }
        renderTemplates();
    };

    function renderTemplates() {
        const tbody = document.getElementById('templatesTableBody');
        const wrap = document.getElementById('templatesTableWrapper');
        const empty = document.getElementById('templatesEmpty');
        if (!tbody) return;

        if (!templates.length) {
            if (wrap) wrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }
        if (wrap) wrap.style.display = '';
        if (empty) empty.style.display = 'none';

        tbody.innerHTML = templates.map(t => {
            const vars = (t.variables_declared || []).map(v =>
                `<span class="tmpl-chip">${escapeHtml(v)}</span>`).join(' ');
            // Sends-from line: shows the picked mailbox, or a muted hint that
            // the template falls back to the tenant default at fire time.
            const mailboxId = t.mailbox_id || t.MailboxId;
            const mailboxLabel = mailboxId
                ? (_mailboxIndex[mailboxId] || '(deleted mailbox)')
                : 'Tenant default';
            const mailboxHint = mailboxId
                ? `<span class="muted" style="font-size:0.78rem;">Sends from <strong>${escapeHtml(mailboxLabel)}</strong></span>`
                : `<span class="muted" style="font-size:0.78rem; font-style:italic;">Sends from tenant default</span>`;
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(t.name)}</strong><br>
                        ${mailboxHint}
                    </td>
                    <td class="hide-mobile">${escapeHtml(t.subject || '—')}</td>
                    <td class="hide-mobile">${vars || '<span class="muted">—</span>'}</td>
                    <td>${new Date(t.updated_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-secondary" onclick="openTemplateModal('${t.id}')">Edit</button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="previewTemplate('${t.id}')">Preview</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteTemplate('${t.id}')">Delete</button>
                    </td>
                </tr>`;
        }).join('');
    }

    // ─── Create / edit modal ───────────────────────────────────────────────

    window.openTemplateModal = async function (id) {
        editingId = id || null;
        document.getElementById('templateModalTitle').textContent =
            id ? 'Edit template' : 'New template';

        let t = { name: '', subject: '', body_html: '', body_text: '', mailbox_id: null };
        if (id) {
            try {
                const resp = await api.request(`/email-templates/${id}`);
                if (resp && resp.template) t = resp.template;
            } catch (e) {
                Toast.error('Failed to load template: ' + (e.message || e));
                return;
            }
        }
        document.getElementById('tmplName').value = t.name || '';
        document.getElementById('tmplSubject').value = t.subject || '';
        document.getElementById('tmplBodyHtml').value = t.body_html || '';
        document.getElementById('tmplBodyText').value = t.body_text || '';
        document.getElementById('tmplModalError').style.display = 'none';

        // Phase 5: populate mailbox picker with shared mailboxes for this
        // tenant. Selecting empty = use tenant default at fire time.
        await populateMailboxOptions(t.mailbox_id || t.MailboxId || '');

        showModal('templateModal');
    };

    async function populateMailboxOptions(selectedId) {
        const sel = document.getElementById('tmplMailbox');
        if (!sel) return;
        // Reset to just the default option, then append shared mailboxes.
        sel.innerHTML = '<option value="">Tenant default mailbox</option>';
        try {
            const resp = await api.request('/crm/mailbox-attachments/shared-mailboxes');
            const mailboxes = (resp && resp.mailboxes) || [];
            mailboxes.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                const inactive = m.is_active === false ? ' (inactive)' : '';
                opt.textContent = `${m.email_address}${inactive}`;
                if (m.is_active === false) opt.disabled = true;
                sel.appendChild(opt);
            });
        } catch (e) {
            console.warn('Failed to load shared mailboxes for template picker:', e);
        }
        sel.value = selectedId || '';
    }

    window.closeTemplateModal = function () {
        hideModal('templateModal');
    };

    window.saveTemplate = async function () {
        const mailboxValue = document.getElementById('tmplMailbox').value.trim();
        const payload = {
            name: document.getElementById('tmplName').value.trim(),
            subject: document.getElementById('tmplSubject').value,
            body_html: document.getElementById('tmplBodyHtml').value,
            body_text: document.getElementById('tmplBodyText').value,
            // Empty string in the <select> means "use tenant default" → null.
            mailbox_id: mailboxValue ? mailboxValue : null,
        };
        if (!payload.name) {
            showTmplError('Name is required.');
            return;
        }
        if (!payload.body_html && !payload.body_text) {
            showTmplError('Provide at least HTML or plain-text body.');
            return;
        }
        try {
            if (editingId) {
                await api.request(`/email-templates/${editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload),
                });
            } else {
                await api.request('/email-templates', {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            }
            hideModal('templateModal');
            await loadTemplatesTab();
        } catch (e) {
            showTmplError(e.message || String(e));
        }
    };

    window.deleteTemplate = async function (id) {
        const ok = await showConfirm(
            'Deactivate this template? Existing campaigns keep working; you just won\'t see it in the picker.',
            'Deactivate template',
            'warning'
        );
        if (!ok) return;
        try {
            await api.request(`/email-templates/${id}`, { method: 'DELETE' });
            Toast.success('Template deactivated');
            await loadTemplatesTab();
        } catch (e) {
            Toast.error('Delete failed: ' + (e.message || e));
        }
    };

    // ─── Preview ───────────────────────────────────────────────────────────

    window.previewTemplate = async function (id) {
        // Sample context — hardcoded representative values so templaters can
        // sanity-check rendering without hand-crafting sample data.
        const sample_context = {
            first_name: 'Jane',
            last_name: 'Doe',
            full_name: 'Jane Doe',
            company: 'Acme Corp',
            company_name: 'Acme Corp',
            job_title: 'Head of Marketing',
            city: 'Austin',
            country: 'USA',
            email: 'jane@acme.com',
        };
        try {
            const resp = await api.request(`/email-templates/${id}/preview`, {
                method: 'POST',
                body: JSON.stringify({ sample_context }),
            });
            document.getElementById('tmplPreviewSubject').textContent = resp.subject || '(no subject)';
            const frame = document.getElementById('tmplPreviewFrame');
            // Use srcdoc so template HTML is rendered in its own sandbox; no
            // stylesheet leak between preview and host page.
            frame.srcdoc = resp.body_html || `<pre>${escapeHtml(resp.body_text || '(empty)')}</pre>`;
            showModal('templatePreviewModal');
        } catch (e) {
            Toast.error('Preview failed: ' + (e.message || e));
        }
    };

    window.closeTemplatePreview = function () {
        hideModal('templatePreviewModal');
    };

    // ─── helpers ───────────────────────────────────────────────────────────

    function showTmplError(msg) {
        const el = document.getElementById('tmplModalError');
        el.textContent = msg;
        el.style.display = 'block';
    }
    function showModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.add('active');
    }
    function hideModal(id) {
        const m = document.getElementById(id);
        if (m) m.classList.remove('active');
    }
    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Auto-load if tab already active when script parses (handles SPA-ish
    // navigation race where settings.js fires DOMContentLoaded before us).
    function initIfActive() {
        const tab = document.getElementById('tab-templates');
        if (tab && tab.classList.contains('active')) window.loadTemplatesTab();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initIfActive);
    else initIfActive();
})();
