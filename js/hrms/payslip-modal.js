/**
 * Unified Payslip Modal Component for Ragenaizer HRMS
 *
 * A reusable payslip viewing component with calculation proof support.
 * Used across payroll.js, self-service.js, and any page that needs to display payslips.
 *
 * Usage:
 *   // View a processed payslip
 *   PayslipModal.viewProcessed(payslipId);
 *
 *   // View a draft payslip
 *   PayslipModal.viewDraft(payslipId);
 *
 *   // View calculation proof
 *   PayslipModal.viewCalculationProof(payslipId, isDraft);
 *
 * Dependencies:
 *   - api.js (for API requests)
 *   - toast.js (for notifications)
 *
 * @version 1.0.0
 */

const PayslipModal = (function() {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================

    let stylesInjected = false;
    let proofStylesInjected = false;
    let currentPayslipId = null;

    // Store proof data for download/print
    window.currentCalculationProof = null;

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    /**
     * Format currency using locale
     */
    function formatCurrency(amount, currencySymbol = '₹', locale = 'en-IN') {
        if (amount === null || amount === undefined) return `${currencySymbol} 0`;
        return `${currencySymbol} ${Number(amount).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }

    /**
     * Format date to readable string
     */
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    /**
     * Get month name from month number
     */
    function getMonthName(month) {
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
        return months[(month - 1) % 12] || '';
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Group payslip items by salary structure
     */
    function groupItemsByStructure(items) {
        const groups = {};
        items.forEach(item => {
            const key = item.structure_version_id || item.structureVersionId || 'default';
            if (!groups[key]) {
                groups[key] = {
                    structure_name: item.structure_name || item.structureName || 'Salary Structure',
                    structure_version_id: key,
                    period_start: item.version_period_start || item.versionPeriodStart,
                    period_end: item.version_period_end || item.versionPeriodEnd,
                    items: []
                };
            }
            groups[key].items.push(item);
        });
        return Object.values(groups);
    }

    // ==========================================
    // MODAL MANAGEMENT
    // ==========================================

    /**
     * Create and inject the payslip modal into DOM
     */
    function ensureModalExists() {
        let modal = document.getElementById('payslipModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'payslipModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered" style="max-width: 900px; width: 95%;">
                    <div class="modal-content" style="max-width: 100%; width: 100%;">
                        <div class="modal-header">
                            <h5 class="modal-title">Payslip Details</h5>
                            <div class="modal-header-actions">
                                <button class="action-btn" onclick="PayslipModal.downloadPdf()" title="Download PDF">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                </button>
                                <button class="close-btn" onclick="PayslipModal.close()">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div class="modal-body">
                            <div id="payslipContent"></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        return modal;
    }

    /**
     * Open a modal by ID — two-phase animation via glassmorphic-modal.css
     */
    function openModal(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        el.classList.add('gm-animating');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('active'));
        });
    }

    /**
     * Close a modal by ID — two-phase animation via glassmorphic-modal.css
     */
    function closeModal(modalId) {
        const el = document.getElementById(modalId);
        if (!el) return;
        el.classList.remove('active');
        setTimeout(() => el.classList.remove('gm-animating'), 200);
    }

    // ==========================================
    // STYLE INJECTION
    // ==========================================

    /**
     * Inject payslip modal styles
     */
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        const style = document.createElement('style');
        style.id = 'payslip-modal-styles';
        style.textContent = `
            /* Payslip Modal Styles */
            .payslip-header {
                margin-bottom: 0.75rem;
                padding-bottom: 0.5rem;
                border-bottom: 1px solid var(--border-color);
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .payslip-summary {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 0.5rem;
                margin-bottom: 0.75rem;
            }

            .payslip-summary .summary-item {
                padding: 0.5rem;
                background: var(--bg-subtle, var(--bg-body, #f5f7fa));
                border-radius: 6px;
                text-align: center;
            }

            .multi-location-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                background: var(--color-info);
                color: white;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 0.7rem;
                margin-left: 8px;
            }

            .modal-header-actions {
                display: flex;
                gap: 8px;
                align-items: center;
            }

            .modal-header-actions .action-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 4px;
                color: var(--text-secondary);
                transition: color 0.2s;
            }

            .modal-header-actions .action-btn:hover {
                color: var(--text-primary);
            }

            .modal-header-actions .close-btn {
                background: var(--brand-primary);
                border: none;
                cursor: pointer;
                padding: 4px;
                border-radius: 50%;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Inject calculation proof styles - comprehensive version matching payroll.js
     */
    function injectCalculationProofStyles() {
        if (proofStylesInjected) return;
        proofStylesInjected = true;

        const style = document.createElement('style');
        style.id = 'calculation-proof-styles';
        style.textContent = `
            /* Modal body for proof */
            .proof-modal-body {
                padding: 0 !important;
                max-height: calc(90vh - 60px);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            /* Tabs Navigation */
            .proof-tabs {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.75rem 1rem;
                background: var(--bg-body, #f5f7fa);
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
            }

            .proof-tab {
                display: flex;
                align-items: center;
                gap: 0.375rem;
                padding: 0.5rem 1rem;
                background: transparent;
                border: 1px solid var(--border-color, rgba(0,0,0,0.08));
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
                color: var(--text-secondary);
                transition: all 0.2s ease;
            }

            .proof-tab:hover {
                background: var(--bg-elevated, rgba(0,0,0,0.03));
                color: var(--text-primary);
            }

            .proof-tab.active {
                background: var(--brand-primary);
                color: var(--text-inverse);
                border-color: var(--brand-primary);
            }

            .proof-tab svg { flex-shrink: 0; }

            .proof-tab-actions {
                margin-left: auto;
                display: flex;
                gap: 0.5rem;
            }

            /* Tab Content - use body background for contrast with white cards */
            .proof-tab-content {
                flex: 1;
                overflow-y: auto;
                padding: 1rem;
                background: var(--bg-body, #f5f7fa);
            }

            #proofTabFormatted, #proofTabJson {
                max-height: calc(90vh - 140px);
            }

            /* JSON Viewer */
            .json-toolbar {
                display: flex;
                gap: 0.5rem;
                margin-bottom: 1rem;
                padding-bottom: 1rem;
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
            }

            .json-viewer {
                font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
                font-size: 0.8rem;
                line-height: 1.5;
                padding: 1rem;
                background: var(--bg-card, #ffffff);
                border: 1px solid var(--border-color, rgba(0,0,0,0.1));
                border-radius: 8px;
                overflow: auto;
                max-height: calc(90vh - 250px);
                white-space: pre-wrap;
                word-wrap: break-word;
                color: var(--text-primary);
            }

            /* Summary Row */
            .proof-summary-row {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 0.75rem;
                margin-bottom: 1rem;
            }

            .proof-summary-card {
                padding: 0.875rem;
                border-radius: 8px;
                text-align: center;
                transition: transform 0.2s;
                color: var(--text-inverse, #ffffff);
            }

            .proof-summary-card:hover { transform: translateY(-2px); }
            .proof-summary-card.earnings { background: linear-gradient(135deg, var(--color-success, #10b981), var(--color-success-dark, #059669)); }
            .proof-summary-card.deductions { background: linear-gradient(135deg, var(--color-warning, #f59e0b), var(--color-warning-dark, #d97706)); }
            .proof-summary-card.net-pay { background: linear-gradient(135deg, var(--brand-accent, #6366f1), var(--brand-primary, #4f46e5)); }

            .summary-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: var(--text-inverse, #ffffff);
                margin-bottom: 0.25rem;
            }

            .summary-value { font-size: 1.25rem; font-weight: 700; color: var(--text-inverse, #ffffff); }

            /* Section Grid */
            .proof-section-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.75rem;
                margin-bottom: 0.75rem;
            }

            @media (max-width: 768px) {
                .proof-section-grid { grid-template-columns: 1fr; }
                .proof-summary-row { grid-template-columns: 1fr; }
            }

            /* Cards - compact design with visible shadow for clear separation */
            .proof-card {
                background: var(--bg-card, #ffffff);
                border-radius: 8px;
                border: 1px solid var(--border-color, rgba(0,0,0,0.1));
                margin-bottom: 0.5rem;
                overflow: hidden;
                transition: all 0.2s ease;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
            }

            .proof-card:hover {
                border-color: var(--brand-primary);
                transform: translateY(-1px);
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06);
            }

            .proof-card-header {
                display: flex;
                align-items: center;
                gap: 0.375rem;
                padding: 0.5rem 0.625rem;
                background: var(--bg-elevated, rgba(245,245,248,0.95));
                font-weight: 600;
                font-size: 0.75rem;
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
                color: var(--text-primary);
            }

            .proof-card-header svg {
                width: 14px;
                height: 14px;
            }

            .header-badge {
                margin-left: auto;
                padding: 0.125rem 0.5rem;
                border-radius: 12px;
                font-size: 0.65rem;
                font-weight: 600;
                color: var(--text-inverse);
            }

            .earnings-badge { background: var(--color-success); }
            .deductions-badge { background: var(--color-warning); }
            .tax-badge { background: var(--brand-accent, var(--brand-primary)); }
            .employer-badge { background: var(--color-info); }
            .voluntary-badge { background: var(--color-info); }
            .timeline-badge { background: var(--color-info); }
            .location-badge { background: var(--brand-secondary, var(--brand-primary)); }

            .proof-card-body { padding: 0.5rem; }

            /* Info Grid - using cp- prefix to avoid conflicts with hrms-ess.css */
            .cp-info-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.375rem;
            }

            .cp-info-item {
                display: flex;
                flex-direction: column;
                background: none !important;
                border: none !important;
                padding: 0 !important;
            }

            .info-label {
                font-size: 0.65rem;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.03em;
            }

            .info-value {
                font-size: 0.8rem;
                font-weight: 500;
                color: var(--text-primary);
            }

            /* Compensation Grid */
            .compensation-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 0.75rem;
                text-align: center;
            }

            .comp-item { display: flex; flex-direction: column; }
            .comp-label { font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase; }
            .comp-value { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); }

            /* Tables */
            .proof-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.75rem;
            }

            .proof-table th {
                background: var(--bg-body, #f5f7fa);
                padding: 0.375rem 0.5rem;
                font-weight: 600;
                text-align: left;
                border-bottom: 2px solid var(--border-color, rgba(0,0,0,0.1));
                color: var(--text-primary);
            }

            .proof-table td {
                padding: 0.375rem 0.5rem;
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
                color: var(--text-primary);
            }

            .proof-table tbody tr:hover { background: var(--bg-elevated, rgba(0,0,0,0.03)); }
            .proof-table .text-right { text-align: right; }
            .proof-table .text-center { text-align: center; }

            .proof-table tfoot td {
                background: var(--bg-body, #f5f7fa);
                border-top: 2px solid var(--border-color, rgba(0,0,0,0.1));
                border-bottom: none;
            }

            .total-row td { font-weight: 600; }

            .component-name {
                display: flex;
                align-items: center;
                gap: 0.375rem;
            }

            .eligibility-reason { color: var(--text-secondary); cursor: help; }

            .eligibility-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                font-size: 0.65rem;
                color: var(--text-inverse);
            }

            .eligibility-badge.eligible { background: var(--color-success); }
            .eligibility-badge.not-eligible { background: var(--color-error); }
            tr.not-eligible { opacity: 0.6; }

            /* Tax Card */
            .tax-regime-banner {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.75rem 1rem;
                background: linear-gradient(135deg, var(--brand-secondary, #8b5cf6), var(--brand-accent, #7c3aed));
                color: var(--text-inverse, #ffffff);
                border-radius: 8px;
                margin-bottom: 1rem;
            }

            .regime-label { opacity: 0.9; color: var(--text-inverse, #ffffff); }
            .regime-value { font-weight: 600; color: var(--text-inverse, #ffffff); }
            .regime-section { opacity: 0.8; font-size: 0.85rem; color: var(--text-inverse, #ffffff); }

            .tax-flow {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 0.5rem;
                padding: 1rem;
                background: var(--bg-body, #f5f7fa);
                border-radius: 8px;
                margin-bottom: 1rem;
            }

            .tax-flow-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 0.5rem 1rem;
                background: var(--bg-card, #ffffff);
                border-radius: 6px;
                border: 1px solid var(--border-color, rgba(0,0,0,0.08));
                color: var(--text-primary);
            }

            .tax-flow-item.result {
                background: var(--brand-primary);
                color: var(--text-inverse);
                border: none;
            }

            .flow-label { font-size: 0.7rem; text-transform: uppercase; opacity: 0.8; }
            .flow-value { font-weight: 600; font-size: 0.9rem; }
            .tax-flow-operator { font-size: 1.25rem; font-weight: bold; color: var(--text-secondary); }

            .pretax-section {
                background: var(--bg-body, #f5f7fa);
                border-radius: 8px;
                padding: 1rem;
                margin-bottom: 1rem;
            }

            .pretax-title {
                font-size: 0.75rem;
                text-transform: uppercase;
                color: var(--text-secondary);
                margin-bottom: 0.5rem;
            }

            .pretax-item {
                display: flex;
                justify-content: space-between;
                padding: 0.25rem 0;
                font-size: 0.85rem;
                color: var(--text-primary);
            }

            .pretax-item.pretax-total {
                border-top: 1px dashed var(--border-color, rgba(0,0,0,0.1));
                margin-top: 0.5rem;
                padding-top: 0.5rem;
                font-weight: 600;
            }

            /* v3.0.128: Declaration Validation Section (80C, 80D, etc.) */
            .declaration-validation-section {
                background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%);
                border: 1px solid rgba(16, 185, 129, 0.3);
                border-radius: 8px;
                padding: 0.6rem 0.75rem;
                margin-bottom: 0.75rem;
            }

            .declaration-title {
                display: flex;
                align-items: center;
                gap: 0.4rem;
                font-size: 0.8rem;
                font-weight: 600;
                color: var(--color-success, #10b981);
                margin-bottom: 0.2rem;
            }

            .declaration-subtitle {
                font-size: 0.7rem;
                color: var(--text-secondary, #64748b);
                margin-bottom: 0.5rem;
                padding-bottom: 0.4rem;
                border-bottom: 1px dashed var(--color-success-alpha, rgba(16, 185, 129, 0.3));
            }

            .declaration-section-group {
                background: var(--bg-card);
                border-radius: 6px;
                padding: 0.5rem 0.6rem;
                margin-bottom: 0.4rem;
                border: 1px solid var(--border-color);
            }

            .declaration-section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.35rem;
            }

            .declaration-section-name {
                font-weight: 600;
                font-size: 0.75rem;
                color: var(--text-primary);
            }

            .declaration-section-code {
                background: var(--brand-primary, #3b82f6);
                color: var(--text-inverse, #ffffff);
                font-size: 0.55rem;
                padding: 0.1rem 0.3rem;
                border-radius: 3px;
                font-weight: 500;
            }

            .declaration-items-header {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 0.75rem;
                font-size: 0.6rem;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                color: var(--text-secondary);
                padding: 0.25rem 0;
                border-bottom: 1px solid var(--border-color);
            }

            .declaration-items-header span:not(:first-child) {
                text-align: right;
            }

            .declaration-item {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 0.75rem;
                padding: 0.3rem 0;
                font-size: 0.7rem;
                color: var(--text-primary);
                border-bottom: 1px dotted var(--border-color-light);
                align-items: center;
            }

            .declaration-item-name {
                font-size: 0.7rem;
                color: var(--text-primary);
            }

            .declaration-item-declared,
            .declaration-item-allowed {
                text-align: right;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
                font-size: 0.7rem;
                white-space: nowrap;
                color: var(--text-primary);
            }

            .declaration-capped-badge {
                background: rgba(245, 158, 11, 0.2);
                color: var(--color-warning, #f59e0b);
                font-size: 0.6rem;
                padding: 0.1rem 0.3rem;
                border-radius: 3px;
                margin-left: 0.25rem;
            }

            .declaration-section-total {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 0.75rem;
                padding: 0.4rem 0 0.2rem;
                margin-top: 0.25rem;
                border-top: 1px solid var(--border-color);
                font-weight: 600;
                font-size: 0.7rem;
                align-items: start;
            }

            .declaration-section-total span:first-child {
                color: var(--text-primary);
            }

            .declaration-section-total span:nth-child(2),
            .declaration-section-total span:nth-child(3) {
                text-align: right;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
                white-space: nowrap;
                color: var(--text-primary);
            }

            .declaration-section-capped {
                display: block;
                font-size: 0.6rem;
                color: var(--color-warning, #f59e0b);
                font-weight: 500;
                margin-top: 0.35rem;
                padding: 0.3rem 0.5rem;
                background: rgba(245, 158, 11, 0.1);
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 4px;
                text-align: center;
            }

            .declaration-warnings {
                background: rgba(245, 158, 11, 0.1);
                border: 1px solid rgba(245, 158, 11, 0.3);
                border-radius: 5px;
                padding: 0.4rem 0.5rem;
                margin-top: 0.4rem;
            }

            .declaration-warning-title {
                font-size: 0.65rem;
                font-weight: 600;
                color: var(--color-warning, #f59e0b);
                margin-bottom: 0.2rem;
            }

            .declaration-warning-item {
                font-size: 0.65rem;
                color: var(--text-secondary, #64748b);
                padding: 0.1rem 0;
            }

            .slab-section { margin-bottom: 1rem; }
            .slab-title { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: var(--text-primary); }

            .rebate-section { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
            .rebate-section.applicable { background: rgba(16, 185, 129, 0.1); border: 1px solid var(--color-success); }
            .rebate-section.not-applicable { background: rgba(239, 68, 68, 0.1); border: 1px solid var(--color-error); }

            .rebate-header { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; margin-bottom: 0.25rem; color: var(--text-primary); }
            .rebate-icon { font-size: 1.1rem; }
            .rebate-section.applicable .rebate-icon { color: var(--color-success); }
            .rebate-section.not-applicable .rebate-icon { color: var(--color-error); }

            .rebate-details { font-size: 0.85rem; display: flex; gap: 1rem; flex-wrap: wrap; color: var(--text-primary); }
            .rebate-amount { font-weight: 600; color: var(--color-success); }
            .rebate-reason { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem; }

            /* Marginal Relief Section (Finance Bill 2025) */
            .marginal-relief-section { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; background: rgba(16, 185, 129, 0.1); border: 1px solid var(--color-success); }
            .marginal-relief-section .rebate-header { border-bottom: 1px dashed rgba(16, 185, 129, 0.3); padding-bottom: 0.5rem; margin-bottom: 0.75rem; }
            .marginal-relief-calculation { background: rgba(255, 255, 255, 0.5); border-radius: 6px; padding: 0.75rem; margin: 0.5rem 0; }
            .relief-line { display: flex; justify-content: space-between; padding: 0.25rem 0; font-size: 0.85rem; color: var(--text-primary); }
            .relief-line.highlight { background: rgba(16, 185, 129, 0.15); border-radius: 4px; padding: 0.5rem 0.75rem; margin: 0.25rem -0.5rem; font-weight: 600; }
            .relief-line.savings { color: var(--color-success); font-weight: 600; border-top: 1px dashed rgba(16, 185, 129, 0.3); margin-top: 0.5rem; padding-top: 0.5rem; }
            .savings-amount { color: var(--color-success); }
            .tax-line.cess-absorbed { opacity: 0.6; font-style: italic; }

            .tax-final {
                background: var(--bg-body, #f5f7fa);
                border-radius: 8px;
                padding: 1rem;
                padding-bottom: 3rem;
                position: relative;
            }

            .tax-line { display: flex; justify-content: space-between; padding: 0.375rem 0; font-size: 0.9rem; color: var(--text-primary); }
            .tax-line.total { border-top: 1px solid var(--border-color, rgba(0,0,0,0.1)); margin-top: 0.5rem; padding-top: 0.5rem; font-weight: 600; }
            .tax-line.monthly {
                background: var(--brand-primary);
                color: var(--text-inverse);
                margin-top: 0.5rem;
                padding: 0.75rem 1rem;
                border-radius: 0 0 8px 8px;
                position: absolute;
                left: 0; right: 0; bottom: 0;
            }

            .monthly-tds { font-size: 1.1rem; font-weight: 700; }

            /* Employer Card */
            .employer-note {
                font-size: 0.8rem;
                color: var(--text-secondary);
                font-style: italic;
                margin-bottom: 0.75rem;
                padding: 0.5rem;
                background: var(--bg-body, #f5f7fa);
                border-radius: 6px;
            }

            /* Verification Card */
            .verification-card { border: 2px solid var(--brand-primary); }
            .verification-grid { display: flex; flex-direction: column; gap: 0.5rem; }

            .verification-item {
                display: flex;
                align-items: center;
                padding: 0.625rem 0.75rem;
                background: var(--bg-body, #f5f7fa);
                border-radius: 6px;
                color: var(--text-primary);
            }

            .verification-item.highlight {
                background: linear-gradient(135deg, var(--brand-primary, #3b82f6), var(--brand-primary-light, #6ca1f8));
                color: var(--text-inverse, #ffffff);
            }

            .verification-label { flex: 1; font-size: 0.9rem; }
            .verification-value { font-weight: 600; margin-right: 1rem; }
            .verification-check { color: var(--color-success); font-size: 1.25rem; }
            .verification-item.highlight .verification-check { color: var(--text-inverse); }

            /* Footer */
            .proof-footer {
                padding: 1rem;
                background: var(--bg-body, #f5f7fa);
                border-top: 1px solid var(--border-color, rgba(0,0,0,0.1));
                text-align: center;
            }

            .footer-info {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 0.75rem;
                font-size: 0.75rem;
                color: var(--text-secondary);
            }

            .text-warning { color: var(--color-warning); font-weight: 600; }

            /* Voluntary Deductions Section */
            .voluntary-header svg { color: var(--color-info); }

            .section-description {
                font-size: 0.85rem;
                color: var(--text-secondary);
                margin-bottom: 1rem;
                padding: 0.75rem 1rem;
                background: var(--bg-elevated, rgba(0,0,0,0.03));
                border-radius: 6px;
                border-left: 3px solid var(--brand-primary);
            }

            .proration-badge {
                display: inline-flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.125rem 0.5rem;
                background: var(--status-pending);
                color: var(--text-inverse);
                border-radius: 10px;
                font-size: 0.7rem;
                font-weight: 600;
            }

            .proration-note {
                background: var(--bg-body, #f5f7fa);
                border-radius: 6px;
                padding: 0.75rem 1rem;
                margin-top: 0.75rem;
                font-size: 0.8rem;
                color: var(--text-secondary);
            }

            .proration-note strong { color: var(--text-primary); }
            .proration-list { margin: 0.5rem 0 0 1.25rem; padding: 0; }
            .proration-list li { margin-bottom: 0.25rem; }

            /* Adjustments Section */
            .adjustments-header svg { color: var(--brand-accent, var(--brand-primary)); }
            .adjustments-subsection { margin-bottom: 0.75rem; }

            .subsection-title {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.85rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
                color: var(--text-secondary);
            }

            .subsection-title.additions-title svg { color: var(--color-success); }
            .subsection-title.deductions-title svg { color: var(--color-error); }

            .adjustment-type { display: inline-flex; align-items: center; gap: 0.25rem; }
            .adjustment-type.addition svg { color: var(--color-success); }
            .adjustment-type.deduction svg { color: var(--color-error); }
            .adjustment-reason { font-size: 0.75rem; color: var(--text-secondary); }

            .addition-amount { color: var(--color-success); font-weight: 600; }
            .deduction-amount { color: var(--color-error); font-weight: 600; }

            .subtotal-row td { background: var(--bg-body, #f5f7fa); font-size: 0.9rem; }
            .adjustments-table { margin-bottom: 0; }
            .adjustments-table td { border-bottom: none; }
            .adjustments-table tbody tr:hover { background: transparent; }
            .adjustments-table tfoot td { border-top: none; }
            .text-muted { color: var(--text-secondary); font-style: italic; }

            /* Version Timeline Section */
            .timeline-card { border-left: 3px solid var(--color-info); }
            .timeline-header svg { color: var(--color-info); }

            .version-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 2.5rem;
                padding: 0.25rem 0.5rem;
                background: var(--brand-primary);
                color: var(--text-inverse);
                border-radius: 4px;
                font-size: 0.75rem;
                font-weight: 600;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }

            .days-badge {
                display: inline-flex;
                align-items: center;
                padding: 0.25rem 0.75rem;
                background: var(--bg-body, #f5f7fa);
                color: var(--text-primary);
                border-radius: 12px;
                font-size: 0.8rem;
                font-weight: 500;
            }

            .reason-badge {
                display: inline-flex;
                align-items: center;
                padding: 0.25rem 0.75rem;
                background: var(--bg-body, #f5f7fa);
                color: var(--text-secondary);
                border-radius: 12px;
                font-size: 0.75rem;
                text-transform: capitalize;
            }

            .reason-badge.structure_update { background: var(--status-pending); color: var(--text-inverse); }
            .reason-badge.transfer { background: var(--color-info); color: var(--text-inverse); }
            .reason-badge.promotion { background: var(--color-success); color: var(--text-inverse); }

            .timeline-table .structure-name { font-weight: 500; }
            .timeline-table .first-version td { background: var(--bg-elevated, rgba(0,0,0,0.03)); }

            /* Arrears Lifecycle Section - v3.0.114 - Compact */
            .arrears-lifecycle-card { border-left: 2px solid var(--color-warning); }
            .arrears-lifecycle-header svg { color: var(--color-warning); }

            .arrears-summary-banner {
                padding: 0.5rem 0.75rem;
                background: linear-gradient(135deg, var(--bg-body, #f5f7fa) 0%, var(--bg-elevated, rgba(0,0,0,0.03)) 100%);
                border-radius: 6px;
                margin-bottom: 0.625rem;
                border: 1px solid var(--border-color, rgba(0,0,0,0.08));
            }

            .arrears-summary-text {
                font-size: 0.8rem;
                color: var(--text-primary);
                margin: 0;
                line-height: 1.4;
            }

            .arrears-chain-alert {
                display: flex;
                align-items: flex-start;
                gap: 0.5rem;
                padding: 0.5rem 0.75rem;
                background: var(--bg-elevated, rgba(0,0,0,0.03));
                border-radius: 6px;
                margin-bottom: 0.625rem;
                border-left: 2px solid var(--color-info);
            }

            .arrears-chain-alert svg {
                flex-shrink: 0;
                color: var(--color-info);
                margin-top: 1px;
                width: 14px;
                height: 14px;
            }

            .arrears-chain-alert .chain-text {
                font-size: 0.75rem;
                color: var(--text-secondary);
                line-height: 1.4;
            }

            .arrears-records-title {
                display: flex;
                align-items: center;
                gap: 0.375rem;
                font-size: 0.75rem;
                font-weight: 600;
                color: var(--text-secondary);
                margin-bottom: 0.5rem;
                padding-bottom: 0.375rem;
                border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08));
            }

            .arrears-record {
                display: flex;
                align-items: flex-start;
                gap: 0.625rem;
                padding: 0.5rem 0.625rem;
                margin-bottom: 0.375rem;
                background: var(--bg-card, #ffffff);
                border-radius: 6px;
                border: 1px solid var(--border-color, rgba(0,0,0,0.08));
                transition: all 0.15s ease;
            }

            .arrears-record:hover {
                background: var(--bg-elevated, rgba(0,0,0,0.03));
                border-color: var(--border-color, rgba(0,0,0,0.1));
            }

            .arrears-record.status-applied {
                border-left: 2px solid var(--color-success);
            }

            .arrears-record.status-superseded {
                border-left: 2px solid var(--text-tertiary);
                opacity: 0.75;
            }

            .arrears-record-status {
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 0.125rem;
                min-width: 65px;
            }

            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 0.125rem;
                padding: 0.125rem 0.5rem;
                border-radius: 10px;
                font-size: 0.625rem;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.025em;
            }

            .status-badge.applied {
                background: var(--color-success);
                color: var(--text-inverse);
            }

            .status-badge.superseded {
                background: #f59e0b;
                color: #ffffff;
            }

            .arrears-record-details {
                flex: 1;
                min-width: 0;
            }

            .arrears-record-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 0.5rem;
                margin-bottom: 0.125rem;
            }

            .arrears-period {
                font-weight: 600;
                color: var(--text-primary);
                font-size: 0.8rem;
            }

            .arrears-amount {
                font-weight: 700;
                font-size: 0.8rem;
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
            }

            .arrears-amount.positive { color: var(--color-success); }
            .arrears-amount.negative { color: var(--color-error); }
            .arrears-amount.zero { color: var(--text-tertiary); text-decoration: line-through; }

            .arrears-ctc-change {
                font-size: 0.7rem;
                color: var(--text-secondary);
                margin-bottom: 0.125rem;
            }

            .arrears-ctc-change .ctc-arrow {
                color: var(--text-tertiary);
                margin: 0 0.25rem;
            }

            .arrears-note {
                font-size: 0.7rem;
                color: var(--text-secondary);
                font-style: italic;
                line-height: 1.3;
            }

            .arrears-stats-row {
                display: flex;
                gap: 0.5rem;
                margin-top: 0.625rem;
                padding-top: 0.625rem;
                border-top: 1px solid var(--border-color, rgba(0,0,0,0.08));
                flex-wrap: wrap;
            }

            .arrears-stat {
                display: flex;
                align-items: center;
                gap: 0.25rem;
                padding: 0.25rem 0.5rem;
                background: var(--bg-body, #f5f7fa);
                border-radius: 4px;
                font-size: 0.7rem;
            }

            .arrears-stat-label { color: var(--text-secondary); }
            .arrears-stat-value { font-weight: 600; color: var(--text-primary); }
            .arrears-stat-value.applied { color: var(--color-success); }
            .arrears-stat-value.superseded { color: var(--text-tertiary); }

            /* Location Breakdown Section */
            .location-card { border-left: 3px solid var(--brand-secondary, var(--brand-primary)); }
            .location-header svg { color: var(--brand-secondary, var(--brand-primary)); }

            .location-name { font-size: 0.8rem; white-space: nowrap; }
            .location-icon { font-size: 0.85rem; }
            .office-code { color: var(--text-secondary); font-size: 0.7rem; font-family: 'JetBrains Mono', monospace; margin-left: 0.25rem; }

            .location-table { font-size: 0.75rem; border-collapse: collapse; }
            .location-table th { font-size: 0.7rem; padding: 0.5rem; vertical-align: middle; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.08)); }
            .location-table td { padding: 0.5rem; vertical-align: middle; line-height: 1.4; border-bottom: none; }
            .location-table .primary-location td { background: transparent; }
            .location-table .net-cell { color: var(--color-success); }
            .location-table .days-badge { padding: 0.125rem 0.375rem; font-size: 0.7rem; }
            .location-table tfoot td { border-top: none; }
            .location-table tbody tr:hover { background: transparent; }

            .jurisdiction-note {
                font-size: 0.8rem;
                color: var(--text-secondary);
                margin-bottom: 1rem;
                padding: 0.75rem 1rem;
                background: var(--bg-elevated, rgba(0,0,0,0.03));
                border-radius: 6px;
                border-left: 3px solid var(--color-info);
            }

            .jurisdiction-note strong { color: var(--text-primary); }

            /* Grouped Earnings */
            .version-group-header td {
                background: linear-gradient(135deg, var(--brand-primary) 0%, color-mix(in srgb, var(--brand-primary) 80%, black) 100%);
                padding: 0.75rem 1rem !important;
                border-top: 2px solid var(--brand-primary);
            }

            .version-group-title { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }

            .version-badge-sm {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 2rem;
                padding: 0.2rem 0.5rem;
                background: rgba(255, 255, 255, 0.2);
                color: var(--text-inverse);
                border-radius: 4px;
                font-size: 0.7rem;
                font-weight: 700;
                font-family: 'JetBrains Mono', monospace;
            }

            .version-group-title .structure-name { color: var(--text-inverse); font-weight: 600; font-size: 0.9rem; }
            .period-label { color: rgba(255, 255, 255, 0.8); font-size: 0.8rem; font-style: italic; margin-left: auto; }

            .version-group-item td { background: var(--bg-card, #ffffff); border-left: 3px solid transparent; padding-left: 1.5rem !important; }
            .version-group-item:hover td { background: var(--bg-elevated, rgba(0,0,0,0.03)); }

            .version-subtotal-row td { background: var(--bg-body, #f5f7fa); border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1)); font-size: 0.85rem; padding: 0.5rem 1rem !important; }
            .version-subtotal-row em { color: var(--text-secondary); }

            .jurisdiction-label {
                display: inline-block;
                margin-left: 0.5rem;
                padding: 0.15rem 0.5rem;
                background: var(--bg-body, #f5f7fa);
                color: var(--text-secondary);
                border-radius: 10px;
                font-size: 0.75rem;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    // ==========================================
    // VIEW PROCESSED PAYSLIP
    // ==========================================

    /**
     * View a processed (finalized) payslip
     * @param {string} payslipId - The payslip ID
     * @param {object} options - Display options
     * @param {boolean} options.essMode - If true, use ESS mode for calculation proof (hide organizational_overhead items and JSON tab)
     */
    async function viewProcessed(payslipId, options = {}) {
        try {
            injectStyles();
            ensureModalExists();
            currentPayslipId = payslipId;

            // Store ESS mode option for use in button onclick
            const isEssMode = options.essMode === true;

            const payslip = await api.request(`/hrms/payroll-processing/payslips/${payslipId}?includeItems=true`);

            const contentDiv = document.getElementById('payslipContent');
            if (!contentDiv) {
                showToast('Payslip modal not found', 'error');
                return;
            }

            // Currency setup
            const currencySymbol = payslip.currency_symbol || '₹';
            const currencyCode = payslip.currency_code || 'INR';
            const localeMap = { 'INR': 'en-IN', 'USD': 'en-US', 'GBP': 'en-GB', 'AED': 'ar-AE', 'IDR': 'id-ID', 'MVR': 'dv-MV' };
            const locale = localeMap[currencyCode] || 'en-IN';
            const fmtCurrency = (amt) => formatCurrency(amt, currencySymbol, locale);

            const items = payslip.items || [];
            const structureGroups = groupItemsByStructure(items);
            const hasMultipleStructures = structureGroups.length > 1;
            const isMultiLocation = payslip.is_multi_location || false;

            // Build structure breakdown HTML
            let structureBreakdownHtml = '';

            if (hasMultipleStructures) {
                // Multi-structure view
                structureBreakdownHtml = buildMultiStructureHtml(structureGroups, payslip, fmtCurrency);
            } else {
                // Single structure view
                const earnings = items.filter(i => i.component_type === 'earning');
                const deductions = items.filter(i => i.component_type === 'deduction');

                const earningsHtml = earnings.length > 0 ?
                    earnings.map(i => `
                        <tr>
                            <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                            <td class="text-right">${fmtCurrency(i.amount)}</td>
                            <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                        </tr>
                    `).join('') :
                    '<tr><td colspan="3" class="text-muted">No earnings</td></tr>';

                const deductionsHtml = deductions.length > 0 ?
                    deductions.map(i => {
                        const isEligible = i.is_eligible !== false;
                        const eligibilityIcon = i.amount === 0 && !isEligible ? '<span style="color:var(--color-warning);" title="Not eligible">⚠</span> ' : '';
                        const proratedTag = i.is_prorated ? ' <span style="font-size:0.75rem;color:var(--text-muted);">(prorated)</span>' : '';
                        return `
                            <tr>
                                <td>${eligibilityIcon}${i.component_name}${proratedTag}</td>
                                <td class="text-right">${fmtCurrency(i.amount)}</td>
                                <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                            </tr>
                        `;
                    }).join('') :
                    '<tr><td colspan="3" class="text-muted">No deductions</td></tr>';

                // Additional deductions
                let additionalDeductionsHtml = '';
                if (payslip.loan_deductions > 0) {
                    additionalDeductionsHtml += `<tr><td>Loan EMI</td><td class="text-right">${fmtCurrency(payslip.loan_deductions)}</td><td></td></tr>`;
                }
                if (payslip.voluntary_deductions > 0 && payslip.voluntary_deduction_items && payslip.voluntary_deduction_items.length > 0) {
                    additionalDeductionsHtml += payslip.voluntary_deduction_items.map(vd => `
                        <tr>
                            <td>${vd.deduction_type_name}${vd.is_prorated ? ` <span style="font-size:0.7rem;color:var(--text-muted);">(${vd.days_applicable || '-'}/${vd.total_days_in_period || '-'} days)</span>` : ''}</td>
                            <td class="text-right">${fmtCurrency(vd.deducted_amount)}</td>
                            <td class="text-right" style="color:var(--text-muted);font-size:0.85rem;">${vd.is_prorated ? `${(vd.proration_factor * 100).toFixed(0)}%` : ''}</td>
                        </tr>
                    `).join('');
                }

                structureBreakdownHtml = `
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                        <div>
                            <h5 style="margin: 0 0 0.75rem 0; color: var(--color-success);">Earnings</h5>
                            <table class="data-table" style="width: 100%;">
                                <thead>
                                    <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                        <th>Component</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">YTD</th>
                                    </tr>
                                </thead>
                                <tbody>${earningsHtml}</tbody>
                                <tfoot>
                                    <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                        <td>Total Gross</td>
                                        <td class="text-right">${fmtCurrency(payslip.gross_earnings)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div>
                            <h5 style="margin: 0 0 0.75rem 0; color: var(--color-danger);">Deductions</h5>
                            <table class="data-table" style="width: 100%;">
                                <thead>
                                    <tr style="font-size: 0.8rem; color: var(--text-muted);">
                                        <th>Component</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">YTD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deductionsHtml}
                                    ${additionalDeductionsHtml}
                                </tbody>
                                <tfoot>
                                    <tr style="font-weight: 600; border-top: 2px solid var(--border-color);">
                                        <td>Total Deductions</td>
                                        <td class="text-right">${fmtCurrency(payslip.total_deductions + (payslip.loan_deductions || 0) + (payslip.voluntary_deductions || 0))}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                `;
            }

            // Multi-location badge
            const multiLocationBadge = isMultiLocation
                ? `<span class="multi-location-badge" title="Employee worked at multiple locations">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    Multi-Location
                   </span>`
                : '';

            // Build the complete payslip HTML
            contentDiv.innerHTML = `
                <div class="payslip-header">
                    <div>
                        <h4 style="margin: 0 0 0.25rem 0; font-size: 1rem;">${payslip.employee_name || 'Employee'} ${multiLocationBadge}</h4>
                        <p style="margin: 0; color: var(--text-muted); font-size: 0.75rem;">Payslip - ${formatDate(payslip.pay_period_start)} to ${formatDate(payslip.pay_period_end)}</p>
                    </div>
                    <div style="padding: 0.5rem 1rem; background: var(--brand-primary); color: var(--text-inverse); border-radius: 6px; text-align: right;">
                        <div style="font-size: 0.65rem; opacity: 0.9;">Net Pay</div>
                        <div style="font-size: 1.1rem; font-weight: 700;">${fmtCurrency(payslip.net_pay)}</div>
                    </div>
                </div>

                <div class="payslip-summary">
                    <div class="summary-item">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Employee ID</div>
                        <div style="font-size: 0.9rem; font-weight: 600;">${payslip.employee_code || 'N/A'}</div>
                    </div>
                    <div class="summary-item">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Department</div>
                        <div style="font-size: 0.9rem; font-weight: 600;">${payslip.department_name || 'N/A'}</div>
                    </div>
                    <div class="summary-item">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Working Days</div>
                        <div style="font-size: 0.9rem; font-weight: 600;">${payslip.total_working_days || 0}</div>
                    </div>
                    <div class="summary-item">
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Days Worked</div>
                        <div style="font-size: 0.9rem; font-weight: 600;">${payslip.days_worked || 0}</div>
                    </div>
                </div>

                ${structureBreakdownHtml}

                <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--border-color); display: flex; justify-content: center;">
                    <button class="btn btn-secondary" onclick="${isEssMode ? `PayslipModal.viewCalculationProofEss('${payslipId}', false)` : `PayslipModal.viewCalculationProof('${payslipId}', false)`}" style="display: flex; align-items: center; gap: 0.5rem;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        View Calculation
                    </button>
                </div>
            `;

            openModal('payslipModal');
        } catch (error) {
            console.error('Error loading payslip:', error);
            showToast('Failed to load payslip', 'error');
        }
    }

    /**
     * Build multi-structure HTML for mid-period structure changes
     */
    function buildMultiStructureHtml(structureGroups, payslip, fmtCurrency) {
        let html = `
            <div style="margin-bottom: 1.5rem; padding: 0.75rem; background: var(--color-warning-light); border: 1px solid var(--color-warning); border-radius: 8px;">
                <strong class="text-warning-dark">Mid-Period Structure Change</strong>
                <p class="text-warning-dark" style="margin: 0.5rem 0 0 0; font-size: 0.85rem;">
                    This employee had a salary structure change during the pay period.
                    Components are shown separately for each structure for compliance purposes.
                </p>
            </div>
        `;

        for (const group of structureGroups) {
            const periodText = group.period_start && group.period_end
                ? `${formatDate(group.period_start)} - ${formatDate(group.period_end)}`
                : '';

            const groupEarnings = group.items.filter(i => i.component_type === 'earning');
            const groupDeductions = group.items.filter(i => i.component_type === 'deduction');

            const groupEarningsTotal = groupEarnings.reduce((sum, i) => sum + (i.amount || 0), 0);
            const groupDeductionsTotal = groupDeductions.reduce((sum, i) => sum + (i.amount || 0), 0);

            html += `
                <div style="margin-bottom: 1.5rem; padding: 1rem; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-subtle);">
                    <div style="margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-color);">
                        <h5 style="margin: 0; color: var(--brand-primary);">${group.structure_name || 'Salary Structure'}</h5>
                        ${periodText ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.8rem; color: var(--text-muted);">Period: ${periodText}</p>` : ''}
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div>
                            <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-success);">Earnings</h6>
                            <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                <thead>
                                    <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                        <th>Component</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">YTD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${groupEarnings.length > 0
                                        ? groupEarnings.map(i => `
                                            <tr>
                                                <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                            </tr>
                                        `).join('')
                                        : '<tr><td colspan="3" class="text-muted">No earnings</td></tr>'
                                    }
                                </tbody>
                                <tfoot>
                                    <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                        <td>Subtotal</td>
                                        <td class="text-right">${fmtCurrency(groupEarningsTotal)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div>
                            <h6 style="margin: 0 0 0.5rem 0; font-size: 0.85rem; color: var(--color-danger);">Deductions</h6>
                            <table class="data-table" style="width: 100%; font-size: 0.85rem;">
                                <thead>
                                    <tr style="font-size: 0.75rem; color: var(--text-muted);">
                                        <th>Component</th>
                                        <th class="text-right">Amount</th>
                                        <th class="text-right">YTD</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${groupDeductions.length > 0
                                        ? groupDeductions.map(i => `
                                            <tr>
                                                <td>${i.component_name}${i.is_prorated ? ' <span style="font-size:0.7rem;color:var(--text-muted);">(prorated)</span>' : ''}</td>
                                                <td class="text-right">${fmtCurrency(i.amount)}</td>
                                                <td class="text-right" style="color:var(--text-muted);font-size:0.8rem;">${fmtCurrency(i.ytd_amount || 0)}</td>
                                            </tr>
                                        `).join('')
                                        : '<tr><td colspan="3" class="text-muted">No deductions</td></tr>'
                                    }
                                </tbody>
                                <tfoot>
                                    <tr style="font-weight: 600; border-top: 1px solid var(--border-color);">
                                        <td>Subtotal</td>
                                        <td class="text-right">${fmtCurrency(groupDeductionsTotal)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }

        // Combined totals
        html += `
            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-card, #ffffff); border-radius: 8px; border: 2px solid var(--border-color);">
                <h5 style="margin: 0 0 1rem 0;">Combined Totals</h5>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                            <span>Total Gross Earnings</span>
                            <span style="font-weight: 600; color: var(--color-success);">${fmtCurrency(payslip.gross_earnings)}</span>
                        </div>
                    </div>
                    <div>
                        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);">
                            <span>Total Deductions</span>
                            <span style="font-weight: 600; color: var(--color-danger);">${fmtCurrency(payslip.total_deductions)}</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; background: var(--bg-body, #f5f7fa); border-radius: 4px; padding-left: 0.5rem; padding-right: 0.5rem;">
                    <span style="font-weight: 700;">Net Pay</span>
                    <span style="font-weight: 700; color: var(--brand-primary); font-size: 1.1rem;">${fmtCurrency(payslip.net_pay)}</span>
                </div>
            </div>
        `;

        return html;
    }

    // ==========================================
    // CALCULATION PROOF
    // ==========================================

    /**
     * View calculation proof for a payslip
     * @param {string} payslipId - The payslip ID
     * @param {boolean} isDraft - Whether this is a draft payslip
     * @param {object} options - Display options
     * @param {boolean} options.essMode - If true, hide organizational_overhead items and JSON tab (for Employee Self-Service)
     */
    async function viewCalculationProof(payslipId, isDraft = false, options = {}) {
        try {
            injectCalculationProofStyles();

            // ESS mode: hide organizational overhead deductions and JSON tab
            const displayOptions = {
                hideOrganizationalOverhead: options.essMode === true,
                hideJsonTab: options.essMode === true,
                ...options
            };

            const endpoint = isDraft
                ? `/hrms/payroll-drafts/payslips/${payslipId}/calculation-proof?format=json`
                : `/hrms/payroll-processing/payslips/${payslipId}/calculation-proof?format=json`;

            const response = await api.request(endpoint);

            if (!response || !response.calculation_proof_data) {
                showToast('Calculation proof not available for this payslip.', 'warning');
                return;
            }

            // Close payslip modal first
            closeModal('payslipModal');

            const proof = response.calculation_proof_data;

            // Store for download/print
            window.currentCalculationProof = {
                payslipId: payslipId,
                proof: proof,
                employeeName: response.employee_name,
                employeeCode: response.employee_code,
                payPeriod: `${formatDate(response.pay_period_start)} - ${formatDate(response.pay_period_end)}`,
                isProcessed: !isDraft
            };

            // Create or get the calculation proof modal
            let modal = document.getElementById('calculationProofModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'calculationProofModal';
                modal.className = 'modal';
                document.body.appendChild(modal);
            }

            // Build the UI with display options
            modal.innerHTML = buildCalculationProofUI(proof, response, displayOptions);

            // Open the modal
            modal.classList.add('active');

        } catch (error) {
            console.error('Error loading calculation proof:', error);
            showToast(error.message || 'Failed to load calculation proof', 'error');
        }
    }

    /**
     * Build the calculation proof UI - comprehensive version matching payroll.js
     * @param {object} proof - The calculation proof data
     * @param {object} response - The API response with employee info
     * @param {object} displayOptions - Display options for ESS vs Payroll mode
     * @param {boolean} displayOptions.hideOrganizationalOverhead - Hide items with employerPortion='organizational_overhead'
     * @param {boolean} displayOptions.hideJsonTab - Hide the JSON Data tab
     */
    function buildCalculationProofUI(proof, response, displayOptions = {}) {
        const currencySymbol = proof.currencySymbol || '₹';
        const fmt = (amount) => `${currencySymbol} ${(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const pct = (value) => `${(value || 0).toFixed(2)}%`;

        const jsonString = JSON.stringify(proof, null, 2);

        // Conditionally show/hide JSON tab based on displayOptions
        const jsonTabButton = displayOptions.hideJsonTab ? '' : `
                            <button class="proof-tab" onclick="PayslipModal.switchProofTab('json')">
                                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                                </svg>
                                JSON Data
                            </button>`;

        return `
            <div class="modal-dialog modal-dialog-centered" style="max-width: 1100px; width: 95%;">
                <div class="modal-content" style="max-width: 100%; width: 100%;">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="margin-right: 8px; vertical-align: middle;">
                                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                            </svg>
                            Calculation - ${proof.employeeName || response.employee_name} (${proof.employeeCode || response.employee_code})
                        </h5>
                        <button class="close-btn" onclick="PayslipModal.closeProof()">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body proof-modal-body">
                        <!-- Tabs Navigation -->
                        <div class="proof-tabs">
                            <button class="proof-tab active" onclick="PayslipModal.switchProofTab('formatted')">
                                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                    <path d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                                </svg>
                                Formatted View
                            </button>
                            ${jsonTabButton}
                            <div class="proof-tab-actions">
                                <button class="btn btn-secondary btn-sm" onclick="PayslipModal.downloadCalculationProof()">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                                    </svg>
                                    Download
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="PayslipModal.printCalculationProof()">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/>
                                    </svg>
                                    Print
                                </button>
                            </div>
                        </div>

                        <!-- Tab Content: Formatted View -->
                        <div class="proof-tab-content" id="proofTabFormatted">
                            <!-- Summary Cards Row -->
                            <div class="proof-summary-row">
                                <div class="proof-summary-card earnings">
                                    <div class="summary-label">Gross Earnings</div>
                                    <div class="summary-value">${fmt(proof.grossEarnings)}</div>
                                </div>
                                <div class="proof-summary-card deductions">
                                    <div class="summary-label">Total Deductions</div>
                                    <div class="summary-value">${fmt(proof.totalDeductions)}</div>
                                </div>
                                <div class="proof-summary-card net-pay">
                                    <div class="summary-label">Net Pay</div>
                                    <div class="summary-value">${fmt(proof.netPay)}</div>
                                </div>
                            </div>

                            <!-- Employee & Pay Period Info -->
                            <div class="proof-section-grid">
                                <div class="proof-card">
                                    <div class="proof-card-header">
                                        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                                        </svg>
                                        <span>Employee Information</span>
                                    </div>
                                    <div class="proof-card-body">
                                        <div class="cp-info-grid">
                                            <div class="cp-info-item">
                                                <span class="info-label">Name</span>
                                                <span class="info-value">${proof.employeeName || '-'}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Employee Code</span>
                                                <span class="info-value">${proof.employeeCode || '-'}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Department</span>
                                                <span class="info-value">${proof.departmentName || '-'}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Designation</span>
                                                <span class="info-value">${proof.designationName || '-'}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Office</span>
                                                <span class="info-value">${proof.officeName || '-'} (${proof.officeCode || '-'})</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Location</span>
                                                <span class="info-value">${proof.stateName || '-'}, ${proof.countryName || proof.countryCode || '-'}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="proof-card">
                                    <div class="proof-card-header">
                                        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                            <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                                        </svg>
                                        <span>Pay Period Details</span>
                                    </div>
                                    <div class="proof-card-body">
                                        <div class="cp-info-grid">
                                            <div class="cp-info-item">
                                                <span class="info-label">Pay Period</span>
                                                <span class="info-value">${formatDate(proof.payPeriodStart)} - ${formatDate(proof.payPeriodEnd)}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Financial Year</span>
                                                <span class="info-value">${proof.financialYear || '-'}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Total Working Days</span>
                                                <span class="info-value">${proof.totalWorkingDays || 0}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Days Worked</span>
                                                <span class="info-value">${proof.daysWorked || 0}</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">Proration Factor</span>
                                                <span class="info-value">${((proof.proratedFactor || 1) * 100).toFixed(2)}%</span>
                                            </div>
                                            <div class="cp-info-item">
                                                <span class="info-label">LOP Days</span>
                                                <span class="info-value ${(proof.lopDays || 0) > 0 ? 'text-warning' : ''}">${proof.lopDays || 0}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Compensation Card -->
                            <div class="proof-card">
                                <div class="proof-card-header">
                                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                    </svg>
                                    <span>Compensation Details</span>
                                </div>
                                <div class="proof-card-body">
                                    <div class="compensation-grid">
                                        <div class="comp-item">
                                            <span class="comp-label">Annual CTC</span>
                                            <span class="comp-value">${fmt(proof.annualCTC)}</span>
                                        </div>
                                        <div class="comp-item">
                                            <span class="comp-label">Monthly CTC</span>
                                            <span class="comp-value">${fmt(proof.monthlyCTC)}</span>
                                        </div>
                                        <div class="comp-item">
                                            <span class="comp-label">Salary Structure</span>
                                            <span class="comp-value">${proof.salaryStructureName || '-'}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Version Timeline Section -->
                            ${buildVersionTimelineSection(proof, fmt)}

                            <!-- Earnings Table -->
                            ${buildEarningsSection(proof, fmt)}

                            <!-- Deductions Table -->
                            ${buildDeductionsSection(proof, fmt, displayOptions)}

                            <!-- Voluntary Deductions Section -->
                            ${buildVoluntaryDeductionsSection(proof, fmt)}

                            <!-- Adjustments Section -->
                            ${buildAdjustmentsSection(proof, fmt)}

                            <!-- Arrears Lifecycle Audit Section - v3.0.114 -->
                            ${buildArrearsLifecycleSection(proof, fmt)}

                            <!-- Tax Calculation Section -->
                            ${buildTaxCalculationSection(proof, fmt, pct)}

                            <!-- Employer Contributions -->
                            ${buildEmployerContributionsSection(proof, fmt, displayOptions)}

                            <!-- Location Breakdown Section -->
                            ${buildLocationBreakdownSection(proof, fmt)}

                            <!-- Verification & Footer -->
                            <div class="proof-card verification-card">
                                <div class="proof-card-header">
                                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                                    </svg>
                                    <span>Verification Summary</span>
                                </div>
                                <div class="proof-card-body">
                                    <div class="verification-grid">
                                        <div class="verification-item">
                                            <span class="verification-label">Gross Earnings</span>
                                            <span class="verification-value">${fmt(proof.grossEarnings)}</span>
                                        </div>
                                        <div class="verification-item">
                                            <span class="verification-label">Total Deductions</span>
                                            <span class="verification-value">${fmt(proof.totalDeductions)}</span>
                                        </div>
                                        <div class="verification-item highlight">
                                            <span class="verification-label">Net Pay (Gross - Deductions)</span>
                                            <span class="verification-value">${fmt(proof.netPay)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Footer -->
                            <div class="proof-footer">
                                <div class="footer-info">
                                    <span>Generated: ${new Date(proof.generatedAt || Date.now()).toLocaleString()}</span>
                                    <span>•</span>
                                    <span>Ragenaizer HRMS ${proof.taxCalculation?.engineVersion || 'v3.0'}</span>
                                    ${proof.countryConfigVersion ? `<span>•</span><span>Config: ${proof.countryConfigVersion}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <!-- Tab Content: JSON Data -->
                        <div class="proof-tab-content" id="proofTabJson" style="display: none;">
                            <div class="json-toolbar">
                                <button class="btn btn-secondary btn-sm" onclick="PayslipModal.copyProofJson()">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/>
                                    </svg>
                                    Copy JSON
                                </button>
                                <button class="btn btn-secondary btn-sm" onclick="PayslipModal.downloadProofJson()">
                                    <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                                    </svg>
                                    Download JSON
                                </button>
                            </div>
                            <pre class="json-viewer" id="proofJsonViewer">${escapeHtml(jsonString)}</pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Build earnings section - comprehensive version matching payroll.js
     * v3.0.58: Support multi-location earnings with location grouping
     */
    function buildEarningsSection(proof, fmt) {
        const items = proof.earningsItems || [];
        if (items.length === 0) return '';

        // v3.0.58: Check if this is a multi-location payslip (any item has officeCode)
        const hasLocationData = items.some(item => item.officeCode);
        console.log('[buildEarningsSection] hasLocationData:', hasLocationData, 'items:', items.length, 'first item officeCode:', items[0]?.officeCode);
        let rows = '';

        if (hasLocationData) {
            // Group items by officeCode for multi-location display
            const groupedByOffice = {};
            items.forEach(item => {
                const officeKey = item.officeCode || 'UNKNOWN';
                if (!groupedByOffice[officeKey]) {
                    groupedByOffice[officeKey] = {
                        officeName: item.officeName || item.officeCode || 'Unknown Office',
                        officeCode: item.officeCode,
                        locationWorkedDays: item.locationWorkedDays,
                        totalMonthWorkingDays: item.totalMonthWorkingDays,
                        proratedFactor: item.proratedFactor,
                        items: []
                    };
                }
                groupedByOffice[officeKey].items.push(item);
            });

            // Generate rows with location headers
            Object.values(groupedByOffice).forEach(group => {
                // Location header row
                const daysInfo = group.locationWorkedDays && group.totalMonthWorkingDays
                    ? `${group.locationWorkedDays} of ${group.totalMonthWorkingDays} days`
                    : '';
                const prorateInfo = group.proratedFactor
                    ? `(${(group.proratedFactor * 100).toFixed(1)}%)`
                    : '';
                const locationSubtotal = group.items.reduce((sum, i) => sum + (i.amount || 0), 0);

                rows += `
                    <tr class="location-header-row">
                        <td colspan="3">
                            <div class="location-header">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                    <circle cx="12" cy="10" r="3"></circle>
                                </svg>
                                <span class="location-name">${group.officeName}</span>
                                <span class="location-days">${daysInfo} ${prorateInfo}</span>
                            </div>
                        </td>
                        <td class="text-right location-subtotal">${fmt(locationSubtotal)}</td>
                    </tr>
                `;

                // Component rows for this location
                group.items.forEach(item => {
                    rows += `
                        <tr class="location-item-row">
                            <td class="component-name" style="padding-left: 24px;">${item.componentName || item.componentCode || '-'}</td>
                            <td class="text-right">${fmt(item.baseAmount || item.amount)}</td>
                            <td class="text-center">${item.isProrated ? `${(item.proratedFactor * 100).toFixed(1)}%` : '100%'}</td>
                            <td class="text-right amount-cell">${fmt(item.amount)}</td>
                        </tr>
                    `;
                });
            });
        } else {
            // Single location - flat list as before
            rows = items.map(item => `
                <tr>
                    <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
                    <td class="text-right">${fmt(item.baseAmount || item.amount)}</td>
                    <td class="text-center">${item.isProrated ? `${(item.proratedFactor * 100).toFixed(1)}%` : '100%'}</td>
                    <td class="text-right amount-cell">${fmt(item.amount)}</td>
                </tr>
            `).join('');
        }

        return `
            <div class="proof-card">
                <div class="proof-card-header earnings-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>
                    </svg>
                    <span>Earnings Breakdown</span>
                    <span class="header-badge earnings-badge">${fmt(proof.grossEarnings)}</span>
                </div>
                <div class="proof-card-body">
                    <table class="proof-table">
                        <thead>
                            <tr>
                                <th>Component</th>
                                <th class="text-right">Base Amount</th>
                                <th class="text-center">Proration</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="3"><strong>Total Gross Earnings</strong></td>
                                <td class="text-right"><strong>${fmt(proof.grossEarnings)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Build deductions section - comprehensive version matching payroll.js
     * @param {object} proof - The calculation proof data
     * @param {function} fmt - Currency formatting function
     * @param {object} displayOptions - Display options (not used for deductions - employee deductions are always shown)
     */
    function buildDeductionsSection(proof, fmt, displayOptions = {}) {
        let items = proof.deductionItems || [];
        if (items.length === 0) return '';

        // NOTE: Employee deductions are ALWAYS shown, even in ESS mode.
        // The `employerPortion` field describes the EMPLOYER's contribution classification,
        // not the employee deduction. Employee deductions directly affect take-home pay
        // and should always be visible to employees.
        //
        // Only employer contributions are filtered based on employerPortion in ESS mode
        // (see buildEmployerContributionsSection)

        // Calculate total (no filtering for deductions)
        const visibleTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);

        let rows = items.map(item => {
            const isEligible = item.isEligible !== false;
            const eligibilityClass = isEligible ? '' : 'not-eligible';
            const eligibilityIcon = isEligible ? '✓' : '✗';
            const eligibilityReason = item.eligibilityReason || '';

            const componentName = item.componentName || item.componentCode || '-';
            const jurisdictionLabel = item.jurisdictionName
                ? `<span class="jurisdiction-label">(${item.jurisdictionName})</span>`
                : '';

            return `
                <tr class="${eligibilityClass}">
                    <td class="component-name">
                        ${componentName}
                        ${jurisdictionLabel}
                        ${eligibilityReason ? `<span class="eligibility-reason" title="${eligibilityReason}">ℹ</span>` : ''}
                    </td>
                    <td class="text-center">
                        <span class="eligibility-badge ${isEligible ? 'eligible' : 'not-eligible'}">${eligibilityIcon}</span>
                    </td>
                    <td class="text-right amount-cell">${fmt(item.amount)}</td>
                </tr>
            `;
        }).join('');

        // Always use the original total - deductions are never filtered
        const displayTotal = proof.totalDeductions;

        return `
            <div class="proof-card">
                <div class="proof-card-header deductions-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Deductions Breakdown</span>
                    <span class="header-badge deductions-badge">${fmt(displayTotal)}</span>
                </div>
                <div class="proof-card-body">
                    <table class="proof-table">
                        <thead>
                            <tr>
                                <th>Component</th>
                                <th class="text-center">Eligible</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="2"><strong>Total Deductions</strong></td>
                                <td class="text-right"><strong>${fmt(displayTotal)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Build voluntary deductions section
     */
    function buildVoluntaryDeductionsSection(proof, fmt) {
        const items = proof.voluntaryDeductionItems || [];
        if (items.length === 0) return '';

        let rows = items.map(item => {
            const isProrated = item.isProrated === true;
            const proratedBadge = isProrated
                ? `<span class="proration-badge">${(item.proratedFactor * 100).toFixed(0)}%</span>`
                : '';

            return `
                <tr>
                    <td class="component-name">
                        ${item.deductionTypeName || '-'}
                        ${proratedBadge}
                    </td>
                    <td class="text-center">${item.category || 'Other'}</td>
                    <td class="text-right amount-cell">${fmt(item.fullAmount)}</td>
                    <td class="text-right amount-cell ${isProrated ? 'prorated' : ''}">${fmt(item.deductedAmount)}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="proof-card">
                <div class="proof-card-header voluntary-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                    </svg>
                    <span>Voluntary Deductions</span>
                    <span class="header-badge voluntary-badge">${fmt(proof.totalVoluntaryDeductions)}</span>
                </div>
                <div class="proof-card-body">
                    <p class="section-description">Employee-elected deductions (insurance, savings, etc.)</p>
                    <table class="proof-table">
                        <thead>
                            <tr>
                                <th>Deduction Type</th>
                                <th class="text-center">Category</th>
                                <th class="text-right">Full Amount</th>
                                <th class="text-right">Deducted</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="3"><strong>Total Voluntary Deductions</strong></td>
                                <td class="text-right"><strong>${fmt(proof.totalVoluntaryDeductions)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Build adjustments section
     */
    function buildAdjustmentsSection(proof, fmt) {
        const items = proof.adjustmentItems || [];
        if (items.length === 0) return '';

        const additions = items.filter(item => item.isAddition !== false);
        const deductions = items.filter(item => item.isAddition === false);

        const totalAdditions = proof.totalAdjustmentsAddition || 0;
        const totalDeductions = proof.totalAdjustmentsDeduction || 0;
        const netAdjustment = totalAdditions - totalDeductions;
        const netClass = netAdjustment >= 0 ? 'addition-amount' : 'deduction-amount';
        const netSign = netAdjustment >= 0 ? '+' : '';

        let additionRows = additions.length > 0
            ? additions.map(item => `
                <tr>
                    <td class="component-name">
                        <span class="adjustment-type addition">${item.displayType || item.adjustmentType || 'Adjustment'}</span>
                    </td>
                    <td class="text-left adjustment-reason">${item.reason || '-'}</td>
                    <td class="text-right amount-cell addition-amount">+${fmt(item.amount)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="3" class="text-center text-muted">No additional earnings</td></tr>';

        let deductionRows = deductions.length > 0
            ? deductions.map(item => `
                <tr>
                    <td class="component-name">
                        <span class="adjustment-type deduction">${item.displayType || item.adjustmentType || 'Adjustment'}</span>
                    </td>
                    <td class="text-left adjustment-reason">${item.reason || '-'}</td>
                    <td class="text-right amount-cell deduction-amount">-${fmt(item.amount)}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="3" class="text-center text-muted">No additional deductions</td></tr>';

        return `
            <div class="proof-card">
                <div class="proof-card-header adjustments-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"/>
                    </svg>
                    <span>Adjustments</span>
                    <span class="header-badge ${netAdjustment >= 0 ? 'earnings-badge' : 'deductions-badge'}">${netSign}${fmt(Math.abs(netAdjustment))}</span>
                </div>
                <div class="proof-card-body">
                    <p class="section-description">One-time adjustments for this pay period (bonus, reimbursement, incentive, recovery)</p>

                    <div class="adjustments-subsection">
                        <h6 class="subsection-title additions-title">Additional Earnings</h6>
                        <table class="proof-table adjustments-table">
                            <thead><tr><th>Type</th><th>Reason</th><th class="text-right">Amount</th></tr></thead>
                            <tbody>${additionRows}</tbody>
                        </table>
                    </div>

                    <div class="adjustments-subsection" style="margin-top: 1rem;">
                        <h6 class="subsection-title deductions-title">Additional Deductions</h6>
                        <table class="proof-table adjustments-table">
                            <thead><tr><th>Type</th><th>Reason</th><th class="text-right">Amount</th></tr></thead>
                            <tbody>${deductionRows}</tbody>
                        </table>
                    </div>

                    <div class="adjustment-net-impact" style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-body, #f5f7fa); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 500;">Net Impact from Adjustments</span>
                        <span class="${netClass}" style="font-size: 1.1rem; font-weight: 600;">${netSign}${fmt(Math.abs(netAdjustment))}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Build arrears lifecycle section - v3.0.114
     * Shows the full audit trail of retro salary revisions with chain collapsing explanation
     * @param {object} proof - The calculation proof data
     * @param {function} fmt - Currency formatting function
     */
    function buildArrearsLifecycleSection(proof, fmt) {
        const audit = proof.arrearsLifecycleAudit;

        // Only show if there are arrears records
        if (!audit || !audit.totalArrearsRecords || audit.totalArrearsRecords === 0) {
            return '';
        }

        // Build summary banner
        const summaryBanner = audit.explanationSummary ? `
            <div class="arrears-summary-banner">
                <p class="arrears-summary-text">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="vertical-align: middle; margin-right: 0.5rem;">
                        <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    ${escapeHtml(audit.explanationSummary)}
                </p>
            </div>
        ` : '';

        // Build chain collapsing alert if applicable
        const chainAlert = audit.hasChainCollapsing ? `
            <div class="arrears-chain-alert">
                <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                </svg>
                <div class="chain-text">
                    <strong>Retro Chain Collapsing Active:</strong> ${escapeHtml(audit.chainCollapsingNote || 'Multiple retrospective revisions detected for the same period. Only the latest revision per month is paid; earlier revisions are superseded.')}
                </div>
            </div>
        ` : '';

        // Build individual record cards
        let recordsHtml = '';
        const records = audit.allRecords || [];

        if (records.length > 0) {
            // Sort records: applied first, then superseded, then by period
            const sortedRecords = [...records].sort((a, b) => {
                if (a.status === 'applied' && b.status !== 'applied') return -1;
                if (a.status !== 'applied' && b.status === 'applied') return 1;
                return (a.payrollPeriod || '').localeCompare(b.payrollPeriod || '');
            });

            const recordCards = sortedRecords.map(record => {
                const isApplied = record.status === 'applied';
                const statusClass = isApplied ? 'status-applied' : 'status-superseded';
                const badgeClass = isApplied ? 'applied' : 'superseded';
                const badgeIcon = isApplied
                    ? '<svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>'
                    : '<svg width="10" height="10" fill="currentColor" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>';

                // Format CTC values
                const oldCtcL = record.oldCtc ? `₹${(record.oldCtc / 100000).toFixed(1)}L` : '-';
                const newCtcL = record.newCtc ? `₹${(record.newCtc / 100000).toFixed(1)}L` : '-';

                // Determine amount display
                const amount = record.arrearsAmount || 0;
                const amountClass = isApplied ? (amount >= 0 ? 'positive' : 'negative') : 'zero';
                const amountPrefix = isApplied ? (amount >= 0 ? '+' : '') : '';
                const amountDisplay = isApplied ? `${amountPrefix}${fmt(amount)}` : fmt(amount);

                return `
                    <div class="arrears-record ${statusClass}">
                        <div class="arrears-record-status">
                            <span class="status-badge ${badgeClass}">
                                ${badgeIcon}
                                ${isApplied ? 'Paid' : 'Superseded'}
                            </span>
                        </div>
                        <div class="arrears-record-details">
                            <div class="arrears-record-header">
                                <span class="arrears-period">${escapeHtml(record.payrollPeriod || 'Unknown Period')}</span>
                                <span class="arrears-amount ${amountClass}">${amountDisplay}</span>
                            </div>
                            <div class="arrears-ctc-change">
                                CTC: ${oldCtcL}<span class="ctc-arrow">→</span>${newCtcL}
                            </div>
                            ${record.note ? `<div class="arrears-note">${escapeHtml(record.note)}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            recordsHtml = `
                <div class="arrears-records-title">
                    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                    </svg>
                    All Revision Records (${records.length} total)
                </div>
                ${recordCards}
            `;
        }

        // Build stats row
        const statsRow = `
            <div class="arrears-stats-row">
                <div class="arrears-stat">
                    <span class="arrears-stat-label">Total Records:</span>
                    <span class="arrears-stat-value">${audit.totalArrearsRecords || 0}</span>
                </div>
                <div class="arrears-stat">
                    <span class="arrears-stat-label">Applied:</span>
                    <span class="arrears-stat-value applied">${audit.appliedArrearsCount || audit.appliedInThisPayslipCount || 0}</span>
                </div>
                ${audit.supersededArrearsCount > 0 ? `
                    <div class="arrears-stat">
                        <span class="arrears-stat-label">Superseded:</span>
                        <span class="arrears-stat-value superseded">${audit.supersededArrearsCount}</span>
                    </div>
                ` : ''}
                ${audit.appliedInThisPayslipAmount ? `
                    <div class="arrears-stat">
                        <span class="arrears-stat-label">Total Paid:</span>
                        <span class="arrears-stat-value applied">${fmt(audit.appliedInThisPayslipAmount)}</span>
                    </div>
                ` : ''}
            </div>
        `;

        return `
            <div class="proof-card arrears-lifecycle-card">
                <div class="proof-card-header arrears-lifecycle-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Arrears Lifecycle Audit</span>
                    ${audit.hasChainCollapsing ? '<span class="header-badge" style="background: var(--color-info); color: var(--text-inverse);">Chain Collapsed</span>' : ''}
                </div>
                <div class="proof-card-body">
                    ${summaryBanner}
                    ${chainAlert}
                    ${recordsHtml}
                    ${statsRow}
                </div>
            </div>
        `;
    }

    /**
     * Build tax calculation section - comprehensive version matching payroll.js
     */
    function buildTaxCalculationSection(proof, fmt, pct) {
        const tax = proof.taxCalculation;
        if (!tax) return '';

        // Build slab breakdown rows
        let slabRows = '';
        if (tax.slabBreakdown?.slabs) {
            slabRows = tax.slabBreakdown.slabs.map(slab => `
                <tr>
                    <td>${fmt(slab.fromAmount)} - ${slab.toAmount == null || slab.toAmount >= 99999999 ? '∞' : fmt(slab.toAmount)}</td>
                    <td class="text-center">${pct(slab.rate)}</td>
                    <td class="text-right">${fmt(slab.taxableAmountInSlab)}</td>
                    <td class="text-right">${fmt(slab.taxAmount)}</td>
                </tr>
            `).join('');
        }

        // Build pre-tax deductions section
        let preTaxSection = '';
        if (tax.preTaxDeductionItems && tax.preTaxDeductionItems.length > 0) {
            const preTaxRows = tax.preTaxDeductionItems.map(item => `
                <div class="pretax-item">
                    <span class="pretax-name">${item.chargeName || item.chargeCode}</span>
                    <span class="pretax-amount">${fmt(item.annualAmount)}</span>
                </div>
            `).join('');
            preTaxSection = `
                <div class="pretax-section">
                    <div class="pretax-title">Pre-Tax Deductions (Annual)</div>
                    ${preTaxRows}
                    <div class="pretax-item pretax-total">
                        <span class="pretax-name">Total Pre-Tax Deductions</span>
                        <span class="pretax-amount">${fmt(tax.preTaxDeductions)}</span>
                    </div>
                </div>
            `;
        }

        // v3.0.128: Build Declaration Validation Section (80C, 80D, etc.)
        let declarationSection = '';
        if (tax.declarationValidation && tax.declarationValidation.sections) {
            const sectionsWithItems = tax.declarationValidation.sections.filter(
                section => section.items && section.items.length > 0
            );

            if (sectionsWithItems.length > 0) {
                let sectionsHtml = sectionsWithItems.map(section => {
                    // Build items for this section
                    const itemsHtml = section.items.map(item => {
                        const cappedNote = item.wasCapped
                            ? `<span class="declaration-capped-badge" title="Capped at ${fmt(item.itemMaxLimit)}">Capped</span>`
                            : '';
                        return `
                            <div class="declaration-item">
                                <span class="declaration-item-name">${item.itemName || item.itemCode}</span>
                                <span class="declaration-item-declared">${fmt(item.declaredAmount)}</span>
                                <span class="declaration-item-allowed">${fmt(item.allowedAmount)} ${cappedNote}</span>
                            </div>
                        `;
                    }).join('');

                    // Section summary
                    const sectionCapped = section.excessAmount > 0
                        ? `<span class="declaration-section-capped">Excess: ${fmt(section.excessAmount)} (capped at ${fmt(section.sectionMaxLimit)})</span>`
                        : '';

                    return `
                        <div class="declaration-section-group">
                            <div class="declaration-section-header">
                                <span class="declaration-section-name">${section.sectionName}</span>
                                <span class="declaration-section-code">${section.sectionCode}</span>
                            </div>
                            <div class="declaration-items-header">
                                <span>Item</span>
                                <span>Declared</span>
                                <span>Allowed</span>
                            </div>
                            ${itemsHtml}
                            <div class="declaration-section-total">
                                <span>Section Total</span>
                                <span>${fmt(section.declaredTotal)}</span>
                                <span>${fmt(section.allowedTotal)}</span>
                            </div>
                            ${sectionCapped}
                        </div>
                    `;
                }).join('');

                // Warnings if any
                let warningsHtml = '';
                if (tax.declarationValidation.validationWarnings && tax.declarationValidation.validationWarnings.length > 0) {
                    warningsHtml = `
                        <div class="declaration-warnings">
                            <div class="declaration-warning-title">⚠️ Declaration Notes</div>
                            ${tax.declarationValidation.validationWarnings.map(w => `
                                <div class="declaration-warning-item">${w}</div>
                            `).join('')}
                        </div>
                    `;
                }

                declarationSection = `
                    <div class="declaration-validation-section">
                        <div class="declaration-title">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            Tax Saving Declarations (${tax.declarationValidation.taxRegimeUsed === 'old_regime' ? 'Old Regime' : 'New Regime'})
                        </div>
                        <div class="declaration-subtitle">
                            Total Allowed: ${fmt(tax.declarationValidation.totalAllowedDeductions || tax.declarationDeductions)}
                        </div>
                        ${sectionsHtml}
                        ${warningsHtml}
                    </div>
                `;
            }
        }

        return `
            <div class="proof-card tax-card">
                <div class="proof-card-header tax-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                    </svg>
                    <span>Income Tax Calculation</span>
                    <span class="header-badge tax-badge">${fmt(tax.monthlyTDS || tax.proratedTDS)}/mo</span>
                </div>
                <div class="proof-card-body">
                    <!-- Tax Regime -->
                    <div class="tax-regime-banner">
                        <span class="regime-label">Tax Regime:</span>
                        <span class="regime-value">${tax.taxRegime || 'New'} Regime</span>
                        ${tax.taxRegimeLegalSection ? `<span class="regime-section">(${tax.taxRegimeLegalSection})</span>` : ''}
                    </div>

                    <!-- Tax Calculation Flow -->
                    <div class="tax-flow">
                        <div class="tax-flow-item">
                            <span class="flow-label">Annual Gross</span>
                            <span class="flow-value">${fmt(tax.annualGross)}</span>
                        </div>
                        <div class="tax-flow-operator">−</div>
                        <div class="tax-flow-item">
                            <span class="flow-label">Standard Deduction</span>
                            <span class="flow-value">${fmt(tax.standardDeduction)}</span>
                        </div>
                        ${tax.preTaxDeductions > 0 ? `
                            <div class="tax-flow-operator">−</div>
                            <div class="tax-flow-item">
                                <span class="flow-label">Pre-Tax Deductions</span>
                                <span class="flow-value">${fmt(tax.preTaxDeductions)}</span>
                            </div>
                        ` : ''}
                        <div class="tax-flow-operator">=</div>
                        <div class="tax-flow-item result">
                            <span class="flow-label">Taxable Income</span>
                            <span class="flow-value">${fmt(tax.taxableIncome)}</span>
                        </div>
                    </div>

                    ${preTaxSection}

                    ${declarationSection}

                    <!-- Slab Breakdown -->
                    ${slabRows ? `
                        <div class="slab-section">
                            <h4 class="slab-title">Tax Slab Breakdown</h4>
                            <table class="proof-table slab-table">
                                <thead>
                                    <tr>
                                        <th>Slab Range</th>
                                        <th class="text-center">Rate</th>
                                        <th class="text-right">Taxable</th>
                                        <th class="text-right">Tax</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${slabRows}
                                </tbody>
                                <tfoot>
                                    <tr class="total-row">
                                        <td colspan="3"><strong>Tax from Slabs</strong></td>
                                        <td class="text-right"><strong>${fmt(tax.slabBreakdown?.totalTaxFromSlabs || tax.taxBeforeRebate)}</strong></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    ` : ''}

                    <!-- Rebate Section -->
                    ${tax.rebate ? `
                        <div class="rebate-section ${tax.rebate.isApplicable ? 'applicable' : 'not-applicable'}">
                            <div class="rebate-header">
                                <span class="rebate-icon">${tax.rebate.isApplicable ? '✓' : '✗'}</span>
                                <span class="rebate-title">${tax.rebate.section || 'Tax Rebate'}</span>
                            </div>
                            <div class="rebate-details">
                                <span>Threshold: ${fmt(tax.rebate.incomeThreshold)} | Max Rebate: ${fmt(tax.rebate.maxRebate)}</span>
                                ${tax.rebate.isApplicable ? `<span class="rebate-amount">Applied: ${fmt(tax.rebate.actualRebate)}</span>` : ''}
                            </div>
                            ${tax.rebate.reason ? `<div class="rebate-reason">${tax.rebate.reason}</div>` : ''}
                        </div>
                    ` : ''}

                    <!-- Marginal Relief Section (Finance Bill 2025) -->
                    ${tax.rebate?.marginalReliefApplied ? `
                        <div class="marginal-relief-section applicable">
                            <div class="rebate-header">
                                <span class="rebate-icon">✓</span>
                                <span class="rebate-title">Marginal Relief (Finance Bill 2025)</span>
                            </div>
                            <div class="rebate-details">
                                <span>Cutoff Income: ${fmt(tax.rebate.reliefCutoffIncome || 1275000)} | Applies between ₹12L - ₹12.75L</span>
                            </div>
                            <div class="marginal-relief-calculation">
                                <div class="relief-line">
                                    <span>Tax from Slabs:</span>
                                    <span>${fmt(tax.taxAfterRebate)}</span>
                                </div>
                                <div class="relief-line">
                                    <span>Excess over ₹12L threshold:</span>
                                    <span>${fmt(tax.rebate.actualTaxableIncome - 1200000)}</span>
                                </div>
                                <div class="relief-line highlight">
                                    <span>Tax Capped at Excess Amount:</span>
                                    <span>${fmt(Math.min(tax.taxAfterRebate, tax.rebate.actualTaxableIncome - 1200000))}</span>
                                </div>
                                <div class="relief-line savings">
                                    <span>Tax Savings from Marginal Relief:</span>
                                    <span class="savings-amount">- ${fmt(tax.rebate.marginalReliefAmount || (tax.taxAfterRebate - (tax.rebate.actualTaxableIncome - 1200000)))}</span>
                                </div>
                            </div>
                            <div class="rebate-reason">
                                ${tax.rebate.marginalReliefAlgorithm || 'For incomes slightly above ₹12L, tax is capped at the excess over ₹12L to prevent tax exceeding income increase.'}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Final Tax Calculation -->
                    <div class="tax-final">
                        <div class="tax-line">
                            <span>Tax After Rebate${tax.rebate?.marginalReliefApplied ? ' & Marginal Relief' : ''}</span>
                            <span>${fmt(tax.rebate?.marginalReliefApplied ? Math.min(tax.taxAfterRebate, tax.rebate.actualTaxableIncome - 1200000) : tax.taxAfterRebate)}</span>
                        </div>
                        ${tax.surchargeAmount > 0 ? `
                            <div class="tax-line">
                                <span>${tax.surchargeName || 'Surcharge'} (${pct(tax.surchargePercentage)})</span>
                                <span>+ ${fmt(tax.surchargeAmount)}</span>
                            </div>
                        ` : ''}
                        ${tax.cessAmount > 0 ? `
                            <div class="tax-line ${tax.rebate?.marginalReliefApplied ? 'cess-absorbed' : ''}">
                                <span>${tax.cessName || 'Cess'} (${pct(tax.cessPercentage)})${tax.rebate?.marginalReliefApplied ? ' - absorbed by relief' : ''}</span>
                                <span>${tax.rebate?.marginalReliefApplied ? '(included)' : `+ ${fmt(tax.cessAmount)}`}</span>
                            </div>
                        ` : ''}
                        <div class="tax-line total">
                            <span>Total Annual Tax</span>
                            <span>${fmt(tax.totalAnnualTax)}</span>
                        </div>
                        <div class="tax-line monthly">
                            <span>Monthly TDS (${tax.monthsRemaining || 12} months remaining)</span>
                            <span class="monthly-tds">${fmt(tax.monthlyTDS || tax.proratedTDS)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Build employer contributions section - comprehensive version matching payroll.js
     * @param {object} proof - The calculation proof data
     * @param {function} fmt - Currency formatting function
     * @param {object} displayOptions - Display options
     * @param {boolean} displayOptions.hideOrganizationalOverhead - Hide items with employerPortion='organizational_overhead'
     */
    function buildEmployerContributionsSection(proof, fmt, displayOptions = {}) {
        let items = proof.employerContributionItems || [];
        if (items.length === 0) return '';

        // ESS mode: Filter out organizational overhead items (not visible to employees)
        if (displayOptions.hideOrganizationalOverhead) {
            items = items.filter(item => item.employerPortion !== 'organizational_overhead');
        }

        // If no items remain after filtering, don't show the section
        if (items.length === 0) return '';

        // Calculate visible total (sum of filtered items)
        const visibleTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);

        let rows = items.map(item => `
            <tr>
                <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
                <td class="text-right amount-cell">${fmt(item.amount)}</td>
            </tr>
        `).join('');

        // Use filtered total in ESS mode, original total otherwise
        const displayTotal = displayOptions.hideOrganizationalOverhead ? visibleTotal : proof.totalEmployerContributions;

        return `
            <div class="proof-card employer-card">
                <div class="proof-card-header employer-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
                    </svg>
                    <span>Employer Contributions</span>
                    <span class="header-badge employer-badge">${fmt(displayTotal)}</span>
                </div>
                <div class="proof-card-body">
                    <p class="employer-note">These contributions are paid by the employer and are not deducted from employee salary.</p>
                    <table class="proof-table">
                        <thead>
                            <tr>
                                <th>Component</th>
                                <th class="text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td><strong>Total Employer Contributions</strong></td>
                                <td class="text-right"><strong>${fmt(displayTotal)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Build version timeline section - comprehensive version matching payroll.js
     */
    function buildVersionTimelineSection(proof, fmt) {
        const timeline = proof.versionTimeline || [];
        if (timeline.length <= 1) return ''; // Only show if multiple versions

        const formatChangeReason = (reason) => {
            if (!reason) return 'Standard';
            const reasonMap = {
                'salary_period': 'Standard Period',
                'structure_update': 'Structure Change',
                'transfer': 'Transfer',
                'promotion': 'Promotion',
                'revision': 'Salary Revision',
                'mid_month_change': 'Mid-Month Change'
            };
            return reasonMap[reason.toLowerCase()] || reason.replace(/_/g, ' ');
        };

        const rows = timeline.map((version, index) => {
            const effectiveFrom = formatDate(version.effectiveFrom);
            const effectiveTo = formatDate(version.effectiveTo);
            const reasonDisplay = formatChangeReason(version.changeReason);
            const isFirst = index === 0;

            return `
                <tr class="${isFirst ? 'first-version' : ''}">
                    <td class="version-code">
                        <span class="version-badge">${version.versionCode || `V${index + 1}`}</span>
                    </td>
                    <td class="structure-name">${version.structureName || '-'}</td>
                    <td class="text-center">${effectiveFrom} - ${effectiveTo}</td>
                    <td class="text-center">
                        <span class="days-badge">${version.daysApplied || 0} days</span>
                    </td>
                    <td class="text-center">
                        <span class="reason-badge ${version.changeReason || 'default'}">${reasonDisplay}</span>
                    </td>
                </tr>
            `;
        }).join('');

        return `
            <div class="proof-card timeline-card">
                <div class="proof-card-header timeline-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    <span>Salary Structure Timeline</span>
                    <span class="header-badge timeline-badge">${timeline.length} versions</span>
                </div>
                <div class="proof-card-body">
                    <p class="section-description">Employee had salary structure changes during this pay period. Earnings are prorated based on days worked under each structure.</p>
                    <table class="proof-table timeline-table">
                        <thead>
                            <tr>
                                <th>Version</th>
                                <th>Salary Structure</th>
                                <th class="text-center">Period</th>
                                <th class="text-center">Days Applied</th>
                                <th class="text-center">Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    /**
     * Build location breakdown section - for multi-location payroll
     */
    function buildLocationBreakdownSection(proof, fmt) {
        const locations = proof.locationBreakdowns || [];
        if (locations.length <= 1) return ''; // Only show if multiple locations

        const formatJurisdictionPolicy = (policy) => {
            if (!policy) return 'Standard';
            const policyMap = {
                'CALENDAR_MONTH_FIRST': 'Tax applied based on first location of the calendar month',
                'DAYS_MAJORITY': 'Tax applied based on location with most days worked',
                'PROPORTIONAL': 'Tax prorated based on days worked at each location',
                'PRIMARY_OFFICE': 'Tax applied based on employee\'s primary office'
            };
            return policyMap[policy.toUpperCase()] || policy.replace(/_/g, ' ');
        };

        const rows = locations.map((loc, index) => {
            const isFirst = index === 0;
            return `
                <tr class="${isFirst ? 'primary-location' : ''}">
                    <td class="location-name">
                        ${loc.officeName || '-'}
                        <span class="office-code">(${loc.officeCode || '-'})</span>
                    </td>
                    <td class="text-center">
                        <span class="days-badge">${loc.workedDays || 0} days</span>
                    </td>
                    <td class="text-right">${fmt(loc.grossEarnings || 0)}</td>
                    <td class="text-right">${fmt(loc.totalDeductions || 0)}</td>
                    <td class="text-right net-cell">
                        <strong>${fmt(loc.netPay || 0)}</strong>
                    </td>
                </tr>
            `;
        }).join('');

        const totalWorkedDays = locations.reduce((sum, loc) => sum + (loc.workedDays || 0), 0);
        const totalGross = locations.reduce((sum, loc) => sum + (loc.grossEarnings || 0), 0);
        const totalDeductions = locations.reduce((sum, loc) => sum + (loc.totalDeductions || 0), 0);
        const totalNet = locations.reduce((sum, loc) => sum + (loc.netPay || 0), 0);

        const jurisdictionNote = proof.jurisdictionPolicy
            ? `<p class="jurisdiction-note"><strong>Tax Jurisdiction Policy:</strong> ${formatJurisdictionPolicy(proof.jurisdictionPolicy)}</p>`
            : '';

        return `
            <div class="proof-card location-card">
                <div class="proof-card-header location-header">
                    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                        <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                    <span>Multi-Location Breakdown</span>
                    <span class="header-badge location-badge">${locations.length} locations</span>
                </div>
                <div class="proof-card-body">
                    <p class="section-description">Employee worked at multiple locations during this pay period. Statutory deductions are applied based on each location's tax jurisdiction.</p>
                    ${jurisdictionNote}
                    <table class="proof-table location-table">
                        <thead>
                            <tr>
                                <th>Location</th>
                                <th class="text-center">Days Worked</th>
                                <th class="text-right">Gross Earnings</th>
                                <th class="text-right">Deductions</th>
                                <th class="text-right">Net Pay</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td><strong>Combined Total</strong></td>
                                <td class="text-center"><strong>${totalWorkedDays} days</strong></td>
                                <td class="text-right"><strong>${fmt(totalGross)}</strong></td>
                                <td class="text-right"><strong>${fmt(totalDeductions)}</strong></td>
                                <td class="text-right"><strong>${fmt(totalNet)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        `;
    }

    // ==========================================
    // PROOF ACTIONS
    // ==========================================

    /**
     * Switch between proof tabs
     */
    function switchProofTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.proof-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        event.target.classList.add('active');

        // Update tab content - use display toggle (matching HTML structure)
        const formattedContent = document.getElementById('proofTabFormatted');
        const jsonContent = document.getElementById('proofTabJson');

        if (tabName === 'formatted') {
            if (formattedContent) formattedContent.style.display = 'block';
            if (jsonContent) jsonContent.style.display = 'none';
        } else {
            if (formattedContent) formattedContent.style.display = 'none';
            if (jsonContent) jsonContent.style.display = 'block';
        }
    }

    /**
     * Copy proof JSON to clipboard
     */
    function copyProofJson() {
        if (!window.currentCalculationProof?.proof) {
            showToast('No proof data available', 'warning');
            return;
        }

        const jsonString = JSON.stringify(window.currentCalculationProof.proof, null, 2);
        navigator.clipboard.writeText(jsonString).then(() => {
            showToast('JSON copied to clipboard', 'success');
        }).catch(err => {
            console.error('Failed to copy:', err);
            showToast('Failed to copy to clipboard', 'error');
        });
    }

    /**
     * Download proof as JSON file
     */
    function downloadProofJson() {
        if (!window.currentCalculationProof?.proof) {
            showToast('No proof data available', 'warning');
            return;
        }

        const jsonString = JSON.stringify(window.currentCalculationProof.proof, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `calculation-proof-${window.currentCalculationProof.payslipId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('JSON file downloaded', 'success');
    }

    /**
     * Print the calculation proof with full formatting
     */
    function printCalculationProof() {
        const proofContent = document.getElementById('proofTabFormatted');
        if (!proofContent) {
            showToast('No proof content to print', 'warning');
            return;
        }

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            showToast('Please allow popups to print', 'warning');
            return;
        }

        const proofData = window.currentCalculationProof;

        // Comprehensive print styles matching the UI
        const printStyles = `
            /* ========================================
               STANDARDIZED FONT SIZES:
               - Title (h1): 18px
               - Section headers: 12px
               - Body text/values: 11px
               - Small labels: 9px
               - Large summary values: 16px
               - Badges: 9px
               ======================================== */
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
                color-adjust: exact !important;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 20px;
                color: #1f2937;
                font-size: 11px;
                line-height: 1.5;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }

            /* Header */
            .print-header {
                text-align: center;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 2px solid #e5e7eb;
            }
            .print-header h1 { font-size: 18px; margin-bottom: 5px; color: #111827; }
            .print-header .meta { color: #6b7280; font-size: 11px; }

            /* Summary Cards - with forced print colors */
            .proof-summary-row {
                display: flex;
                gap: 12px;
                margin-bottom: 20px;
            }
            .proof-summary-card {
                flex: 1;
                padding: 15px;
                border-radius: 8px;
                text-align: center;
                color: white !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .proof-summary-card.earnings { background: #10b981 !important; }
            .proof-summary-card.deductions { background: #f59e0b !important; }
            .proof-summary-card.net-pay { background: #6366f1 !important; }
            .summary-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: white !important; }
            .summary-value { font-size: 16px; font-weight: 700; margin-top: 4px; color: white !important; }

            /* Section Grid */
            .proof-section-grid {
                display: flex;
                gap: 12px;
                margin-bottom: 15px;
            }
            .proof-section-grid > .proof-card { flex: 1; }

            /* Cards - with forced print colors */
            .proof-card {
                background: #fff !important;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                margin-bottom: 15px;
                overflow: hidden;
                page-break-inside: avoid;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .proof-card-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #f3f4f6 !important;
                font-weight: 600;
                font-size: 12px;
                border-bottom: 1px solid #e5e7eb;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .proof-card-header svg { width: 16px; height: 16px; }
            .proof-card-body { padding: 12px; font-size: 11px; }

            /* Badges - with forced print colors */
            .header-badge {
                margin-left: auto;
                padding: 3px 10px;
                border-radius: 12px;
                font-size: 9px;
                font-weight: 600;
                color: white !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .earnings-badge { background: #10b981 !important; }
            .deductions-badge { background: #f59e0b !important; }
            .tax-badge { background: #8b5cf6 !important; }
            .employer-badge { background: #3b82f6 !important; }
            .voluntary-badge { background: #06b6d4 !important; }
            .timeline-badge { background: #6366f1 !important; }
            .location-badge { background: #ec4899 !important; }
            .arrears-badge { background: #f97316 !important; }

            /* Info Grid */
            .cp-info-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 10px;
            }
            .cp-info-item { display: flex; flex-direction: column; }
            .info-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.3px; }
            .info-value { font-size: 11px; font-weight: 500; color: #111827; }

            /* Compensation Grid */
            .compensation-grid {
                display: flex;
                justify-content: space-around;
                text-align: center;
            }
            .comp-item { display: flex; flex-direction: column; }
            .comp-label { font-size: 9px; color: #6b7280; text-transform: uppercase; }
            .comp-value { font-size: 12px; font-weight: 600; color: #111827; }

            /* Tables - with forced print colors */
            .proof-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
            }
            .proof-table th {
                background: #f3f4f6 !important;
                padding: 8px 10px;
                font-weight: 600;
                font-size: 11px;
                text-align: left;
                border-bottom: 2px solid #e5e7eb;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .proof-table td {
                padding: 8px 10px;
                font-size: 11px;
                border-bottom: 1px solid #f3f4f6;
            }
            .proof-table .text-right { text-align: right; }
            .proof-table .text-center { text-align: center; }
            .proof-table tfoot td {
                background: #f9fafb !important;
                font-weight: 600;
                font-size: 11px;
                border-top: 2px solid #e5e7eb;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .total-row td { font-weight: 700; background: #f3f4f6 !important; }
            tr.not-eligible { opacity: 0.5; }

            /* Adjustments Table - override inline styles for consistency */
            .adjustments-table td { font-size: 11px !important; }
            .adjustments-table .component-name { font-size: 11px; }
            .adjustments-table .component-name { font-size: 11px; }
            .adjustments-table .adjustment-type { font-size: 11px; }
            .adjustments-table .adjustment-reason { font-size: 11px; color: #6b7280; }
            .adjustments-table .amount-cell { font-size: 11px; font-weight: 600; }
            .subsection-title { font-size: 11px; font-weight: 600; margin-bottom: 8px; }
            .section-description { font-size: 9px; color: #6b7280; margin-bottom: 12px; }
            .adjustment-net-impact { font-size: 11px !important; }
            .adjustment-net-impact span { font-size: 11px !important; }

            /* Status Badges - with forced print colors */
            .status-badge, .arrears-status-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 9px;
                font-weight: 600;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .status-badge.paid, .arrears-status-badge.paid { background: #dcfce7 !important; color: #166534 !important; }
            .status-badge.pending, .arrears-status-badge.pending { background: #fef3c7 !important; color: #92400e !important; }
            .status-badge.superseded, .arrears-status-badge.superseded { background: #f59e0b !important; color: #ffffff !important; }
            .status-badge.active { background: #dbeafe !important; color: #1e40af !important; }

            /* Version Timeline - with forced print colors */
            .version-timeline { display: flex; flex-direction: column; gap: 10px; }
            .version-entry {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 10px;
                background: #f9fafb !important;
                border-radius: 6px;
                border-left: 3px solid #6366f1;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .version-marker {
                width: 28px;
                height: 28px;
                background: #6366f1 !important;
                color: white !important;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 600;
                flex-shrink: 0;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .version-content { flex: 1; }
            .version-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
            .version-title { font-weight: 600; font-size: 11px; }
            .version-dates { font-size: 9px; color: #6b7280; }
            .version-details { display: flex; flex-wrap: wrap; gap: 15px; font-size: 11px; }
            .version-detail-item { display: flex; flex-direction: column; }
            .version-detail-label { font-size: 9px; color: #9ca3af; text-transform: uppercase; }
            .version-detail-value { font-size: 11px; font-weight: 500; }

            /* Tax Section - with forced print colors */
            .tax-regime-banner {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #8b5cf6 !important;
                color: white !important;
                border-radius: 6px;
                margin-bottom: 12px;
                font-size: 11px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .regime-label { opacity: 0.9; font-size: 10px; }
            .regime-value { font-weight: 600; font-size: 10px; }
            .tax-flow {
                display: flex !important;
                flex-direction: row !important;
                flex-wrap: wrap !important;
                align-items: center !important;
                gap: 6px;
                margin-bottom: 10px;
                padding: 8px;
                background: #f9fafb !important;
                border-radius: 6px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .tax-flow-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 4px 8px;
                background: #ffffff !important;
                border: 1px solid #e5e7eb;
                border-radius: 4px;
                font-size: 9px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .tax-flow-item .flow-label { font-size: 7px; text-transform: uppercase; opacity: 0.7; }
            .tax-flow-item .flow-value { font-size: 9px; font-weight: 600; }
            .tax-flow-operator { font-size: 12px; font-weight: bold; color: #6b7280; padding: 0 2px; }
            .tax-flow-item.result { background: #fef3c7 !important; font-weight: 600; border-color: #fcd34d; }
            .tax-flow-item.final { background: #dbeafe !important; font-weight: 700; border-color: #93c5fd; }
            .slab-table { margin-top: 10px; }

            /* Arrears Lifecycle Card - specific styling */
            .arrears-lifecycle-card {
                border: 1px solid #f97316 !important;
            }
            .arrears-lifecycle-header {
                background: linear-gradient(135deg, #fff7ed, #ffedd5) !important;
                background: #fff7ed !important;
                border-bottom: 1px solid #fed7aa !important;
            }
            .arrears-lifecycle-header .header-badge {
                background: #3b82f6 !important;
            }

            /* Arrears Records - organized layout for print */
            .arrears-records-title {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                font-weight: 600;
                color: #6b7280;
                margin: 12px 0 8px 0;
                padding-bottom: 6px;
                border-bottom: 1px solid #e5e7eb;
            }
            .arrears-record {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 10px 12px;
                margin-bottom: 8px;
                background: #f9fafb !important;
                border-radius: 6px;
                border: 1px solid #e5e7eb;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .arrears-record.status-applied {
                border-left: 3px solid #10b981 !important;
                background: #f0fdf4 !important;
            }
            .arrears-record.status-superseded {
                border-left: 3px solid #9ca3af !important;
                background: #f9fafb !important;
                opacity: 0.8;
            }
            .arrears-record-status {
                flex-shrink: 0;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                min-width: 70px;
            }
            .status-badge {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 3px 8px;
                border-radius: 10px;
                font-size: 9px;
                font-weight: 600;
                text-transform: uppercase;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .status-badge.applied {
                background: #10b981 !important;
                color: white !important;
            }
            .status-badge.superseded {
                background: #f59e0b !important;
                color: #ffffff !important;
            }
            .arrears-record-details {
                flex: 1;
                min-width: 0;
            }
            .arrears-record-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 4px;
            }
            .arrears-period {
                font-weight: 600;
                color: #111827;
                font-size: 11px;
            }
            .arrears-amount {
                font-weight: 600;
                font-size: 11px;
            }
            .arrears-amount.positive { color: #10b981 !important; }
            .arrears-amount.negative { color: #ef4444 !important; }
            .arrears-ctc-change {
                font-size: 9px;
                color: #6b7280;
                margin-bottom: 2px;
            }
            .arrears-note {
                font-size: 9px;
                color: #9ca3af;
                font-style: italic;
            }
            /* Arrears Summary Banner and Chain Alert */
            .arrears-summary-banner {
                padding: 10px 12px;
                background: #fef3c7 !important;
                border: 1px solid #fcd34d;
                border-radius: 6px;
                margin-bottom: 12px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .arrears-summary-text {
                font-size: 11px;
                color: #92400e !important;
                margin: 0;
            }
            .arrears-chain-alert {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 12px;
                background: #dbeafe !important;
                border: 1px solid #93c5fd;
                border-radius: 6px;
                margin-bottom: 12px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .chain-text {
                font-size: 11px;
                color: #1e40af !important;
            }
            .ctc-arrow {
                margin: 0 4px;
                color: #9ca3af;
            }

            /* Arrears Stats Row - matches HTML class names */
            .arrears-stats-row {
                display: flex;
                gap: 20px;
                margin-top: 12px;
                padding: 12px;
                background: #f3f4f6 !important;
                border-radius: 6px;
                border: 1px solid #e5e7eb;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .arrears-stat {
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .arrears-stat-label {
                font-size: 9px;
                color: #6b7280;
                font-weight: 500;
            }
            .arrears-stat-value {
                font-size: 11px;
                font-weight: 700;
                color: #111827;
            }
            .arrears-stat-value.applied {
                color: #16a34a !important;
            }
            .arrears-stat-value.superseded {
                color: #9ca3af !important;
            }

            /* Location Breakdown - with forced print colors */
            .location-breakdown-visual { margin-bottom: 15px; }
            .location-bar-container {
                height: 24px;
                background: #f3f4f6 !important;
                border-radius: 6px;
                overflow: hidden;
                display: flex;
                margin-bottom: 8px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .location-bar-segment {
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white !important;
                font-size: 9px;
                font-weight: 600;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .location-legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; }
            .legend-item { display: flex; align-items: center; gap: 6px; }
            .legend-color {
                width: 12px;
                height: 12px;
                border-radius: 3px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }

            /* Verification - with forced print colors */
            .verification-grid { display: flex; flex-direction: column; gap: 8px; }
            .verification-item {
                display: grid;
                grid-template-columns: 1fr auto auto;
                gap: 20px;
                align-items: center;
                padding: 8px 12px;
                background: #f9fafb !important;
                border-radius: 6px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .verification-item.highlight { background: #dbeafe !important; }
            .verification-label { font-size: 11px; font-weight: 500; text-align: left; }
            .verification-value { font-size: 11px; font-weight: 600; text-align: right; min-width: 120px; }
            .verification-check { font-size: 11px; color: #10b981 !important; font-weight: bold; text-align: center; min-width: 20px; }

            /* Footer */
            .print-footer {
                margin-top: 20px;
                padding-top: 15px;
                border-top: 1px solid #e5e7eb;
                text-align: center;
                font-size: 9px;
                color: #9ca3af;
            }

            /* Utility */
            .text-success { color: #10b981; }
            .text-warning { color: #f59e0b; }
            .text-error { color: #ef4444; }
            .positive { color: #10b981; }
            .negative { color: #ef4444; }

            /* Print specific */
            @media print {
                * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                    color-adjust: exact !important;
                }
                body { padding: 10px; }
                .proof-card { break-inside: avoid; }
                .no-print { display: none !important; }
            }

            /* Declaration Validation Section - Print Styles */
            .declaration-validation-section {
                padding: 12px;
                font-size: 11px;
            }
            .declaration-section-group {
                margin-bottom: 16px;
                padding: 10px;
                background: #f9fafb !important;
                border: 1px solid #e5e7eb;
                border-radius: 6px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .declaration-section-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 1px solid #e5e7eb;
            }
            .declaration-section-header h4 {
                font-size: 11px;
                font-weight: 600;
                color: #111827;
                margin: 0;
            }
            .declaration-section-header .limit-info {
                font-size: 9px;
                color: #6b7280;
            }
            .declaration-items-header {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 1rem;
                font-size: 9px;
                font-weight: 600;
                color: #6b7280;
                text-transform: uppercase;
                padding-bottom: 6px;
                border-bottom: 1px solid #e5e7eb;
                margin-bottom: 6px;
            }
            .declaration-items-header span:not(:first-child) {
                text-align: right;
            }
            .declaration-item {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 1rem;
                padding: 6px 0;
                font-size: 10px;
                align-items: center;
                border-bottom: 1px solid #f3f4f6;
            }
            .declaration-item:last-of-type {
                border-bottom: none;
            }
            .declaration-item-name {
                color: #374151;
                font-weight: 500;
            }
            .declaration-item-declared,
            .declaration-item-allowed {
                text-align: right;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
                font-size: 10px;
                white-space: nowrap;
            }
            .declaration-section-total {
                display: grid;
                grid-template-columns: 2fr 1fr 1fr;
                gap: 1rem;
                padding: 8px 0;
                margin-top: 8px;
                border-top: 2px solid #e5e7eb;
                font-weight: 600;
                font-size: 10px;
                white-space: nowrap;
            }
            .declaration-section-total span:not(:first-child) {
                text-align: right;
            }
            .declaration-section-capped {
                padding: 6px 10px;
                margin-top: 8px;
                background: #fef3c7 !important;
                border: 1px solid #fcd34d;
                border-radius: 4px;
                font-size: 9px;
                color: #92400e !important;
                white-space: nowrap;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .declaration-warnings {
                margin-top: 12px;
                padding: 10px;
                background: #fef3c7 !important;
                border: 1px solid #fcd34d;
                border-radius: 6px;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            .declaration-warnings h5 {
                font-size: 10px;
                font-weight: 600;
                color: #92400e !important;
                margin: 0 0 6px 0;
            }
            .declaration-warnings ul {
                margin: 0;
                padding-left: 16px;
            }
            .declaration-warnings li {
                font-size: 9px;
                color: #92400e !important;
                margin-bottom: 2px;
            }

            /* Hide SVG icons in print (they don't render well) */
            svg { display: none; }
        `;

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Payroll Calculation - ${proofData?.employeeName || 'Employee'}</title>
                <style>${printStyles}</style>
            </head>
            <body>
                <div class="print-header">
                    <h1>Payroll Calculation</h1>
                    <p class="meta">${proofData?.employeeName || ''} (${proofData?.employeeCode || ''}) &bull; ${proofData?.payPeriod || ''}</p>
                </div>
                ${proofContent.innerHTML}
                <div class="print-footer">
                    <p>Generated on ${new Date().toLocaleString()} &bull; Engine Version: ${proofData?.proof?.engineVersion || 'N/A'}</p>
                    <p>This is a system-generated document for verification purposes.</p>
                </div>
            </body>
            </html>
        `);

        printWindow.document.close();
        printWindow.focus();

        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 300);
    }

    // ==========================================
    // DOWNLOAD PDF
    // ==========================================

    /**
     * Download payslip as PDF
     */
    function downloadPdf() {
        if (!currentPayslipId) {
            showToast('No payslip selected', 'warning');
            return;
        }

        showToast('Generating payslip PDF...', 'info');
        const baseUrl = typeof api !== 'undefined' && api.getBaseUrl ? api.getBaseUrl('/hrms') : '';
        window.open(`${baseUrl}/hrms/payroll-processing/payslips/${currentPayslipId}/download`, '_blank');
    }

    // ==========================================
    // CLOSE FUNCTIONS
    // ==========================================

    /**
     * Close the payslip modal
     */
    function close() {
        closeModal('payslipModal');
        currentPayslipId = null;
    }

    /**
     * Close the calculation proof modal
     */
    function closeProof() {
        closeModal('calculationProofModal');
    }

    // ==========================================
    // ESS MODE WRAPPERS
    // ==========================================

    /**
     * View calculation proof for ESS (Employee Self-Service)
     * Hides organizational overhead items and JSON tab
     * @param {string} payslipId - The payslip ID
     * @param {boolean} isDraft - Whether this is a draft payslip
     */
    function viewCalculationProofEss(payslipId, isDraft = false) {
        return viewCalculationProof(payslipId, isDraft, { essMode: true });
    }

    // ==========================================
    // PUBLIC API
    // ==========================================

    return {
        // Main viewing functions
        viewProcessed: viewProcessed,
        viewDraft: viewProcessed, // For now, same function works for both
        viewCalculationProof: viewCalculationProof,

        // ESS mode functions (hide organizational overhead and JSON tab)
        viewCalculationProofEss: viewCalculationProofEss,

        // Modal management
        close: close,
        closeProof: closeProof,

        // Proof actions
        switchProofTab: switchProofTab,
        copyProofJson: copyProofJson,
        downloadProofJson: downloadProofJson,
        downloadCalculationProof: downloadProofJson, // Alias for button onclick
        printCalculationProof: printCalculationProof,

        // PDF download
        downloadPdf: downloadPdf,

        // Utility for external use
        formatCurrency: formatCurrency,
        formatDate: formatDate
    };
})();

// Legacy function aliases for backwards compatibility
function viewPayslip(payslipId) {
    return PayslipModal.viewProcessed(payslipId);
}

// ESS mode: View payslip with ESS mode enabled (hides organizational_overhead items and JSON tab in calculation proof)
function viewPayslipEss(payslipId) {
    return PayslipModal.viewProcessed(payslipId, { essMode: true });
}

function viewCalculationProofProcessed(payslipId) {
    return PayslipModal.viewCalculationProof(payslipId, false);
}

// ESS mode legacy alias
function viewCalculationProofProcessedEss(payslipId) {
    return PayslipModal.viewCalculationProofEss(payslipId, false);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PayslipModal, viewPayslip, viewPayslipEss, viewCalculationProofProcessed, viewCalculationProofProcessedEss };
}
