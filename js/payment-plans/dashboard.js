// ============================================================
// PaymentPlans — dashboard orchestrator
// • setupSidebar() pattern copied from hrms/payroll.js verbatim
// • on tab activation, calls window['load' + TabName + 'Tab']()
//   if defined, lazy-rendering the tab module on demand
// • on first paint, loads tenant config so vocabulary is ready
// ============================================================
(function () {
    'use strict';

    const TAB_LOADERS = {
        'tenant-config':     'loadTenantConfigTab',
        'custom-fields':     'loadCustomFieldsTab',
        'status-definitions':'loadStatusDefinitionsTab',
        'plan-templates':    'loadPlanTemplatesTab',
        'mailboxes':         'loadPPMailboxesTab',       // stub linking to CRM Settings
        'email-templates':   'loadPPEmailTemplatesTab',  // stub linking to CRM Settings
        'reminder-templates':'loadReminderTemplatesTab',
        'cohorts-payers':    'loadCohortsPayersTab',
        'plans':             'loadPlansTab',
        'payments':          'loadPaymentsTab',
        'bulk-import':       'loadBulkImportTab',
        'aging':             'loadAgingTab',
        'reminder-log':      'loadReminderLogTab'
    };

    function setupSidebar() {
        const toggle = document.getElementById('sidebarToggle');
        const sidebar = document.getElementById('paymentPlansSidebar');
        const container = document.querySelector('.hrms-container');
        const overlay = document.getElementById('sidebarOverlay');
        const activeTabName = document.getElementById('activeTabName');
        if (!toggle || !sidebar) return;

        // Default-open on desktop, default-closed on mobile
        if (window.innerWidth > 1024) {
            toggle.classList.add('active');
            sidebar.classList.add('open');
            container?.classList.add('sidebar-open');
        }

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            sidebar.classList.toggle('open');
            container?.classList.toggle('sidebar-open');
            if (window.innerWidth <= 1024) overlay?.classList.toggle('active');
        });
        overlay?.addEventListener('click', () => {
            toggle.classList.remove('active');
            sidebar.classList.remove('open');
            container?.classList.remove('sidebar-open');
            overlay.classList.remove('active');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        });
        // Collapsible nav groups
        document.querySelectorAll('.nav-group-header').forEach(h => {
            h.addEventListener('click', () => h.closest('.nav-group')?.classList.toggle('collapsed'));
        });
        // Tab switching
        document.querySelectorAll('.sidebar-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });
    }

    function switchTab(tabKey) {
        // Toggle sidebar btn active state
        document.querySelectorAll('.sidebar-btn[data-tab]').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tabKey);
        });
        // Toggle tab-content active state
        const allTabs = document.querySelectorAll('.tab-content');
        allTabs.forEach(t => t.classList.toggle('active', t.id === `tab-${tabKey}`));
        // Update title
        const tabContent = document.getElementById(`tab-${tabKey}`);
        const name = tabContent?.dataset.tabName || tabKey;
        document.getElementById('activeTabName').textContent = name;
        document.getElementById('breadcrumbCurrent').textContent = `Payment Plans / ${name}`;
        // Lazy-load tab module
        const loader = TAB_LOADERS[tabKey];
        if (loader && typeof window[loader] === 'function') {
            try {
                window[loader](tabContent);
            } catch (e) {
                console.error(`[paymentplans] tab loader '${loader}' failed`, e);
                if (tabContent && !tabContent.dataset.hadError) {
                    tabContent.innerHTML = `<div class="pp-error">Failed to load: ${e.message}</div>`;
                    tabContent.dataset.hadError = '1';
                }
            }
        }
        // Close sidebar on mobile after pick
        if (window.innerWidth <= 1024) {
            document.getElementById('sidebarToggle')?.classList.remove('active');
            document.getElementById('paymentPlansSidebar')?.classList.remove('open');
            document.querySelector('.hrms-container')?.classList.remove('sidebar-open');
            document.getElementById('sidebarOverlay')?.classList.remove('active');
        }
    }

    function init() {
        // Render the chrome (sidebar/tabs) synchronously and never block on
        // network — the dashboard must be interactive even if the backend
        // can't be reached. Tabs load their own data on activation.
        setupSidebar();
        switchTab('tenant-config');
    }

    function applyVocabulary() {
        // Replace data-vocab labels with tenant terms
        document.querySelectorAll('[data-vocab]').forEach(el => {
            const key = el.dataset.vocab;
            if (key === 'cohorts-payers') {
                el.textContent = `${window.PP.groupPlural} & ${window.PP.payerPlural}`;
            } else if (key === 'plans') {
                el.textContent = window.PP.vocab('plan_plural', `${window.PP.planLabel}s`);
            }
        });
    }

    // Expose for other modules
    window.PP_Dashboard = { switchTab, setupSidebar };

    document.addEventListener('DOMContentLoaded', init);
})();
