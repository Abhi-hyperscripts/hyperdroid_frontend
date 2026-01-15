/**
 * Unified Payslip Modal Component for HyperDroid HRMS
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
     * Open a modal by ID
     */
    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
        }
    }

    /**
     * Close a modal by ID
     */
    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
        }
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
                background: var(--bg-subtle, var(--bg-tertiary));
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
                background: var(--bg-tertiary);
                border-bottom: 1px solid var(--border-primary);
            }

            .proof-tab {
                display: flex;
                align-items: center;
                gap: 0.375rem;
                padding: 0.5rem 1rem;
                background: transparent;
                border: 1px solid var(--border-secondary);
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
                color: var(--text-secondary);
                transition: all 0.2s ease;
            }

            .proof-tab:hover {
                background: var(--bg-hover);
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

            /* Tab Content */
            .proof-tab-content {
                flex: 1;
                overflow-y: auto;
                padding: 1.5rem;
                background: var(--bg-primary);
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
                border-bottom: 1px solid var(--border-secondary);
            }

            .json-viewer {
                font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
                font-size: 0.8rem;
                line-height: 1.5;
                padding: 1rem;
                background: var(--bg-secondary);
                border: 1px solid var(--border-primary);
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
                gap: 1rem;
                margin-bottom: 1.5rem;
            }

            .proof-summary-card {
                padding: 1.25rem;
                border-radius: 10px;
                text-align: center;
                transition: transform 0.2s;
                color: var(--text-inverse);
            }

            .proof-summary-card:hover { transform: translateY(-2px); }
            .proof-summary-card.earnings { background: linear-gradient(135deg, #10b981, #059669); }
            .proof-summary-card.deductions { background: linear-gradient(135deg, #f59e0b, #d97706); }
            .proof-summary-card.net-pay { background: linear-gradient(135deg, #6366f1, #4f46e5); }

            .summary-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                opacity: 0.9;
                margin-bottom: 0.25rem;
            }

            .summary-value { font-size: 1.5rem; font-weight: 700; }

            /* Section Grid */
            .proof-section-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1rem;
                margin-bottom: 1rem;
            }

            @media (max-width: 768px) {
                .proof-section-grid { grid-template-columns: 1fr; }
                .proof-summary-row { grid-template-columns: 1fr; }
            }

            /* Cards */
            .proof-card {
                background: var(--bg-secondary);
                border-radius: 10px;
                border: 1px solid var(--border-primary);
                margin-bottom: 1rem;
                overflow: hidden;
                transition: all 0.25s ease;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }

            .proof-card:hover {
                border-color: var(--brand-primary);
                transform: translateY(-2px);
            }

            .proof-card-header {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                padding: 0.875rem 1rem;
                background: var(--bg-tertiary);
                font-weight: 600;
                font-size: 0.9rem;
                border-bottom: 1px solid var(--border-primary);
                color: var(--text-primary);
            }

            .header-badge {
                margin-left: auto;
                padding: 0.25rem 0.75rem;
                border-radius: 20px;
                font-size: 0.8rem;
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

            .proof-card-body { padding: 1rem; }

            /* Info Grid - using cp- prefix to avoid conflicts with hrms-ess.css */
            .cp-info-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.75rem;
            }

            .cp-info-item {
                display: flex;
                flex-direction: column;
                background: none !important;
                border: none !important;
                padding: 0 !important;
            }

            .info-label {
                font-size: 0.75rem;
                color: var(--text-secondary);
                text-transform: uppercase;
                letter-spacing: 0.03em;
            }

            .info-value {
                font-size: 0.9rem;
                font-weight: 500;
                color: var(--text-primary);
            }

            /* Compensation Grid */
            .compensation-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 1.5rem;
                text-align: center;
            }

            .comp-item { display: flex; flex-direction: column; }
            .comp-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase; }
            .comp-value { font-size: 1.1rem; font-weight: 600; color: var(--text-primary); }

            /* Tables */
            .proof-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 0.85rem;
            }

            .proof-table th {
                background: var(--bg-tertiary);
                padding: 0.625rem 0.75rem;
                font-weight: 600;
                text-align: left;
                border-bottom: 2px solid var(--border-primary);
                color: var(--text-primary);
            }

            .proof-table td {
                padding: 0.625rem 0.75rem;
                border-bottom: 1px solid var(--border-secondary);
                color: var(--text-primary);
            }

            .proof-table tbody tr:hover { background: var(--bg-hover); }
            .proof-table .text-right { text-align: right; }
            .proof-table .text-center { text-align: center; }

            .proof-table tfoot td {
                background: var(--bg-tertiary);
                border-top: 2px solid var(--border-primary);
                border-bottom: none;
            }

            .total-row td { font-weight: 600; }

            .component-name {
                display: flex;
                align-items: center;
                gap: 0.5rem;
            }

            .eligibility-reason { color: var(--text-secondary); cursor: help; }

            .eligibility-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                font-size: 0.75rem;
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
                background: linear-gradient(135deg, var(--brand-accent, var(--brand-primary)), var(--brand-primary-hover));
                color: var(--text-inverse);
                border-radius: 8px;
                margin-bottom: 1rem;
            }

            .regime-label { opacity: 0.9; }
            .regime-value { font-weight: 600; }
            .regime-section { opacity: 0.8; font-size: 0.85rem; }

            .tax-flow {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 0.5rem;
                padding: 1rem;
                background: var(--bg-tertiary);
                border-radius: 8px;
                margin-bottom: 1rem;
            }

            .tax-flow-item {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 0.5rem 1rem;
                background: var(--bg-secondary);
                border-radius: 6px;
                border: 1px solid var(--border-secondary);
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
                background: var(--bg-tertiary);
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
                border-top: 1px dashed var(--border-primary);
                margin-top: 0.5rem;
                padding-top: 0.5rem;
                font-weight: 600;
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

            .tax-final {
                background: var(--bg-tertiary);
                border-radius: 8px;
                padding: 1rem;
                padding-bottom: 3rem;
                position: relative;
            }

            .tax-line { display: flex; justify-content: space-between; padding: 0.375rem 0; font-size: 0.9rem; color: var(--text-primary); }
            .tax-line.total { border-top: 1px solid var(--border-primary); margin-top: 0.5rem; padding-top: 0.5rem; font-weight: 600; }
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
                background: var(--bg-tertiary);
                border-radius: 6px;
            }

            /* Verification Card */
            .verification-card { border: 2px solid var(--brand-primary); }
            .verification-grid { display: flex; flex-direction: column; gap: 0.5rem; }

            .verification-item {
                display: flex;
                align-items: center;
                padding: 0.625rem 0.75rem;
                background: var(--bg-tertiary);
                border-radius: 6px;
                color: var(--text-primary);
            }

            .verification-item.highlight {
                background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary-hover));
                color: var(--text-inverse);
            }

            .verification-label { flex: 1; font-size: 0.9rem; }
            .verification-value { font-weight: 600; margin-right: 1rem; }
            .verification-check { color: var(--color-success); font-size: 1.25rem; }
            .verification-item.highlight .verification-check { color: var(--text-inverse); }

            /* Footer */
            .proof-footer {
                padding: 1rem;
                background: var(--bg-tertiary);
                border-top: 1px solid var(--border-primary);
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
                background: var(--bg-hover);
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
                background: var(--bg-tertiary);
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

            .addition-amount { color: var(--color-success); font-weight: 600; }
            .deduction-amount { color: var(--color-error); font-weight: 600; }

            .subtotal-row td { background: var(--bg-tertiary); font-size: 0.9rem; }
            .adjustments-table { margin-bottom: 0; }
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
                background: var(--bg-tertiary);
                color: var(--text-primary);
                border-radius: 12px;
                font-size: 0.8rem;
                font-weight: 500;
            }

            .reason-badge {
                display: inline-flex;
                align-items: center;
                padding: 0.25rem 0.75rem;
                background: var(--bg-tertiary);
                color: var(--text-secondary);
                border-radius: 12px;
                font-size: 0.75rem;
                text-transform: capitalize;
            }

            .reason-badge.structure_update { background: var(--status-pending); color: var(--text-inverse); }
            .reason-badge.transfer { background: var(--color-info); color: var(--text-inverse); }
            .reason-badge.promotion { background: var(--color-success); color: var(--text-inverse); }

            .timeline-table .structure-name { font-weight: 500; }
            .timeline-table .first-version td { background: var(--bg-hover); }

            /* Location Breakdown Section */
            .location-card { border-left: 3px solid var(--brand-secondary, var(--brand-primary)); }
            .location-header svg { color: var(--brand-secondary, var(--brand-primary)); }

            .location-name { display: flex; align-items: center; gap: 0.5rem; }
            .location-icon { font-size: 1rem; }
            .office-code { color: var(--text-secondary); font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; }

            .location-table .primary-location td { background: var(--bg-hover); }
            .location-table .net-cell { color: var(--color-success); }

            .jurisdiction-note {
                font-size: 0.8rem;
                color: var(--text-secondary);
                margin-bottom: 1rem;
                padding: 0.75rem 1rem;
                background: var(--bg-hover);
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

            .version-group-item td { background: var(--bg-secondary); border-left: 3px solid transparent; padding-left: 1.5rem !important; }
            .version-group-item:hover td { background: var(--bg-hover); }

            .version-subtotal-row td { background: var(--bg-tertiary); border-bottom: 1px solid var(--border-primary); font-size: 0.85rem; padding: 0.5rem 1rem !important; }
            .version-subtotal-row em { color: var(--text-secondary); }

            .jurisdiction-label {
                display: inline-block;
                margin-left: 0.5rem;
                padding: 0.15rem 0.5rem;
                background: var(--bg-tertiary);
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
     */
    async function viewProcessed(payslipId) {
        try {
            injectStyles();
            ensureModalExists();
            currentPayslipId = payslipId;

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
                    <button class="btn btn-secondary" onclick="PayslipModal.viewCalculationProof('${payslipId}', false)" style="display: flex; align-items: center; gap: 0.5rem;">
                        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                        View Calculation Proof
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
            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; border: 2px solid var(--border-color);">
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
                <div style="display: flex; justify-content: space-between; padding: 0.75rem 0; margin-top: 0.5rem; background: var(--bg-tertiary); border-radius: 4px; padding-left: 0.5rem; padding-right: 0.5rem;">
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
                            Calculation Proof - ${proof.employeeName || response.employee_name} (${proof.employeeCode || response.employee_code})
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
                                            <span class="verification-check">✓</span>
                                        </div>
                                        <div class="verification-item">
                                            <span class="verification-label">Total Deductions</span>
                                            <span class="verification-value">${fmt(proof.totalDeductions)}</span>
                                            <span class="verification-check">✓</span>
                                        </div>
                                        <div class="verification-item highlight">
                                            <span class="verification-label">Net Pay (Gross - Deductions)</span>
                                            <span class="verification-value">${fmt(proof.netPay)}</span>
                                            <span class="verification-check">✓</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Footer -->
                            <div class="proof-footer">
                                <div class="footer-info">
                                    <span>Generated: ${new Date(proof.generatedAt || Date.now()).toLocaleString()}</span>
                                    <span>•</span>
                                    <span>HyperDroid HRMS ${proof.taxCalculation?.engineVersion || 'v3.0'}</span>
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
     */
    function buildEarningsSection(proof, fmt) {
        const items = proof.earningsItems || [];
        if (items.length === 0) return '';

        let rows = items.map(item => `
            <tr>
                <td class="component-name">${item.componentName || item.componentCode || '-'}</td>
                <td class="text-right">${fmt(item.baseAmount || item.amount)}</td>
                <td class="text-center">${item.isProrated ? `${(item.proratedFactor * 100).toFixed(1)}%` : '100%'}</td>
                <td class="text-right amount-cell">${fmt(item.amount)}</td>
            </tr>
        `).join('');

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
     * @param {object} displayOptions - Display options
     * @param {boolean} displayOptions.hideOrganizationalOverhead - Hide items with employerPortion='organizational_overhead'
     */
    function buildDeductionsSection(proof, fmt, displayOptions = {}) {
        let items = proof.deductionItems || [];
        if (items.length === 0) return '';

        // ESS mode: Filter out organizational overhead items (not visible to employees)
        if (displayOptions.hideOrganizationalOverhead) {
            items = items.filter(item => item.employerPortion !== 'organizational_overhead');
        }

        // If no items remain after filtering, don't show the section
        if (items.length === 0) return '';

        // Calculate visible total (sum of filtered items)
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

        // Use filtered total in ESS mode, original total otherwise
        const displayTotal = displayOptions.hideOrganizationalOverhead ? visibleTotal : proof.totalDeductions;

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
                    <td class="text-left" style="font-size: 0.85rem; color: var(--text-secondary);">${item.reason || '-'}</td>
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
                    <td class="text-left" style="font-size: 0.85rem; color: var(--text-secondary);">${item.reason || '-'}</td>
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

                    <div class="adjustment-net-impact" style="margin-top: 1rem; padding: 0.75rem; background: var(--bg-tertiary); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 500;">Net Impact from Adjustments</span>
                        <span class="${netClass}" style="font-size: 1.1rem; font-weight: 600;">${netSign}${fmt(Math.abs(netAdjustment))}</span>
                    </div>
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

                    <!-- Final Tax Calculation -->
                    <div class="tax-final">
                        <div class="tax-line">
                            <span>Tax After Rebate</span>
                            <span>${fmt(tax.taxAfterRebate)}</span>
                        </div>
                        ${tax.surchargeAmount > 0 ? `
                            <div class="tax-line">
                                <span>${tax.surchargeName || 'Surcharge'} (${pct(tax.surchargePercentage)})</span>
                                <span>+ ${fmt(tax.surchargeAmount)}</span>
                            </div>
                        ` : ''}
                        ${tax.cessAmount > 0 ? `
                            <div class="tax-line">
                                <span>${tax.cessName || 'Cess'} (${pct(tax.cessPercentage)})</span>
                                <span>+ ${fmt(tax.cessAmount)}</span>
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
                        <span class="location-icon">📍</span>
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
     * Print the calculation proof
     */
    function printCalculationProof() {
        const proofContent = document.getElementById('proofFormatted');
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

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Calculation Proof - ${proofData?.employeeName || 'Employee'}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; }
                    h1 { font-size: 18px; margin-bottom: 5px; }
                    .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
                    .proof-section { margin-bottom: 20px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
                    .proof-section-header { padding: 10px 15px; background: #f5f5f5; font-weight: 600; border-bottom: 1px solid #ddd; }
                    .proof-section-body { padding: 10px 15px; }
                    .proof-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                    .proof-item:last-child { border-bottom: none; }
                    .proof-total { display: flex; justify-content: space-between; padding: 10px 15px; background: #f5f5f5; font-weight: 700; border-top: 2px solid #ddd; }
                    .positive { color: #22c55e; }
                    .negative { color: #ef4444; }
                    @media print { body { padding: 0; } }
                </style>
            </head>
            <body>
                <h1>Calculation Proof</h1>
                <p class="meta">${proofData?.employeeName || ''} • ${proofData?.employeeCode || ''} • ${proofData?.payPeriod || ''}</p>
                ${proofContent.innerHTML}
            </body>
            </html>
        `);

        printWindow.document.close();
        printWindow.focus();

        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
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

function viewCalculationProofProcessed(payslipId) {
    return PayslipModal.viewCalculationProof(payslipId, false);
}

// ESS mode legacy alias
function viewCalculationProofProcessedEss(payslipId) {
    return PayslipModal.viewCalculationProofEss(payslipId, false);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PayslipModal, viewPayslip, viewCalculationProofProcessed, viewCalculationProofProcessedEss };
}
