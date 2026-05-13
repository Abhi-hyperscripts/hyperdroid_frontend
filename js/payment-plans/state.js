// ============================================================
// PaymentPlans — global state cache (tenant id, vocabulary, defs)
// Lives on window.PP to keep module boundaries tight.
// ============================================================
(function () {
    'use strict';

    function getTenantId() {
        // Primary: organization_info cached by config.js after login
        try {
            const cached = localStorage.getItem('organization_info');
            if (cached) {
                const info = JSON.parse(cached);
                if (info?.tenantId) return info.tenantId;
            }
        } catch (_) {}
        // Fallback 1: extract from JWT payload directly
        try {
            const tok = localStorage.getItem('access_token');
            if (tok) {
                const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (payload?.tenant_id) return payload.tenant_id;
            }
        } catch (_) {}
        // Fallback 2: legacy key
        try { return localStorage.getItem('tenant_id') || null; } catch (_) { return null; }
    }

    // Lowercase `toast` shim — js/toast.js exports `Toast` (capital).
    // Wrapped in try/catch so a toast failure (missing container, init race,
    // etc.) NEVER takes down the calling handler — the Save flow must keep
    // running and close the modal even if the toast plumbing throws.
    function safeShow(m, type) {
        try {
            if (typeof window.Toast?.show === 'function') {
                window.Toast.show(m, type);
            } else if (typeof window.showToast === 'function') {
                window.showToast(m, type);
            } else {
                console.log(`[toast.${type}]`, m);
            }
        } catch (e) { console.warn('toast failed:', e?.message || e); }
    }
    if (typeof window.toast === 'undefined') {
        window.toast = {
            success: (m) => safeShow(m, 'success'),
            error:   (m) => safeShow(m, 'error'),
            info:    (m) => safeShow(m, 'info'),
            warning: (m) => safeShow(m, 'warning')
        };
    }

    window.PP = window.PP || {
        tenantId: getTenantId(),
        config: null,                  // TenantConfig
        vocabulary: null,              // shorthand
        customFields: {                // { entity_type: [definitions...] }
            payer: null, plan: null, installment: null, group: null
        },
        statusDefs: {                  // { entity_type: [definitions...] }
            payer: null, plan: null, installment: null, group: null
        },
        templates: null,               // list of NotificationTemplate
        mappings: null,                // list of ReminderTemplateMapping
        planTemplates: null,           // list of PlanTemplate
        cohorts: null,                 // list of PayerGroup
        payersCache: null,             // list of Payer

        async loadConfig(force = false) {
            if (this.config && !force) return this.config;
            const r = await api.request(`/payment-plans/tenant-config?tenantId=${this.tenantId}`);
            this.config = r;
            this.vocabulary = r.vocabulary || {};
            return r;
        },

        async loadCustomFields(entityType, force = false) {
            if (this.customFields[entityType] && !force) return this.customFields[entityType];
            const list = await api.request(`/payment-plans/custom-fields?tenantId=${this.tenantId}&entityType=${entityType}`);
            this.customFields[entityType] = list || [];
            return this.customFields[entityType];
        },

        async loadStatusDefs(entityType, force = false) {
            if (this.statusDefs[entityType] && !force) return this.statusDefs[entityType];
            const list = await api.request(`/payment-plans/status-definitions?tenantId=${this.tenantId}&entityType=${entityType}`);
            this.statusDefs[entityType] = list || [];
            return this.statusDefs[entityType];
        },

        invalidate(key) {
            if (key === 'customFields') {
                this.customFields = { payer: null, plan: null, installment: null, group: null };
            } else if (key === 'statusDefs') {
                this.statusDefs = { payer: null, plan: null, installment: null, group: null };
            } else if (key) {
                this[key] = null;
            }
        },

        // Vocabulary getter — falls back to default English label if unset.
        vocab(key, fallback) {
            const v = (this.vocabulary || {})[key];
            return v && String(v).trim() ? v : fallback;
        },

        // Common labels (memoized via getters)
        get payerLabel() { return this.vocab('payer', 'Payer'); },
        get payerPlural() { return this.vocab('payer_plural', 'Payers'); },
        get groupLabel() { return this.vocab('group', 'Group'); },
        get groupPlural() { return this.vocab('group_plural', 'Groups'); },
        get planLabel() { return this.vocab('plan', 'Payment Plan'); },
        get installmentLabel() { return this.vocab('installment', 'Installment'); }
    };
})();
