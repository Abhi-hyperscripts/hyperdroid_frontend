/**
 * CRM Settings Page JavaScript
 * Handles pipeline stages, Facebook integration, and lead sources configuration
 */

let dealStages = [];
let facebookPages = [];
let editingStageId = null;
let deletingStageId = null;
let stageTypeDropdown = null;
let defaultCurrencyDropdown = null;

// Utility function to escape HTML special characters
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = text;
    // Quote-safe. Serialising a TEXT node to innerHTML escapes & < > and
    // nothing else, so a value containing a double quote used to break
    // straight out of any quoted HTML attribute it was interpolated into
    // — and lead names, company names and WhatsApp display names all
    // arrive from outside. Over-escaping is free in text context, where
    // &quot; renders as a plain quote.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A value going into a JS STRING inside an inline handler needs BOTH
// escapings, and HTML-escaping alone cannot do it. The parser decodes
// entities in an attribute BEFORE the JS is parsed, so &#39; becomes a
// real quote again and `');alert(1);//` still breaks out — verified in a
// browser, see tests/security/escaper-quote-safety.spec.js.
//
// JS-escape first, then HTML-escape: the backslash survives as \&#39;,
// decodes to \' and reaches JS as an escaped quote. It also fixes an
// ordinary bug — a lead called O'Brien currently breaks these handlers
// outright with a syntax error.
function escapeHtmlJsAttr(s) {
    return escapeHtml(String(s ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n'));
}

// Format date for display
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Initialization ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    // Only CRM_ADMIN or SUPERADMIN can access settings. Read roles from the JWT
    // (getUserRoles), not the stored user — a just-promoted admin's stored copy
    // can lag and would wrongly bounce them to dashboard until re-login.
    const roles = getUserRoles();
    if (!roles.includes('CRM_ADMIN') && !roles.includes('SUPERADMIN')) {
        Toast.error('Access denied — Settings is only available to CRM Admins');
        window.location.href = 'dashboard.html';
        return;
    }

    Navigation.init('crm', '../');

    // Setup sidebar
    setupSettingsSidebar();

    // Check for OAuth callback parameters
    handleOAuthCallback();

    initSearchableDropdowns();

    // Show "Danger Zone" tab only for SUPERADMIN — CRM_ADMIN doesn't get
    // the destructive wipe operations because they're a tenant-scoped reset.
    if (roles.includes('SUPERADMIN')) {
        const dz = document.getElementById('dangerZoneTabBtn');
        if (dz) dz.style.display = '';
        // CRM Users tab is also SUPERADMIN-only — writes a rep's phone via
        // Auth gRPC, which is a cross-tenant-sensitive op gated server-side.
        const cu = document.getElementById('crmUsersTabBtn');
        if (cu) cu.style.display = '';
    }

    // If the user was bounced here by CrmSetupGuard because the tenant
    // hasn't configured functional groups + teams yet, surface a banner so
    // they understand why they landed here instead of the page they
    // pasted into the URL bar.
    maybeShowSetupBanner();

    // Load initial data
    await loadGeneralSettings();
    await loadDealStages();

    // Build the 3-step setup-progress strip (Pipeline → FG → Teams) and
    // apply locked-tab state so superadmins can't fast-forward to
    // Integrations/Mailboxes/etc. before the prereqs are configured.
    await refreshSetupProgress();

    // Deep-link tab switch. Campaigns has its own prefill logic so skip it
    // here; the other tabs just need the sidebar button re-clicked.
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    const KNOWN_TABS = ['general','pipeline','lead-fields','integrations','mailboxes','templates','campaigns','lead-sources','functional-groups','teams','crm-users','danger-zone'];
    if (urlTab && urlTab !== 'campaigns' && KNOWN_TABS.includes(urlTab)) {
        switchSettingsTab(urlTab);
    }
});

// ─── 3-step setup progress (Pipeline → Functional Groups → Teams) ─────────
//
// Tenant superadmins must configure these in order. The sidebar tabs for
// dependent steps are locked until prerequisites are satisfied; settings
// content for everything past Teams (Integrations, Mailboxes, Templates,
// Campaigns, Lead Sources) is also gated until all three are done.
//
// Source-of-truth probe: counts on /crm/deal-stages,
// /crm/functional-areas, /crm/teams. These are the same lists the
// per-tab loaders fetch, so this is a cheap pre-check.
//
// Backend MUST also enforce these prerequisites (see Setup status endpoint
// + per-controller validation) so a hand-crafted curl can't bypass the UI.

const SETUP_TABS_PIPELINE_DONE_REQUIRED = ['functional-groups'];
const SETUP_TABS_FG_DONE_REQUIRED = ['teams'];
const SETUP_TABS_ALL_DONE_REQUIRED = ['integrations', 'mailboxes', 'templates', 'campaigns', 'lead-sources'];

async function fetchSetupStatus() {
    try {
        const [stages, fgs, teams] = await Promise.all([
            api.request('/crm/deal-stages').catch(() => []),
            api.request('/crm/functional-areas').catch(() => []),
            api.request('/crm/teams').catch(() => []),
        ]);
        const stagesArr = Array.isArray(stages) ? stages : (stages?.items || []);
        const fgArr = Array.isArray(fgs) ? fgs : (fgs?.items || []);
        const teamArr = Array.isArray(teams) ? teams : (teams?.items || []);
        return {
            hasPipeline: stagesArr.length > 0,
            hasFunctionalGroups: fgArr.length > 0,
            hasTeams: teamArr.length > 0,
        };
    } catch (e) {
        console.warn('[setup-progress] probe failed:', e);
        // Fail open so a network blip doesn't lock the whole settings page.
        return { hasPipeline: true, hasFunctionalGroups: true, hasTeams: true, _failed: true };
    }
}

window._crmSetupStatus = null;

async function refreshSetupProgress() {
    const status = await fetchSetupStatus();
    window._crmSetupStatus = status;
    renderSetupProgress(status);
    applySetupTabLocks(status);
}

function renderSetupProgress(status) {
    const host = document.getElementById('crmSetupProgress');
    if (!host) return;

    const allDone = status.hasPipeline && status.hasFunctionalGroups && status.hasTeams;
    if (allDone || status._failed) {
        host.style.display = 'none';
        host.innerHTML = '';
        return;
    }

    // Determine which step is "current" — the first one not yet done.
    const currentTab = !status.hasPipeline ? 'pipeline'
                     : !status.hasFunctionalGroups ? 'functional-groups'
                     : 'teams';

    const step = (num, tab, label, done) => {
        const cls = done ? 'is-done' : (tab === currentTab ? 'is-current' : '');
        const mark = done ? '✓' : num;
        return `
            <div class="crm-setup-step ${cls}" onclick="switchSettingsTab('${tab}')" role="button" tabindex="0">
                <span class="step-num">${mark}</span>
                <span>${label}</span>
            </div>`;
    };
    const arrow = '<span class="crm-setup-step-arrow">›</span>';

    host.innerHTML = `
        <div class="crm-setup-progress-header">
            <div>
                <div class="crm-setup-progress-title">Finish CRM setup before going live</div>
                <div class="crm-setup-progress-subtitle">Configure your pipeline, then functional groups, then teams. Integrations and other settings unlock once these are done.</div>
            </div>
        </div>
        <div class="crm-setup-steps">
            ${step(1, 'pipeline', 'Pipeline', status.hasPipeline)}
            ${arrow}
            ${step(2, 'functional-groups', 'Functional Groups', status.hasFunctionalGroups)}
            ${arrow}
            ${step(3, 'teams', 'Teams', status.hasTeams)}
        </div>
    `;
    host.style.display = '';
}

function applySetupTabLocks(status) {
    const lockedTabs = new Set();
    if (!status.hasPipeline) {
        SETUP_TABS_PIPELINE_DONE_REQUIRED.forEach(t => lockedTabs.add(t));
    }
    if (!status.hasFunctionalGroups) {
        SETUP_TABS_FG_DONE_REQUIRED.forEach(t => lockedTabs.add(t));
    }
    const allPrereqs = status.hasPipeline && status.hasFunctionalGroups && status.hasTeams;
    if (!allPrereqs) {
        SETUP_TABS_ALL_DONE_REQUIRED.forEach(t => lockedTabs.add(t));
    }

    document.querySelectorAll('#settingsSidebar .sidebar-btn').forEach(btn => {
        const tab = btn.dataset.tab;
        if (!tab) return;
        if (lockedTabs.has(tab)) {
            btn.classList.add('is-locked');
            btn.dataset.lockReason = lockReasonFor(tab, status);
        } else {
            btn.classList.remove('is-locked');
            delete btn.dataset.lockReason;
        }
    });
}

function lockReasonFor(tab, status) {
    if (!status.hasPipeline) return 'Configure your Pipeline first.';
    if (!status.hasFunctionalGroups) return 'Configure Functional Groups first.';
    if (!status.hasTeams) return 'Configure Teams first.';
    return '';
}

function maybeShowSetupBanner() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('setup') !== '1') return;
    // Inject a top-of-page notice. Uses the existing crm-alert styling so
    // it stays on-theme, and auto-removes itself if the admin navigates to
    // any other tab (they've seen the message).
    const host = document.querySelector('.crm-settings-content') || document.body;
    if (!host || document.getElementById('crmSetupBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'crmSetupBanner';
    banner.className = 'crm-alert crm-alert-warning';
    banner.style.cssText = 'margin:0 0 16px; display:flex; align-items:center; gap:10px;';
    banner.innerHTML = `
        <strong>Finish CRM setup first.</strong>
        Configure functional groups and at least one team before managing leads, deals, or campaigns.
        <button type="button" class="btn btn-sm btn-link" style="margin-left:auto;" onclick="document.getElementById('crmSetupBanner').remove()">Dismiss</button>
    `;
    host.prepend(banner);
}

function initSearchableDropdowns() {
    if (typeof convertSelectToSearchable !== 'function') return;

    if (!stageTypeDropdown) {
        stageTypeDropdown = convertSelectToSearchable('stageType', {
            placeholder: 'Select type...',
            searchPlaceholder: 'Search...'
        });
    }

    // Populate before converting — see the note in deals.js. This page
    // offered 12 of the 41 currencies AccountsService denominates invoices in.
    if (typeof populateCurrencySelect === 'function') populateCurrencySelect('defaultCurrency', true);

    if (!defaultCurrencyDropdown) {
        defaultCurrencyDropdown = convertSelectToSearchable('defaultCurrency', {
            placeholder: 'Select currency...',
            searchPlaceholder: 'Search currencies...'
        });
    }
}

// ─── OAuth Callback Handler ─────────────────────────────────────────────────

function handleOAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const tab = urlParams.get('tab');
    const status = urlParams.get('status');

    if (tab === 'integrations') {
        switchTab('integrations');

        if (status === 'connected') {
            document.getElementById('oauthSuccessAlert').style.display = 'flex';
            loadFacebookPages();

            // Auto-hide after 5 seconds
            setTimeout(() => {
                document.getElementById('oauthSuccessAlert').style.display = 'none';
            }, 5000);
        } else if (status === 'error') {
            document.getElementById('oauthErrorAlert').style.display = 'flex';

            setTimeout(() => {
                document.getElementById('oauthErrorAlert').style.display = 'none';
            }, 5000);
        }

        // Google Sheets OAuth callback — same URL, different param set.
        const googleStatus = params.get('google_status');
        const googleEmail = params.get('google_email');
        const googleError = params.get('google_error');
        if (googleStatus === 'connected') {
            const el = document.getElementById('gsConnectedAlert');
            const txt = document.getElementById('gsConnectedAlertText');
            if (el && txt) {
                txt.textContent = googleEmail ? `Connected: ${googleEmail}` : 'Google account connected.';
                el.style.display = 'flex';
                setTimeout(() => { el.style.display = 'none'; }, 6000);
            }
            // Refresh the card + kick the new user straight into picking a sheet.
            loadGoogleSheetsState().then(() => openGoogleSheetPicker());
        } else if (googleStatus === 'error') {
            const el = document.getElementById('gsErrorAlert');
            const txt = document.getElementById('gsErrorAlertText');
            if (el && txt) {
                txt.textContent = `Google connection failed: ${googleError || 'unknown error'}`;
                el.style.display = 'flex';
                setTimeout(() => { el.style.display = 'none'; }, 8000);
            }
        }

        // Clean URL without reloading
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
}

// ─── Sidebar Setup ──────────────────────────────────────────────────────────

const settingsTabNames = {
    'general': 'General',
    'pipeline': 'Pipeline',
    'integrations': 'Integrations',
    'mailboxes': 'Mailboxes',
    'lead-sources': 'Lead Sources',
    'functional-groups': 'Functional Groups',
    'teams': 'Teams Setup',
    'crm-users': 'CRM Users'
};

function setupSettingsSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('settingsSidebar');
    const container = document.querySelector('.crm-settings-container');
    const overlay = document.getElementById('sidebarOverlay');

    if (!toggle || !sidebar) return;

    // Open sidebar by default on desktop, closed on mobile
    if (window.innerWidth > 1024) {
        toggle.classList.add('active');
        sidebar.classList.add('open');
        container?.classList.add('sidebar-open');
    } else {
        toggle.classList.remove('active');
        sidebar.classList.remove('open');
        container?.classList.remove('sidebar-open');
        overlay?.classList.remove('active');
    }

    // Toggle sidebar
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        sidebar.classList.toggle('open');
        container?.classList.toggle('sidebar-open');
        if (window.innerWidth <= 1024) {
            overlay?.classList.toggle('active');
        }
    });

    // Close sidebar on overlay click (mobile)
    overlay?.addEventListener('click', () => {
        closeSidebar();
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });

    // Handle window resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 1024) {
                toggle.classList.add('active');
                sidebar.classList.add('open');
                container?.classList.add('sidebar-open');
                overlay?.classList.remove('active');
            } else {
                toggle.classList.remove('active');
                sidebar.classList.remove('open');
                container?.classList.remove('sidebar-open');
                overlay?.classList.remove('active');
            }
        }, 150);
    });
}

function closeSidebar() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('settingsSidebar');
    const container = document.querySelector('.crm-settings-container');
    const overlay = document.getElementById('sidebarOverlay');

    toggle?.classList.remove('active');
    sidebar?.classList.remove('open');
    container?.classList.remove('sidebar-open');
    overlay?.classList.remove('active');
}

function toggleSettingsSidebar() {
    document.getElementById('sidebarToggle')?.click();
}

// ─── Tab Switching ──────────────────────────────────────────────────────────

function switchSettingsTab(tabName) {
    // Block locked tabs — surfaced via setup-progress (Pipeline → FG → Teams).
    // The progress strip already explains why; this is the safety net for
    // direct sidebar clicks. The General tab is always allowed so the user
    // never gets fully stuck.
    const targetBtn = document.querySelector(`#settingsSidebar .sidebar-btn[data-tab="${tabName}"]`);
    if (targetBtn && targetBtn.classList.contains('is-locked')) {
        const reason = targetBtn.dataset.lockReason || 'Finish the previous setup step first.';
        if (typeof Toast !== 'undefined' && Toast.warning) {
            Toast.warning(reason);
        } else {
            console.warn('[settings] tab locked:', tabName, reason);
        }
        return;
    }

    // Update sidebar buttons
    document.querySelectorAll('#settingsSidebar .sidebar-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.crm-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Update active tab title
    const activeTabName = document.getElementById('activeTabName');
    if (activeTabName && settingsTabNames[tabName]) {
        activeTabName.textContent = settingsTabNames[tabName];
    }

    // On mobile, close sidebar after switching
    if (window.innerWidth <= 1024) {
        closeSidebar();
    }

    // Load tab-specific data
    if (tabName === 'general') {
        loadGeneralSettings();
    } else if (tabName === 'integrations') {
        loadFacebookPages();
        loadGoogleSheetsState();
        if (typeof loadWhatsAppNumbers === 'function') loadWhatsAppNumbers();
        if (typeof loadKnowledgeBase === 'function') loadKnowledgeBase();
        if (typeof loadAiAssistant === 'function') loadAiAssistant();
    } else if (tabName === 'lead-fields' && typeof loadLeadFieldsTab === 'function') {
        loadLeadFieldsTab();
    } else if (tabName === 'lead-sources') {
        loadLeadSources();
    } else if (tabName === 'functional-groups' && typeof loadFunctionalGroups === 'function') {
        loadFunctionalGroups();
    } else if (tabName === 'teams' && typeof loadTeamsTab === 'function') {
        loadTeamsTab();
    } else if (tabName === 'mailboxes' && typeof loadMailboxesTab === 'function') {
        loadMailboxesTab();
        // Phase 3 unified-mailbox picker — loads alongside the legacy mailbox table.
        if (typeof refreshSharedMailboxPicker === 'function') refreshSharedMailboxPicker();
        // Outbox: sent mail + replies. Mount is idempotent (binds its delegated
        // listener once per container) so re-entering the tab only refetches.
        if (typeof EmailOutbox !== 'undefined') {
            EmailOutbox.mount(document.getElementById('emailOutboxSection'));
        }
    } else if (tabName === 'templates' && typeof loadTemplatesTab === 'function') {
        loadTemplatesTab();
    } else if (tabName === 'automations' && typeof loadAutomationsTab === 'function') {
        loadAutomationsTab();
    } else if (tabName === 'campaigns' && typeof loadCampaignsTab === 'function') {
        loadCampaignsTab();
    } else if (tabName === 'crm-users' && typeof loadCrmUsersTab === 'function') {
        loadCrmUsersTab();
    }
}

// Legacy alias for OAuth callback
function switchTab(tabName) {
    switchSettingsTab(tabName);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PIPELINE / DEAL STAGES
// ═══════════════════════════════════════════════════════════════════════════

async function loadDealStages() {
    try {
        showPipelineLoading(true);
        const result = await api.request('/crm/deal-stages');
        dealStages = result || [];
        renderStages();
    } catch (error) {
        console.error('Error loading deal stages:', error);
        Toast.error('Failed to load deal stages');
        dealStages = [];
        renderStages();
    } finally {
        showPipelineLoading(false);
        // After any pipeline mutation (load includes the post-save reload),
        // re-evaluate the setup progress strip + tab locks.
        if (typeof refreshSetupProgress === 'function') refreshSetupProgress();
    }
}

function renderStages() {
    const list = document.getElementById('stagesList');
    const emptyState = document.getElementById('pipelineEmptyState');

    if (!dealStages.length) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Sort by order
    const sorted = [...dealStages].sort((a, b) => a.stage_order - b.stage_order);

    list.innerHTML = sorted.map((stage, index) => `
        <div class="stage-card" data-stage-id="${stage.id}">
            <div class="stage-card-info">
                <div class="stage-color-dot" style="background: ${escapeHtml(stage.color || '#3b82f6')};"></div>
                <div>
                    <div class="stage-name">${escapeHtml(stage.stage_name)}</div>
                    <div class="stage-meta">
                        <span class="stage-type-badge ${stage.stage_type}">${escapeHtml(stage.stage_type)}</span>
                        <span>Order: ${stage.stage_order}</span>
                        <span>Win: ${stage.win_probability}%</span>
                    </div>
                </div>
            </div>
            <div class="stage-actions">
                <button title="Move Up" onclick="moveStage('${stage.id}', 'up')" ${index === 0 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button title="Move Down" onclick="moveStage('${stage.id}', 'down')" ${index === sorted.length - 1 ? 'disabled style="opacity: 0.3; cursor: default;"' : ''}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button title="Edit" onclick="openEditStageModal('${stage.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
                <button class="delete" title="Delete" onclick="openDeleteStageModal('${stage.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// ─── Move / Reorder Stages ──────────────────────────────────────────────────

async function moveStage(stageId, direction) {
    const sorted = [...dealStages].sort((a, b) => a.stage_order - b.stage_order);
    const index = sorted.findIndex(s => s.id === stageId);

    if (index < 0) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sorted.length - 1) return;

    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    // Swap orders
    const temp = sorted[index].stage_order;
    sorted[index].stage_order = sorted[swapIndex].stage_order;
    sorted[swapIndex].stage_order = temp;

    // Build reorder payload
    const stages = sorted.map(s => ({
        stage_id: s.id,
        new_order: s.stage_order
    }));

    try {
        await api.request('/crm/deal-stages/reorder', {
            method: 'PUT',
            body: JSON.stringify({ stages })
        });

        // Update local state
        dealStages = sorted;
        renderStages();
        Toast.success('Stages reordered');
    } catch (error) {
        console.error('Error reordering stages:', error);
        Toast.error('Failed to reorder stages');
        await loadDealStages(); // Reload to restore server state
    }
}

// ─── Seed Defaults ──────────────────────────────────────────────────────────

async function seedDefaultStages() {
    try {
        await api.request('/crm/deal-stages/seed-defaults', {
            method: 'POST'
        });
        Toast.success('Default stages seeded successfully');
        await loadDealStages();
    } catch (error) {
        console.error('Error seeding defaults:', error);
        Toast.error(error.message || 'Failed to seed default stages');
    }
}

// ─── Stage Modal: Create ────────────────────────────────────────────────────

function openCreateStageModal() {
    editingStageId = null;
    document.getElementById('stageModalTitle').textContent = 'New Deal Stage';
    document.getElementById('stageSubmitBtn').textContent = 'Create Stage';
    document.getElementById('stageForm').reset();
    document.getElementById('stageId').value = '';
    document.getElementById('stageColor').value = '#3b82f6';
    if (stageTypeDropdown) stageTypeDropdown.setValue('open');

    // Set order to max + 1
    const maxOrder = dealStages.reduce((max, s) => Math.max(max, s.stage_order), 0);
    document.getElementById('stageOrder').value = maxOrder + 1;

    openModal('stageModal');
}

// ─── Stage Modal: Edit ──────────────────────────────────────────────────────

function openEditStageModal(id) {
    const stage = dealStages.find(s => s.id === id);
    if (!stage) return;

    editingStageId = id;
    document.getElementById('stageModalTitle').textContent = 'Edit Deal Stage';
    document.getElementById('stageSubmitBtn').textContent = 'Update Stage';

    document.getElementById('stageId').value = id;
    document.getElementById('stageName').value = stage.stage_name || '';
    document.getElementById('stageType').value = stage.stage_type || 'open';
    if (stageTypeDropdown) stageTypeDropdown.setValue(stage.stage_type || 'open');
    document.getElementById('stageOrder').value = stage.stage_order || 0;
    document.getElementById('stageWinProbability').value = stage.win_probability || 0;
    document.getElementById('stageColor').value = stage.color || '#3b82f6';

    openModal('stageModal');
}

function closeStageModal() {
    closeModal('stageModal');
    editingStageId = null;
}

// ─── Stage Modal: Delete ────────────────────────────────────────────────────

function openDeleteStageModal(id) {
    const stage = dealStages.find(s => s.id === id);
    if (!stage) return;

    deletingStageId = id;
    document.getElementById('deleteStageName').textContent = stage.stage_name || '';
    openModal('deleteStageModal');
}

function closeDeleteStageModal() {
    closeModal('deleteStageModal');
    deletingStageId = null;
}

// ─── Stage Form Submit ──────────────────────────────────────────────────────

async function handleStageSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('stageSubmitBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span>Saving...';

    try {
        if (editingStageId) {
            // Update only editable fields
            const payload = {
                stage_name: document.getElementById('stageName').value.trim(),
                stage_type: (stageTypeDropdown ? stageTypeDropdown.getValue() : document.getElementById('stageType').value),
                win_probability: parseFloat(document.getElementById('stageWinProbability').value) || 0,
                color: document.getElementById('stageColor').value || null
            };

            await api.request(`/crm/deal-stages/${editingStageId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            Toast.success('Stage updated successfully');
        } else {
            const payload = {
                pipeline_name: 'Default',
                stage_name: document.getElementById('stageName').value.trim(),
                stage_order: parseInt(document.getElementById('stageOrder').value) || 0,
                stage_type: (stageTypeDropdown ? stageTypeDropdown.getValue() : document.getElementById('stageType').value),
                win_probability: parseFloat(document.getElementById('stageWinProbability').value) || 0,
                color: document.getElementById('stageColor').value || null
            };

            await api.request('/crm/deal-stages', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            Toast.success('Stage created successfully');
        }

        closeStageModal();
        await loadDealStages();
    } catch (error) {
        console.error('Error saving stage:', error);
        Toast.error(error.message || 'Failed to save stage');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ─── Delete Stage ───────────────────────────────────────────────────────────

async function confirmDeleteStage() {
    if (!deletingStageId) return;

    const deleteBtn = document.getElementById('confirmDeleteStageBtn');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="btn-spinner"></span>Deleting...';

    try {
        await api.request(`/crm/deal-stages/${deletingStageId}`, {
            method: 'DELETE'
        });
        Toast.success('Stage deleted successfully');
        closeDeleteStageModal();
        await loadDealStages();
    } catch (error) {
        console.error('Error deleting stage:', error);
        Toast.error(error.message || 'Failed to delete stage');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  GENERAL SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

async function loadGeneralSettings() {
    const loading = document.getElementById('generalLoading');
    const form = document.getElementById('generalSettingsForm');

    try {
        if (loading) loading.style.display = 'flex';
        if (form) form.style.display = 'none';

        const [currencyResp, ownerLabelResp, dimLabelResp, dimFieldResp, leadFieldsResp, aiStatusResp] = await Promise.all([
            api.request('/crm/crm-settings/default_currency'),
            api.request('/crm/crm-settings/report_owner_label').catch(() => null),
            api.request('/crm/crm-settings/report_dimension_label').catch(() => null),
            api.request('/crm/crm-settings/report_dimension_field').catch(() => null),
            api.request('/crm/lead-fields?includeInactive=false').catch(() => null),
            // ai-status: fail-closed; on error the section stays hidden.
            api.request('/crm/crm-settings/ai-status').catch(() => null)
        ]);

        // AI section visibility — backend tells us whether the tenant has
        // BOTH active gladia/stt + anthropic/llm keys. Without them, the
        // entire section stays display:none (per spec, no toggle, no
        // "request access" CTA). With them, render the toggle + pre-check
        // from the stored ai_enabled setting.
        renderAiSection(aiStatusResp);

        const currency = (currencyResp && currencyResp.value) ? currencyResp.value : 'USD';
        const select = document.getElementById('defaultCurrency');
        if (select) select.value = currency;
        if (defaultCurrencyDropdown) defaultCurrencyDropdown.setValue(currency);

        const ownerLabel = document.getElementById('reportOwnerLabel');
        if (ownerLabel) ownerLabel.value = (ownerLabelResp?.value) || 'Salesperson';

        const dimLabel = document.getElementById('reportDimensionLabel');
        if (dimLabel) dimLabel.value = (dimLabelResp?.value) || 'Source';

        const dimField = document.getElementById('reportDimensionField');
        if (dimField) {
            // Append a row per active custom dropdown so a tenant can pivot
            // the report by their own taxonomy (e.g. "Course" custom field).
            const fields = leadFieldsResp?.fields || [];
            for (const f of fields) {
                if (!f || !f.code || !f.label) continue;
                const opt = document.createElement('option');
                opt.value = `lf_${f.code}`;
                opt.textContent = `${f.label} (custom)`;
                dimField.appendChild(opt);
            }
            dimField.value = (dimFieldResp?.value) || 'lead_source';
        }
    } catch (error) {
        console.error('Error loading general settings:', error);
    } finally {
        if (loading) loading.style.display = 'none';
        if (form) form.style.display = 'block';
    }
}

/**
 * Render the AI section iff the backend says both required keys (gladia/stt
 * and anthropic/llm) are present + active on Auth's tenant_api_keys.
 *
 * The whole section's display state is controlled here — there's no
 * "request access" CTA when the preconditions aren't met (per the spec).
 * If a tenant lacks one or both keys, they don't even see this surface,
 * which is the correct UX: the admin who can fix it does that in Auth's
 * Tenant Settings → API Keys page, not in CRM.
 */
function renderAiSection(aiStatusResp) {
    const section = document.getElementById('aiSettingsSection');
    if (!section) return;

    const hasKeys = !!(aiStatusResp && aiStatusResp.has_required_keys);
    if (!hasKeys) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    const toggle = document.getElementById('aiEnabledToggle');
    const hint = document.getElementById('aiToggleHint');
    if (toggle) toggle.checked = !!aiStatusResp.ai_enabled;
    if (hint) hint.textContent = aiHintText(!!aiStatusResp.ai_enabled);

    // Auto-status toggle reuses the same surface — it's still an
    // AI-adjacent automation. Read the current value via getAllSettings
    // and reflect it. Default-on per backend defaults.
    loadAutoStatusToggle();

    // Tier-2 transcription tuning. Loaded silently so the form reflects
    // current values when the admin expands the <details> panel.
    loadAiTuning();
}

async function loadAutoStatusToggle() {
    const toggle = document.getElementById('autoStatusToggle');
    const hint = document.getElementById('autoStatusToggleHint');
    if (!toggle) return;
    try {
        const settings = await api.request('/crm/crm-settings');
        const enabled = String((settings || {}).auto_status_on_connect_enabled ?? 'true').toLowerCase() === 'true';
        toggle.checked = enabled;
        if (hint) hint.textContent = autoStatusHintText(enabled);
    } catch (err) {
        console.error('Failed to load auto_status setting', err);
    }
}

function autoStatusHintText(enabled) {
    return enabled
        ? 'On — when a connected call (any provider) reaches a lead in Assigned, the system flips it to Contacted automatically.'
        : "Off — reps must manually change the lead status after every call.";
}

async function onAutoStatusToggleChange(event) {
    const toggle = event && event.target;
    const next = !!(toggle && toggle.checked);
    const hint = document.getElementById('autoStatusToggleHint');
    if (hint) hint.textContent = autoStatusHintText(next);
    try {
        await api.request('/crm/crm-settings/auto_status_on_connect_enabled', {
            method: 'PUT',
            body: JSON.stringify({ value: next ? 'true' : 'false' }),
        });
        Toast.success(next ? 'Auto status enabled' : 'Auto status disabled');
    } catch (err) {
        console.error('Failed to update auto_status setting', err);
        if (toggle) toggle.checked = !next;
        if (hint) hint.textContent = autoStatusHintText(!next);
        Toast.error('Could not update setting. Please try again.');
    }
}
window.onAutoStatusToggleChange = onAutoStatusToggleChange;

/**
 * Single source of truth for the AI hint text — keeps both states
 * descriptive ("On — your team will see AI surfaces…" vs "Off — your
 * team won't see AI surfaces until you flip this on.") instead of just
 * the bare "On"/"Off" toggle state.
 */
function aiHintText(enabled) {
    return enabled
        ? 'On — every new call recording gets a transcript and a short AI summary.'
        : "Off — recordings are kept, but transcripts and summaries won't be generated.";
}

/**
 * Toggle handler — persists the new state immediately so the admin
 * doesn't have to hit Save Settings. On failure, revert the visual
 * state so the toggle reflects what's actually stored.
 */
async function onAiToggleChange(event) {
    const toggle = event && event.target;
    const next = !!(toggle && toggle.checked);
    const hint = document.getElementById('aiToggleHint');
    if (hint) hint.textContent = aiHintText(next);

    try {
        await api.request('/crm/crm-settings/ai_enabled', {
            method: 'PUT',
            body: JSON.stringify({ value: next ? 'true' : 'false' }),
        });
        Toast.success(next ? 'AI enabled' : 'AI disabled');
    } catch (err) {
        console.error('Failed to update ai_enabled', err);
        // Revert visual state on failure so the admin doesn't think
        // the change stuck.
        if (toggle) toggle.checked = !next;
        if (hint) hint.textContent = aiHintText(!next);
        Toast.error('Could not update AI setting. Please try again.');
    }
}

// ─── Tier-2 transcription tuning ─────────────────────────────────────────
// 4 settings stored per-tenant:
//   transcription_language_hint   — e.g. "hi,en"
//   transcription_code_switching  — "true"/"false"
//   transcription_context_prompt  — free-form ≤600 chars
//   transcription_custom_vocabulary — newline-separated, ≤200 terms
//   transcription_model           — "auto"|"standard"|"enhanced"|"solaria"
async function loadAiTuning() {
    try {
        const keys = [
            'transcription_language_hint',
            'transcription_code_switching',
            'transcription_context_prompt',
            'transcription_custom_vocabulary',
            'transcription_model',
        ];
        const values = await Promise.all(keys.map(k =>
            api.request(`/crm/crm-settings/${k}`)
                .then(r => r.value)
                .catch(() => null)));
        const [lang, codeSwitch, ctx, vocab, model] = values;

        const langEl = document.getElementById('aiTuningLanguage');
        if (langEl) langEl.value = lang || 'hi,en';

        const csEl = document.getElementById('aiCodeSwitchToggle');
        if (csEl) csEl.checked = (codeSwitch || 'true') === 'true';
        updateCodeSwitchHint();

        const ctxEl = document.getElementById('aiTuningContext');
        if (ctxEl) {
            ctxEl.value = ctx || '';
            updateContextCount();
        }

        const vocabEl = document.getElementById('aiTuningVocab');
        if (vocabEl) {
            vocabEl.value = vocab || '';
            updateVocabCount();
        }

        const modelEl = document.getElementById('aiTuningModel');
        if (modelEl) modelEl.value = model || 'auto';
    } catch (err) {
        console.warn('[ai-tuning] load failed', err);
    }
}

function updateContextCount() {
    const ctxEl = document.getElementById('aiTuningContext');
    const countEl = document.getElementById('aiContextCount');
    if (ctxEl && countEl) countEl.textContent = (ctxEl.value || '').length;
}
function updateVocabCount() {
    const vocabEl = document.getElementById('aiTuningVocab');
    const countEl = document.getElementById('aiVocabCount');
    if (vocabEl && countEl) {
        const terms = (vocabEl.value || '')
            .split('\n').map(t => t.trim()).filter(t => t.length > 0);
        countEl.textContent = terms.length;
    }
}
function updateCodeSwitchHint() {
    const csEl = document.getElementById('aiCodeSwitchToggle');
    const hint = document.getElementById('aiCodeSwitchHint');
    if (!csEl || !hint) return;
    hint.textContent = csEl.checked
        ? 'On — Gladia expects mid-utterance Hindi↔English flips. Recommended whenever the call mixes languages.'
        : 'Off — Gladia treats each utterance as a single language. Slightly faster, but worse on mixed-language calls.';
}
function onAiContextInput() { updateContextCount(); }
function onAiVocabInput()   { updateVocabCount(); }
function onAiTuningChange() { updateCodeSwitchHint(); }

async function autoPopulateAiVocab() {
    try {
        const resp = await api.request('/crm/crm-settings/transcription-vocab-suggestions');
        const vocabEl = document.getElementById('aiTuningVocab');
        if (!vocabEl || !resp || !Array.isArray(resp.suggestions)) return;
        // Merge with whatever the user already typed, dedup case-insensitive.
        const existing = (vocabEl.value || '')
            .split('\n').map(t => t.trim()).filter(t => t.length > 0);
        const seen = new Set(existing.map(t => t.toLowerCase()));
        for (const s of resp.suggestions) {
            const v = (s || '').trim();
            if (v && !seen.has(v.toLowerCase())) {
                existing.push(v);
                seen.add(v.toLowerCase());
            }
        }
        vocabEl.value = existing.join('\n');
        updateVocabCount();
        Toast.success(`Added ${resp.suggestions.length} suggestion(s) to vocabulary`);
    } catch (err) {
        console.error('[ai-tuning] auto-populate failed', err);
        Toast.error('Could not load vocabulary suggestions');
    }
}

async function saveAiTuning() {
    const btn = document.getElementById('aiTuningSaveBtn');
    const spinner = document.getElementById('aiTuningSaveSpinner');
    const lang = document.getElementById('aiTuningLanguage')?.value ?? '';
    const codeSwitch = document.getElementById('aiCodeSwitchToggle')?.checked ?? false;
    const ctx = document.getElementById('aiTuningContext')?.value ?? '';
    const vocab = document.getElementById('aiTuningVocab')?.value ?? '';
    const model = document.getElementById('aiTuningModel')?.value ?? 'auto';

    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';
    try {
        // Sequential so the backend's per-key validation errors are
        // attributable. Promise.all would race + lose the first failed key.
        const puts = [
            ['transcription_language_hint',     lang || 'hi,en'],
            ['transcription_code_switching',    codeSwitch ? 'true' : 'false'],
            ['transcription_context_prompt',    ctx],
            ['transcription_custom_vocabulary', vocab],
            ['transcription_model',             model],
        ];
        for (const [key, value] of puts) {
            await api.request(`/crm/crm-settings/${key}`, {
                method: 'PUT',
                body: JSON.stringify({ value }),
            });
        }
        Toast.success('Transcription tuning saved');
    } catch (err) {
        console.error('Failed to save transcription tuning', err);
        Toast.error(err?.message || 'Could not save tuning');
    } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

window.onAiTuningChange = onAiTuningChange;
window.onAiContextInput = onAiContextInput;
window.onAiVocabInput = onAiVocabInput;
window.autoPopulateAiVocab = autoPopulateAiVocab;
window.saveAiTuning = saveAiTuning;
window.loadAiTuning = loadAiTuning;

async function saveGeneralSettings() {
    const btn = document.getElementById('saveGeneralBtn');
    const spinner = document.getElementById('saveGeneralSpinner');
    const currency = defaultCurrencyDropdown ? defaultCurrencyDropdown.getValue() : document.getElementById('defaultCurrency')?.value;

    if (!currency) return;

    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        const ownerLabel = (document.getElementById('reportOwnerLabel')?.value || '').trim() || 'Salesperson';
        const dimLabel = (document.getElementById('reportDimensionLabel')?.value || '').trim() || 'Source';
        const dimField = document.getElementById('reportDimensionField')?.value || 'lead_source';

        await Promise.all([
            api.request('/crm/crm-settings/default_currency', {
                method: 'PUT',
                body: JSON.stringify({ value: currency })
            }),
            api.request('/crm/crm-settings/report_owner_label', {
                method: 'PUT',
                body: JSON.stringify({ value: ownerLabel })
            }),
            api.request('/crm/crm-settings/report_dimension_label', {
                method: 'PUT',
                body: JSON.stringify({ value: dimLabel })
            }),
            api.request('/crm/crm-settings/report_dimension_field', {
                method: 'PUT',
                body: JSON.stringify({ value: dimField })
            })
        ]);
        Toast.success('Settings saved successfully');
    } catch (error) {
        console.error('Error saving general settings:', error);
        Toast.error(error.message || 'Failed to save settings');
    } finally {
        btn.disabled = false;
        if (spinner) spinner.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  FACEBOOK INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════
//  Two connection paths:
//    1. System User token (primary) — tenant generates in their own Business
//       Manager, pastes it. Bypasses Meta's App Review requirement.
//    2. OAuth Login (legacy/future) — disabled in UI until Meta approves
//       leads_retrieval for our app.
//
//  Once a page is connected, tenant picks which lead forms to ingest and
//  maps each form's questions to CRM fields using the same mapping pattern
//  as the CSV importer. Leads land in the standard `leads` table and flow
//  through every downstream CRM workflow (auto-assignment, pipelines, etc).

let facebookForms = [];               // { leadSourceId, pageId, formId, sourceName, fieldMappings, ... }
let _fbStandardFields = null;          // { field_key: "Display Name" } — lazy-loaded from /leads/import/fields

async function loadFacebookPages() {
    try {
        const [pages, forms] = await Promise.all([
            api.request('/crm/facebook/pages').catch(() => []),
            api.request('/crm/facebook/forms').catch(() => [])
        ]);
        facebookPages = pages || [];
        facebookForms = forms || [];
        renderFacebookPages();
        // Wire the FacebookSynced SignalR listener so the connected-forms
        // table + Logs modal stay live without a manual refresh. Mirrors
        // the setupGoogleSheetsRealtime() call in loadGoogleSheetsState().
        setupFacebookRealtime();
    } catch (error) {
        console.error('Error loading Facebook pages:', error);
        facebookPages = [];
        facebookForms = [];
        renderFacebookPages();
    }
}

function renderFacebookPages() {
    const statusDot = document.getElementById('fbStatusDot');
    const statusText = document.getElementById('fbStatusText');
    const pagesList = document.getElementById('fbPagesList');

    const activePages = facebookPages.filter(p => p.is_active);

    if (activePages.length > 0) {
        statusDot.className = 'dot connected';
        const formsCount = facebookForms.filter(f => f.is_active).length;
        statusText.textContent = `${activePages.length} page${activePages.length > 1 ? 's' : ''} · ${formsCount} form${formsCount !== 1 ? 's' : ''}`;
        pagesList.style.display = 'block';

        pagesList.innerHTML = activePages.map(page => {
            const pageForms = facebookForms.filter(f => f.page_id === page.page_id);
            return renderFacebookPageCard(page, pageForms);
        }).join('');
        bindFacebookPagesListHandlers();
    } else {
        statusDot.className = 'dot disconnected';
        statusText.textContent = 'Not connected';
        pagesList.style.display = 'none';
        pagesList.innerHTML = '';
    }
}

function renderFacebookPageCard(page, forms) {
    const tokenSourceBadge = page.token_source === 'system_user'
        ? '<span style="font-size: 0.7em; padding: 2px 6px; background: var(--brand-primary); color: #fff; border-radius: 4px; margin-left: 6px;">System User</span>'
        : '<span style="font-size: 0.7em; padding: 2px 6px; background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 4px; margin-left: 6px;">OAuth</span>';

    // Rate-limit telemetry (May 2026). Only render the chip/badge when
    // there's something to say — a freshly connected page with no usage
    // reading yet stays visually clean.
    const usagePctChip = (page.usage_pct != null) ? renderFbUsageChip(page.usage_pct, page.usage_checked_at) : '';
    const cooldownBadge = renderFbCooldownBadge(page.cooldown_until);

    const formsHtml = forms.length > 0
        ? `<div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color-light);">
              ${forms.map(f => renderFacebookFormRow(f)).join('')}
           </div>`
        : `<div style="margin-top: 10px; padding: 8px 12px; background: var(--bg-tertiary); border-radius: 6px; font-size: 0.85em; color: var(--text-secondary);">
              No forms connected yet. Click <strong>Manage Forms</strong> to add one.
           </div>`;

    // Never interpolate page_id / page_name into an onclick string — escapeHtml only covers
    // HTML entities (&<>"), not JS-string escaping, so a page name with a single-quote would
    // break out. Use data-* attributes + event delegation (bindFacebookPagesListHandlers).
    return `
        <div class="connected-page-card" data-fb-page-id="${escapeHtml(page.page_id)}" data-fb-page-name="${escapeHtml(page.page_name)}"
             style="padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 10px; background: var(--bg-card);">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color: #1877f2; flex-shrink: 0;">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                <span style="font-weight: 600;">${escapeHtml(page.page_name)}</span>
                ${tokenSourceBadge}
                <span style="font-size: 0.8em; color: var(--text-secondary);">${page.total_leads_received} lead${page.total_leads_received !== 1 ? 's' : ''}</span>
                ${usagePctChip}
                ${cooldownBadge}
                <div style="margin-left: auto; display: flex; gap: 6px;">
                    <button type="button" class="btn btn-outline" data-fb-action="manage-forms" style="padding: 4px 10px; font-size: 0.75rem;">
                        Manage Forms
                    </button>
                    <button type="button" class="btn btn-outline" data-fb-action="disconnect-page" style="padding: 4px 10px; font-size: 0.75rem;">
                        Disconnect
                    </button>
                </div>
            </div>
            ${formsHtml}
        </div>
    `;
}

function renderFacebookFormRow(form) {
    const stateBadge = form.is_active
        ? '<span style="font-size: 0.7em; padding: 2px 6px; background: var(--color-success); color: #fff; border-radius: 4px;">Polling</span>'
        : '<span style="font-size: 0.7em; padding: 2px 6px; background: var(--bg-tertiary); color: var(--text-secondary); border-radius: 4px;">Paused</span>';

    // "Last sync" — mirrors the GS settings UI. Pending = first tick hasn't
    // happened yet; relative time (e.g. "3 min ago") for fresh syncs reads
    // more naturally than an absolute timestamp at this density.
    const lastSyncLabel = form.last_polled_at
        ? `<span style="font-size: 0.75em; color: var(--text-secondary);" title="${escapeHtml(new Date(form.last_polled_at).toLocaleString())}">Last sync: ${fbRelativeTime(form.last_polled_at)}</span>`
        : '<span style="font-size: 0.75em; color: var(--text-secondary);">Pending first sync</span>';

    // Event delegation picks up data-fb-form-action; leadSourceId lives in data-fb-source-id.
    // Sync now / Logs buttons mirror the per-row actions in the GS table — admins shouldn't
    // need to grep container logs to answer "did it sync?".
    return `
        <div style="display: flex; align-items: center; gap: 10px; padding: 6px 0; flex-wrap: wrap;"
             data-fb-source-id="${escapeHtml(form.lead_source_id || '')}"
             data-fb-active="${form.is_active ? '1' : '0'}"
             data-fb-source-name="${escapeHtml(form.source_name || '')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary); flex-shrink: 0;">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <span style="font-size: 0.9em;">${escapeHtml(form.source_name || 'Unnamed form')}</span>
            ${stateBadge}
            <span style="font-size: 0.8em; color: var(--text-secondary);">${form.total_leads_received || 0} leads</span>
            ${lastSyncLabel}
            <div style="margin-left: auto; display: flex; gap: 4px;">
                <button type="button" class="btn btn-sm btn-primary" data-fb-form-action="sync-now" title="Re-scan from connected_at. Already-imported leads stay untouched (dedup by source_lead_id)." style="padding: 2px 8px; font-size: 0.7rem;">
                    Sync now
                </button>
                <button type="button" class="btn btn-outline" data-fb-form-action="logs" style="padding: 2px 8px; font-size: 0.7rem;" title="Polling sync history — every 2-min tick the worker recorded for this form.">
                    Logs
                </button>
                <button type="button" class="btn btn-outline" data-fb-form-action="activity" style="padding: 2px 8px; font-size: 0.7rem;" title="Audit trail — who connected / paused / resumed / disconnected, with timestamps.">
                    Activity
                </button>
                <button type="button" class="btn btn-outline" data-fb-form-action="toggle" style="padding: 2px 8px; font-size: 0.7rem;">
                    ${form.is_active ? 'Pause' : 'Resume'}
                </button>
                <!-- Remove intentionally hidden (May 2026) — DELETE was a soft-
                     delete that produced the same DB state as Pause, leading
                     users to think their "removed" source had been wiped when
                     it could be Resumed in one click. Pause is the explicit
                     "stop polling" action; full disconnect is at the FB Page
                     level (Page settings → Lead Access). -->
            </div>
        </div>
    `;
}

// Meta usage_pct chip: green <70 / yellow 70-89 / red ≥90. Tooltip shows
// the absolute timestamp of when the score was captured so a stale value
// (e.g. minutes-old) doesn't mislead the user.
function renderFbUsageChip(usagePct, checkedAtIso) {
    const pct = Math.max(0, Math.min(100, Number(usagePct) || 0));
    let bg, fg;
    if (pct >= 90)      { bg = 'rgba(239,68,68,0.12)';  fg = '#b91c1c'; }
    else if (pct >= 70) { bg = 'rgba(234,179,8,0.15)';  fg = '#a16207'; }
    else                { bg = 'rgba(22,163,74,0.12)';  fg = '#15803d'; }
    const ts = checkedAtIso ? new Date(checkedAtIso).toLocaleString() : 'unknown';
    const tip = `Meta API usage at ${ts}. Score ≥ 90% triggers a soft cooldown.`;
    return `<span title="${escapeHtml(tip)}" style="font-size: 0.7em; padding: 2px 6px; background: ${bg}; color: ${fg}; border-radius: 4px;">Usage ${pct}%</span>`;
}

// Cooldown badge — only renders when an active cooldown is in effect.
// "Cooled until 14:32" reads cleaner than an absolute date for the typical
// sub-1-hour cooldown window; the tooltip carries the precise timestamp.
function renderFbCooldownBadge(cooldownUntilIso) {
    if (!cooldownUntilIso) return '';
    const until = new Date(cooldownUntilIso);
    if (until.getTime() <= Date.now()) return ''; // already expired
    const hh = until.getHours().toString().padStart(2, '0');
    const mm = until.getMinutes().toString().padStart(2, '0');
    const tip = `Page is in cooldown until ${until.toLocaleString()}. Polling resumes automatically when the window closes.`;
    return `<span title="${escapeHtml(tip)}" style="font-size: 0.7em; padding: 2px 6px; background: rgba(234,179,8,0.15); color: #a16207; border-radius: 4px;">Cooled until ${hh}:${mm}</span>`;
}

// Compact "X min ago / Y hours ago" formatter for the last-sync chip. Matches
// the GS settings vibe — a 12-min-old sync says "12 min ago", not the ISO ts
// (which is shown on hover via the title attribute).
function fbRelativeTime(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    return `${day} day${day > 1 ? 's' : ''} ago`;
}

// One-time delegation setup. Every click inside #fbPagesList is routed here.
// Avoids re-binding after every render and prevents onclick-string interpolation bugs.
let _fbPagesListBound = false;
function bindFacebookPagesListHandlers() {
    if (_fbPagesListBound) return;
    const container = document.getElementById('fbPagesList');
    if (!container) return;
    container.addEventListener('click', (ev) => {
        const pageBtn = ev.target.closest('[data-fb-action]');
        if (pageBtn) {
            const card = pageBtn.closest('[data-fb-page-id]');
            if (!card) return;
            const pageId = card.getAttribute('data-fb-page-id');
            const pageName = card.getAttribute('data-fb-page-name');
            const action = pageBtn.getAttribute('data-fb-action');
            if (action === 'manage-forms') openFacebookFormModal(pageId, pageName);
            else if (action === 'disconnect-page') disconnectFacebookPage(pageId);
            return;
        }
        const formBtn = ev.target.closest('[data-fb-form-action]');
        if (formBtn) {
            const row = formBtn.closest('[data-fb-source-id]');
            if (!row) return;
            const sourceId = row.getAttribute('data-fb-source-id');
            const isActive = row.getAttribute('data-fb-active') === '1';
            const sourceName = row.getAttribute('data-fb-source-name') || 'this form';
            const action = formBtn.getAttribute('data-fb-form-action');
            if (action === 'toggle') toggleFacebookFormSource(sourceId, !isActive);
            else if (action === 'remove') disconnectFacebookFormSource(sourceId);
            else if (action === 'sync-now') syncFacebookFormNow(sourceId, formBtn);
            else if (action === 'logs') openFacebookSyncLogs(sourceId, sourceName);
            else if (action === 'activity') openActivityLog(`/crm/Facebook/forms/${sourceId}/audit-log?limit=200`, sourceName);
        }
    });
    _fbPagesListBound = true;
}

// ─── SignalR live updates for FB forms (mirror of the GS hub wiring) ────
//
// The Hangfire FB poller fires CrmEvents.FacebookSynced on every tick per
// form. Reuses the same hub connection as GS (no second WebSocket). When a
// FacebookSynced event arrives we debounce-refresh the connected forms list
// and the Logs modal if it's open for the affected source.
let _fbSyncLogsCurrentSourceId = null;

function setupFacebookRealtime() {
    // Piggyback on the GS hub setup if it's already running. Otherwise spin
    // it up — the same hub instance handles both event streams.
    setupGoogleSheetsRealtime();
    if (!_gsHubConnection) return;
    if (_gsHubConnection._fbBound) return;

    _gsHubConnection.on('FacebookSynced', (payload) => {
        if (window._fbHubRefreshTimer) return;
        window._fbHubRefreshTimer = setTimeout(() => {
            window._fbHubRefreshTimer = null;
            loadFacebookPages().catch(e => console.warn('FB realtime refresh failed:', e));
            if (_fbSyncLogsCurrentSourceId && payload?.leadSourceId === _fbSyncLogsCurrentSourceId) {
                refreshFacebookSyncLogs();
            }
        }, 600);
    });
    _gsHubConnection._fbBound = true;
}

// Manual on-demand sync. Backend resets the cursor to NULL when fullRescan
// is true and dedups by source_lead_id, so already-imported leads are NEVER
// touched — the rescan only inserts new or previously-missed leads. Runs
// as a Hangfire background job; the UI refreshes automatically when the
// SignalR `FacebookSynced` event fires.
async function syncFacebookFormNow(sourceId, btnEl) {
    if (!sourceId) return;
    const ok = await showConfirm(
        'Re-scan this Facebook form now? Already-imported leads stay untouched (dedup by lead id) — only missing or new leads get added.',
        'Sync now',
        'primary'
    );
    if (!ok) return;
    const original = btnEl ? btnEl.textContent : null;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Queuing…'; }
    try {
        const res = await api.request(`/crm/Facebook/forms/${sourceId}/sync-now?fullRescan=true`, { method: 'POST' });
        Toast.success(res?.message || 'Sync queued — results will appear shortly.');
        // Don't poll — the FacebookSynced SignalR listener refreshes the
        // table and Logs modal as the worker completes.
    } catch (e) {
        Toast.error(e.message || 'Failed to start sync');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = original || 'Sync now';
        }
    }
}

// ─── FB sync-logs modal (mirror of the GS Logs modal) ─────────────────────

function openFacebookSyncLogs(sourceId, sourceName) {
    _fbSyncLogsCurrentSourceId = sourceId;
    const subtitle = document.getElementById('fbSyncLogsSubtitle');
    if (subtitle) subtitle.textContent = sourceName || '—';
    const modal = document.getElementById('fbSyncLogsModal');
    if (modal) modal.classList.add('active');
    refreshFacebookSyncLogs();
}

function closeFacebookSyncLogs() {
    const modal = document.getElementById('fbSyncLogsModal');
    if (modal) modal.classList.remove('active');
    _fbSyncLogsCurrentSourceId = null;
}

async function refreshFacebookSyncLogs() {
    const sourceId = _fbSyncLogsCurrentSourceId;
    if (!sourceId) return;

    const loadingEl = document.getElementById('fbSyncLogsLoading');
    const emptyEl = document.getElementById('fbSyncLogsEmpty');
    const wrapEl = document.getElementById('fbSyncLogsTableWrap');
    const tbody = document.getElementById('fbSyncLogsTableBody');

    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    try {
        const data = await api.request(`/crm/Facebook/forms/${sourceId}/sync-logs?limit=100`);
        const items = (data && data.items) || [];
        if (loadingEl) loadingEl.style.display = 'none';
        if (items.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (wrapEl) wrapEl.style.display = 'block';
        tbody.innerHTML = items.map(it => {
            const start = it.started_at ? new Date(it.started_at).toLocaleString() : '—';
            const outcome = it.outcome || 'in-flight';
            const outcomeBadge = `<span class="gs-status-badge gs-sync-${outcome}">${escapeHtml(outcome)}</span>`;
            // FB analogue of the GS "Cursor" column — show the polled-at
            // window the tick covered. "(initial)" makes "first tick after
            // connect" obviously distinct from a missing field.
            const fmtTs = (ts) => ts ? new Date(ts).toLocaleString() : '(initial)';
            const window = `${fmtTs(it.last_polled_at_before)} → ${fmtTs(it.last_polled_at_after)}`;
            const dur = it.duration_ms != null ? `${it.duration_ms} ms` : '—';
            const note = it.error_message ? escapeHtml(it.error_message) : '';
            return `
                <tr>
                    <td>${escapeHtml(start)}</td>
                    <td>${outcomeBadge}</td>
                    <td style="text-align:right;">${(it.rows_read ?? 0).toLocaleString()}</td>
                    <td style="text-align:right;">${(it.leads_created ?? 0).toLocaleString()}</td>
                    <td style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(window)}</td>
                    <td style="text-align:right;">${escapeHtml(dur)}</td>
                    <td style="max-width:380px; word-break: break-word; color: var(--text-secondary);">${note}</td>
                </tr>`;
        }).join('');
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = 'Failed to load sync history: ' + (e.message || 'unknown error');
        }
    }
}

// ─── Activity audit log modal (shared by FB forms + GS sheets) ───────────
//
// Shows who/when for connect, manual_pause, manual_resume, manual_disconnect,
// reconnected, and cascade_page_disconnect. The polling "Logs" modal still
// shows sync history — this is a separate audit trail.
let _activityLogFetchUrl = null;
let _activityLogTitleSubject = '—';

function openActivityLog(url, sourceName) {
    _activityLogFetchUrl = url;
    _activityLogTitleSubject = sourceName || '—';
    const subtitle = document.getElementById('activityLogSubtitle');
    if (subtitle) subtitle.textContent = sourceName || '—';
    const modal = document.getElementById('activityLogModal');
    if (modal) modal.classList.add('active');
    refreshActivityLog();
}

function closeActivityLog() {
    const modal = document.getElementById('activityLogModal');
    if (modal) modal.classList.remove('active');
    _activityLogFetchUrl = null;
}

// Friendlier labels for the raw `reason` codes the backend writes. New codes
// added in the audit-log writer should be added here too — fallback shows the
// raw code so a future reason isn't invisible if someone forgets.
const _activityReasonLabel = {
    'connected': 'Connected',
    'reconnected': 'Reconnected',
    'manual_pause': 'Paused',
    'manual_resume': 'Resumed',
    'manual_disconnect': 'Disconnected',
    'cascade_page_disconnect': 'Auto-paused (page disconnected)',
};

function _activityStateText(from, to) {
    const fmt = (v) => v === true ? 'Active' : v === false ? 'Inactive' : '—';
    if (from === null || from === undefined) return `→ ${fmt(to)}`;
    return `${fmt(from)} → ${fmt(to)}`;
}

async function refreshActivityLog() {
    if (!_activityLogFetchUrl) return;

    const loadingEl = document.getElementById('activityLogLoading');
    const emptyEl = document.getElementById('activityLogEmpty');
    const wrapEl = document.getElementById('activityLogTableWrap');
    const tbody = document.getElementById('activityLogTableBody');

    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    try {
        const items = await api.request(_activityLogFetchUrl) || [];
        if (loadingEl) loadingEl.style.display = 'none';
        if (!Array.isArray(items) || items.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (wrapEl) wrapEl.style.display = 'block';
        tbody.innerHTML = items.map(it => {
            const when = it.created_at ? new Date(it.created_at).toLocaleString() : '—';
            const action = _activityReasonLabel[it.reason] || it.reason || '—';
            const stateChange = _activityStateText(it.from_state, it.to_state);
            // System-driven rows (cascade etc.) may carry no actor email — show
            // "System" rather than blank so the column is never confusing.
            const who = it.actor_email
                ? escapeHtml(it.actor_email)
                : (it.actor_user_id ? escapeHtml(it.actor_user_id) : '<em style="color:var(--text-secondary);">System</em>');
            const note = it.note ? escapeHtml(it.note) : '';
            return `
                <tr>
                    <td style="white-space:nowrap;">${escapeHtml(when)}</td>
                    <td>${escapeHtml(action)}</td>
                    <td style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(stateChange)}</td>
                    <td>${who}</td>
                    <td style="max-width:380px; word-break:break-word; color:var(--text-secondary);">${note}</td>
                </tr>`;
        }).join('');
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = 'Failed to load activity log: ' + (e.message || 'unknown error');
        }
    }
}

// ─── System User Token Modal (3-stage wizard) ───────────────────────────────

function openFacebookSystemUserModal() {
    document.getElementById('fbSuTokenInput').value = '';
    document.getElementById('fbSuTokenError').style.display = 'none';
    document.getElementById('fbSuScopeWarning').style.display = 'none';
    document.getElementById('fbSuStageToken').style.display = '';
    document.getElementById('fbSuStagePages').style.display = 'none';
    document.getElementById('fbSuStageConfirm').style.display = 'none';
    document.getElementById('fbSuValidateBtn').style.display = '';
    document.getElementById('fbSuConnectBtn').style.display = 'none';
    document.getElementById('fbSuDoneBtn').style.display = 'none';
    openModal('fbSystemUserModal');
}

function closeFacebookSystemUserModal() {
    closeModal('fbSystemUserModal');
    // Refresh the pages list so the new connection appears
    loadFacebookPages();
}

async function validateFacebookSystemUserToken() {
    const token = document.getElementById('fbSuTokenInput').value.trim();
    const errorEl = document.getElementById('fbSuTokenError');
    errorEl.style.display = 'none';

    if (!token) {
        errorEl.textContent = 'Paste your System User token first.';
        errorEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('fbSuValidateBtn');
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Validating…';

    try {
        const result = await api.request('/crm/facebook/system-user/validate', {
            method: 'POST',
            body: JSON.stringify({ token })
        });

        if (!result.valid) {
            errorEl.textContent = result.error || 'Token rejected by Facebook.';
            errorEl.style.display = 'block';
            return;
        }

        // Success: flip to stage 2 with page picker
        const info = result;
        const subtitle = `Signed in as ${escapeHtml(info.fb_user_name || 'Facebook user')}`;
        document.getElementById('fbSuTokenInfo').innerHTML = ` ${subtitle}. Granted: <code>${(info.granted_scopes || []).join(', ') || '—'}</code>`;

        // Warn if leads_retrieval missing
        const scopeWarning = document.getElementById('fbSuScopeWarning');
        if (!(info.granted_scopes || []).some(s => s.toLowerCase() === 'leads_retrieval')) {
            scopeWarning.textContent = 'This token does not include leads_retrieval. Leads will not pull until you regenerate the token with that scope selected.';
            scopeWarning.style.display = 'block';
        }

        const pagesList = document.getElementById('fbSuPagesList');
        if (!info.pages || info.pages.length === 0) {
            pagesList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No Pages are assigned to this System User.<br>Assign a Page in <strong>Business Settings → System Users → Add Assets</strong> and try again.</div>';
        } else {
            pagesList.innerHTML = info.pages.map((p, idx) => `
                <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border-color-light); cursor: pointer;" ${p.already_connected ? 'data-connected="1"' : ''}>
                    <input type="checkbox" class="fb-su-page-check" data-page-id="${escapeHtml(p.page_id)}" ${p.already_connected ? 'checked disabled' : (idx === 0 ? 'checked' : '')}>
                    <div style="flex: 1;">
                        <div style="font-weight: 600;">${escapeHtml(p.page_name)}</div>
                        <div style="font-size: 0.8em; color: var(--text-secondary);">
                            ${escapeHtml(p.category || 'Page')} · ID ${escapeHtml(p.page_id)}
                            ${p.already_connected ? ' · <span style="color: var(--color-success);">Already connected</span>' : ''}
                        </div>
                    </div>
                </label>
            `).join('');
        }

        // Stash the token so the connect step has it (NOT storing in window to avoid leaks beyond this modal)
        document.getElementById('fbSuTokenInput').dataset.validatedToken = token;
        document.getElementById('fbSuTokenInput').dataset.fbUserName = info.fb_user_name || '';

        document.getElementById('fbSuStageToken').style.display = 'none';
        document.getElementById('fbSuStagePages').style.display = '';
        document.getElementById('fbSuValidateBtn').style.display = 'none';
        document.getElementById('fbSuConnectBtn').style.display = '';
    } catch (err) {
        console.error('Token validation error', err);
        errorEl.textContent = err.message || 'Validation failed. Check your network + token.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

async function connectFacebookSelectedPages() {
    const token = document.getElementById('fbSuTokenInput').dataset.validatedToken;
    const fbUserName = document.getElementById('fbSuTokenInput').dataset.fbUserName || null;
    if (!token) {
        Toast.error('Token missing. Start over.');
        return;
    }

    const pageIds = [...document.querySelectorAll('.fb-su-page-check:not([disabled])')]
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.pageId);

    if (pageIds.length === 0) {
        Toast.warning('Select at least one page to connect.');
        return;
    }

    const btn = document.getElementById('fbSuConnectBtn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Connecting…';

    try {
        const result = await api.request('/crm/facebook/system-user/connect', {
            method: 'POST',
            body: JSON.stringify({ token, page_ids: pageIds, fb_user_name: fbUserName })
        });

        const connected = result.connected || [];
        const failures = result.failures || [];
        const summary = `${connected.length} page${connected.length !== 1 ? 's' : ''} connected${failures.length ? `, ${failures.length} failed` : ''}.`;
        document.getElementById('fbSuConfirmSummary').textContent = summary;

        document.getElementById('fbSuStagePages').style.display = 'none';
        document.getElementById('fbSuStageConfirm').style.display = '';
        document.getElementById('fbSuConnectBtn').style.display = 'none';
        document.getElementById('fbSuDoneBtn').style.display = '';

        // Clear the stashed token from DOM
        const ta = document.getElementById('fbSuTokenInput');
        ta.value = '';
        delete ta.dataset.validatedToken;

        Toast.success('Facebook connected');
    } catch (err) {
        console.error('Connect error', err);
        Toast.error(err.message || 'Failed to connect');
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

// ─── Form Picker + Mapping Modal ────────────────────────────────────────────

let _fbCurrentPageId = null;
let _fbCurrentPageName = null;
let _fbCurrentFormQuestions = [];

async function openFacebookFormModal(pageId, pageName) {
    _fbCurrentPageId = pageId;
    _fbCurrentPageName = pageName;
    document.getElementById('fbFormModalTitle').textContent = 'Manage Forms';
    document.getElementById('fbFormModalSubtitle').textContent = pageName;
    document.getElementById('fbFormPickerStage').style.display = '';
    document.getElementById('fbFormMappingStage').style.display = 'none';
    document.getElementById('fbMappingSaveBtn').style.display = 'none';
    document.getElementById('fbFormList').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Loading forms from Facebook…</div>';

    openModal('fbFormModal');

    try {
        const forms = await api.request(`/crm/facebook/pages/${encodeURIComponent(pageId)}/forms`);
        renderFacebookFormList(forms || []);
    } catch (err) {
        document.getElementById('fbFormList').innerHTML = `<div style="padding: 20px; color: var(--color-error);">Failed to load forms: ${escapeHtml(err.message || 'unknown error')}</div>`;
    }
}

function closeFacebookFormModal() {
    closeModal('fbFormModal');
    loadFacebookPages();
}

function backToFacebookFormList() {
    document.getElementById('fbFormMappingStage').style.display = 'none';
    document.getElementById('fbFormPickerStage').style.display = '';
    document.getElementById('fbMappingSaveBtn').style.display = 'none';
}

let _fbFormListBound = false;
function bindFacebookFormListHandlers() {
    if (_fbFormListBound) return;
    const container = document.getElementById('fbFormList');
    if (!container) return;
    container.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-fb-form-connect]');
        if (!btn) return;
        const row = btn.closest('[data-fb-form-id]');
        if (!row) return;
        const formId = row.getAttribute('data-fb-form-id');
        const formName = row.getAttribute('data-fb-form-name');
        const sourceId = row.getAttribute('data-fb-source-id') || '';
        startFacebookFormMapping(formId, formName, sourceId);
    });
    _fbFormListBound = true;
}

function renderFacebookFormList(forms) {
    const list = document.getElementById('fbFormList');
    if (forms.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No lead forms found on this page.</div>';
        return;
    }
    list.innerHTML = forms.map(f => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--border-color-light);"
             data-fb-form-id="${escapeHtml(f.form_id)}"
             data-fb-form-name="${escapeHtml(f.form_name || 'Untitled form')}"
             data-fb-source-id="${escapeHtml(f.lead_source_id || '')}">
            <div style="flex: 1;">
                <div style="font-weight: 600;">${escapeHtml(f.form_name || 'Untitled form')}</div>
                <div style="font-size: 0.8em; color: var(--text-secondary);">
                    Form ID: ${escapeHtml(f.form_id)} · Status: ${escapeHtml(f.status || 'unknown')}
                    ${f.already_connected ? ' · <span style="color: var(--color-success);">Mapped</span>' : ''}
                </div>
            </div>
            <button type="button" class="btn btn-primary" data-fb-form-connect="1" style="padding: 6px 12px; font-size: 0.85em;">
                ${f.already_connected ? 'Edit Mapping' : 'Connect & Map'}
            </button>
        </div>
    `).join('');
    bindFacebookFormListHandlers();
}

async function startFacebookFormMapping(formId, formName, existingSourceId) {
    document.getElementById('fbMappingPageId').value = _fbCurrentPageId;
    document.getElementById('fbMappingFormId').value = formId;
    document.getElementById('fbMappingFormName').value = formName;
    document.getElementById('fbMappingExistingSourceId').value = existingSourceId || '';
    document.getElementById('fbMappingFormLabel').textContent = formName;
    document.getElementById('fbMappingError').style.display = 'none';
    document.getElementById('fbMappingBody').innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-secondary);">Loading form questions from Facebook…</td></tr>';
    document.getElementById('fbFormPickerStage').style.display = 'none';
    document.getElementById('fbFormMappingStage').style.display = '';
    document.getElementById('fbMappingSaveBtn').style.display = '';

    // Prefill source-name label. On "Edit Mapping" we try to restore the
    // tenant's previous label from the existing lead_source row; on fresh
    // connect, seed with the FB form name.
    const srcInput = document.getElementById('fbSourceNameInput');
    if (srcInput) {
        let prior = '';
        if (existingSourceId) {
            const prev = facebookForms.find(f => f.lead_source_id === existingSourceId);
            prior = prev?.source_name || '';
        }
        srcInput.value = (prior || formName || '').slice(0, 200);
    }

    // Populate auto-assign-team dropdown. Default empty = "Assign manually
    // later" (existing behavior). On "Edit Mapping" pre-select whatever
    // team is currently saved on the lead_source so the user sees the
    // current state.
    await populateAutoAssignTeamDropdown(existingSourceId);

    try {
        const [questions, standardFields] = await Promise.all([
            api.request(`/crm/facebook/pages/${encodeURIComponent(_fbCurrentPageId)}/forms/${encodeURIComponent(formId)}/questions`),
            loadStandardLeadFields()
        ]);
        _fbCurrentFormQuestions = questions || [];

        // If editing, reconstruct existing mapping from lead_sources.field_mappings
        let existingMapping = null;
        if (existingSourceId) {
            const existing = facebookForms.find(f => f.lead_source_id === existingSourceId);
            if (existing && existing.field_mappings) {
                try { existingMapping = typeof existing.field_mappings === 'string' ? JSON.parse(existing.field_mappings) : existing.field_mappings; }
                catch { existingMapping = null; }
            }
        }

        renderFacebookMappingTable(_fbCurrentFormQuestions, standardFields, existingMapping);
    } catch (err) {
        document.getElementById('fbMappingBody').innerHTML = `<tr><td colspan="3" style="padding: 20px; color: var(--color-error);">Failed to load questions: ${escapeHtml(err.message || 'unknown error')}</td></tr>`;
    }
}

function renderFacebookMappingTable(questions, standardFields, existingMapping) {
    // The backend stores mappings in the shape { crm_field: [fb_key, fb_key, ...] } so that
    // FieldMappingHelper can look up questions by alias. We reverse it to pre-populate the
    // table which is keyed by fb question key → crm_field.
    const reverse = {};
    if (existingMapping) {
        for (const [crmField, aliases] of Object.entries(existingMapping)) {
            const list = Array.isArray(aliases) ? aliases : [aliases];
            for (const a of list) {
                if (typeof a === 'string') reverse[a.toLowerCase()] = crmField;
            }
        }
    }

    const fieldOptions = Object.entries(standardFields).map(([key, label]) =>
        `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`
    ).join('');

    const tbody = document.getElementById('fbMappingBody');
    if (!questions || questions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-secondary);">This form has no questions returned by Facebook.</td></tr>';
        return;
    }

    tbody.innerHTML = questions.map((q, i) => {
        const guessed = reverse[q.key.toLowerCase()] || guessFacebookMapping(q.key);
        const isCustom = guessed && !standardFields[guessed] && guessed !== '__skip__';
        const selected = isCustom ? '__custom__' : (guessed || '__skip__');

        return `
            <tr style="border-bottom: 1px solid var(--border-color-light);">
                <td style="padding: 10px 12px;">
                    <div style="font-weight: 600; font-size: 0.9em;">${escapeHtml(q.label || q.key)}</div>
                    <div style="font-size: 0.75em; color: var(--text-secondary); font-family: ui-monospace, monospace;">${escapeHtml(q.key)}</div>
                </td>
                <td style="padding: 10px 12px;">
                    <select class="form-control fb-mapping-select" data-fb-key="${escapeHtml(q.key)}" onchange="onFacebookMappingChange(this, ${i})">
                        <option value="__skip__" ${selected === '__skip__' ? 'selected' : ''}>— Skip —</option>
                        ${fieldOptions.replace(new RegExp(`value="${selected}"`), `value="${selected}" selected`)}
                        <option value="__custom__" ${selected === '__custom__' ? 'selected' : ''}>Custom field…</option>
                    </select>
                </td>
                <td style="padding: 10px 12px;">
                    <input type="text" class="form-control fb-mapping-custom" data-index="${i}"
                           placeholder="custom_field_name"
                           value="${isCustom ? escapeHtml(guessed) : ''}"
                           style="${selected === '__custom__' ? '' : 'display: none;'}">
                </td>
            </tr>
        `;
    }).join('');
}

function onFacebookMappingChange(selectEl, idx) {
    const customInput = document.querySelector(`.fb-mapping-custom[data-index="${idx}"]`);
    if (!customInput) return;
    if (selectEl.value === '__custom__') {
        customInput.style.display = '';
        customInput.focus();
    } else {
        customInput.style.display = 'none';
        customInput.value = '';
    }
}

function guessFacebookMapping(fbKey) {
    // Facebook lead form field keys are lowercase with underscores — match by stripping separators.
    const k = fbKey.toLowerCase().replace(/[\s_\-]+/g, '');
    const map = {
        'firstname': 'first_name', 'fname': 'first_name', 'givenname': 'first_name',
        'lastname': 'last_name', 'lname': 'last_name', 'surname': 'last_name', 'familyname': 'last_name',
        'fullname': 'full_name', 'name': 'full_name',
        'email': 'email', 'emailaddress': 'email', 'workemail': 'email',
        'phone': 'phone', 'phonenumber': 'phone', 'mobile': 'phone', 'mobileno': 'phone', 'mobilenumber': 'phone',
        'companyname': 'company_name', 'company': 'company_name', 'organization': 'company_name',
        'jobtitle': 'job_title', 'title': 'job_title', 'designation': 'job_title',
        'city': 'city', 'state': 'state', 'country': 'country', 'address': 'address',
        'pincode': 'pincode', 'zipcode': 'pincode', 'postalcode': 'pincode', 'zip': 'pincode',
        'budget': 'estimated_value', 'estimatedvalue': 'estimated_value',
        'notes': 'notes', 'comments': 'notes', 'message': 'notes',
        'website': 'website'
    };
    return map[k] || null;
}

async function loadStandardLeadFields() {
    if (_fbStandardFields) return _fbStandardFields;
    try {
        _fbStandardFields = await api.request('/crm/leads/import/fields') || {};
    } catch (err) {
        // Fallback to a hand-picked subset so the UI still works if the endpoint is down.
        _fbStandardFields = {
            first_name: 'First Name', last_name: 'Last Name', full_name: 'Full Name',
            email: 'Email', phone: 'Phone', company_name: 'Company',
            job_title: 'Job Title', city: 'City', state: 'State', country: 'Country',
            address: 'Address', pincode: 'Pincode', notes: 'Notes', estimated_value: 'Estimated Value',
            website: 'Website'
        };
    }
    return _fbStandardFields;
}

// Cache the team list once per Manage-Forms session so reopening the
// mapping stage doesn't refetch. Cleared on modal close (openFacebookFormModal).
let _fbAutoAssignTeams = null;

async function populateAutoAssignTeamDropdown(existingSourceId) {
    const sel = document.getElementById('fbAutoAssignTeamSelect');
    if (!sel) return;

    // Fetch teams (cached). On failure, leave the dropdown with just the
    // empty option — the auto-assign feature is optional, no need to block
    // the modal on a teams-API hiccup.
    if (!_fbAutoAssignTeams) {
        try {
            const teams = await api.request('/crm/teams');
            _fbAutoAssignTeams = Array.isArray(teams) ? teams : [];
        } catch {
            _fbAutoAssignTeams = [];
        }
    }

    // Rebuild options — empty option first, then one per active team.
    sel.innerHTML =
        '<option value="">— Assign manually later —</option>' +
        _fbAutoAssignTeams
            .filter(t => t.is_active !== false)
            .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.team_name || t.name || t.id)}</option>`)
            .join('');

    // Pre-select the currently-saved team for this source, if any.
    let preselect = '';
    if (existingSourceId) {
        const prev = facebookForms.find(f => f.lead_source_id === existingSourceId);
        preselect = prev?.auto_assign_team_id || '';
    }
    sel.value = preselect;
}

async function saveFacebookFormMapping() {
    const pageId = document.getElementById('fbMappingPageId').value;
    const formId = document.getElementById('fbMappingFormId').value;
    const formName = document.getElementById('fbMappingFormName').value;
    const existingId = document.getElementById('fbMappingExistingSourceId').value;
    const errorEl = document.getElementById('fbMappingError');
    errorEl.style.display = 'none';

    // Tenant-chosen label, required on fresh connect so leads from different
    // FB forms are distinguishable on the Leads page. On Edit Mapping (where
    // the lead_source row already exists) we skip validation here — the
    // existing label is preserved by the backend PUT.
    const srcInput = document.getElementById('fbSourceNameInput');
    const sourceName = (srcInput?.value || '').trim();
    if (!existingId && sourceName.length < 2) {
        errorEl.textContent = 'Give this source a short label (e.g. "Software Dev Q2") so you can filter these leads later.';
        errorEl.style.display = 'block';
        srcInput?.focus();
        return;
    }

    // Collect mappings in the { crm_field: [fb_key, ...] } shape expected by FieldMappingHelper.
    const mappings = {};
    const rows = document.querySelectorAll('.fb-mapping-select');
    for (let i = 0; i < rows.length; i++) {
        const sel = rows[i];
        const fbKey = sel.dataset.fbKey;
        const val = sel.value;

        let target = null;
        if (val === '__skip__') continue;
        if (val === '__custom__') {
            const customInput = document.querySelector(`.fb-mapping-custom[data-index="${i}"]`);
            const raw = customInput ? customInput.value.trim() : '';
            if (!raw) {
                errorEl.textContent = `Enter a name for the custom field on "${fbKey}" or skip it.`;
                errorEl.style.display = 'block';
                customInput?.focus();
                return;
            }
            target = raw.toLowerCase().replace(/\s+/g, '_');
        } else {
            target = val;
        }

        if (!mappings[target]) mappings[target] = [];
        if (!mappings[target].includes(fbKey.toLowerCase())) {
            mappings[target].push(fbKey.toLowerCase());
        }
    }

    const btn = document.getElementById('fbMappingSaveBtn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Saving…';

    // Read the auto-assign-team dropdown. Empty string = user picked
    // "Assign manually later". The backend treats Guid.Empty as the
    // explicit clear signal, so we map the empty option to that UUID.
    const teamSel = document.getElementById('fbAutoAssignTeamSelect');
    const teamSelVal = (teamSel?.value || '').trim();
    const autoTeamId = teamSelVal === '' ? '00000000-0000-0000-0000-000000000000' : teamSelVal;

    try {
        if (existingId) {
            await api.request(`/crm/facebook/forms/${existingId}/mapping`, {
                method: 'PUT',
                body: JSON.stringify({
                    field_mappings: JSON.stringify(mappings),
                    auto_assign_team_id: autoTeamId,
                })
            });
        } else {
            await api.request('/crm/facebook/forms/connect', {
                method: 'POST',
                body: JSON.stringify({
                    page_id: pageId,
                    form_id: formId,
                    form_name: formName,
                    field_mappings: JSON.stringify(mappings),
                    source_name: sourceName,
                    auto_assign_team_id: autoTeamId,
                })
            });
        }

        Toast.success('Form mapping saved');
        await loadFacebookPages();
        backToFacebookFormList();
        // Refresh the picker state (the saved form now shows as "connected")
        const forms = await api.request(`/crm/facebook/pages/${encodeURIComponent(pageId)}/forms`).catch(() => []);
        renderFacebookFormList(forms || []);
    } catch (err) {
        errorEl.textContent = err.message || 'Failed to save mapping.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

async function toggleFacebookFormSource(sourceId, makeActive) {
    try {
        await api.request(`/crm/facebook/forms/${sourceId}/toggle`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !!makeActive })
        });
        Toast.success(makeActive ? 'Polling resumed' : 'Polling paused');
        await loadFacebookPages();
    } catch (err) {
        Toast.error(err.message || 'Failed to toggle form');
    }
}

async function disconnectFacebookFormSource(sourceId) {
    const confirmed = await showConfirm('Remove this form? Past leads stay in the CRM. New leads from this form will stop being captured.', 'Remove form', 'danger');
    if (!confirmed) return;
    try {
        await api.request(`/crm/facebook/forms/${sourceId}`, { method: 'DELETE' });
        Toast.success('Form disconnected');
        await loadFacebookPages();
    } catch (err) {
        Toast.error(err.message || 'Failed to remove form');
    }
}

async function connectFacebook() {
    // OAuth path — kept for when Meta approves leads_retrieval. UI currently disables
    // the button with a tooltip, so this only runs if someone flips `disabled` by hand.
    try {
        const result = await api.request('/crm/facebook/auth-url');
        if (result && result.auth_url) {
            window.location.href = result.auth_url;
        } else {
            Toast.error('Failed to get Facebook auth URL');
        }
    } catch (error) {
        console.error('Error connecting Facebook:', error);
        Toast.error(error.message || 'Failed to initiate Facebook connection');
    }
}

async function disconnectFacebookPage(pageId) {
    const confirmed = await showConfirm('Disconnect this Facebook page? All forms under this page will stop pulling leads. Past leads stay in the CRM.', 'Disconnect Facebook', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/crm/facebook/disconnect/${pageId}`, { method: 'POST' });
        Toast.success('Facebook page disconnected');
        await loadFacebookPages();
    } catch (error) {
        console.error('Error disconnecting page:', error);
        Toast.error(error.message || 'Failed to disconnect page');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function showPipelineLoading(show) {
    const loadingEl = document.getElementById('pipelineLoading');
    const stagesList = document.getElementById('stagesList');
    const emptyState = document.getElementById('pipelineEmptyState');

    if (show) {
        loadingEl.style.display = 'flex';
        stagesList.style.display = 'none';
        emptyState.style.display = 'none';
    } else {
        loadingEl.style.display = 'none';
        stagesList.style.display = 'block';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LEAD SOURCES
// ═══════════════════════════════════════════════════════════════════════════

let leadSources = [];
let editingLeadSourceId = null;
let deletingLeadSourceId = null;

function getCrmBaseUrl() {
    // Build the CRM API base URL for webhook display
    if (typeof CONFIG !== 'undefined' && CONFIG.crmApiBaseUrl) {
        return CONFIG.crmApiBaseUrl;
    }
    return window.location.origin;
}

async function loadLeadSources() {
    const loading = document.getElementById('leadSourcesLoading');
    const tableWrapper = document.getElementById('leadSourcesTableWrapper');
    const emptyState = document.getElementById('leadSourcesEmptyState');

    try {
        if (loading) loading.style.display = 'flex';
        if (tableWrapper) tableWrapper.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';

        const result = await api.request('/crm/lead-sources');
        leadSources = result || [];
        renderLeadSources();
    } catch (error) {
        console.error('Error loading lead sources:', error);
        leadSources = [];
        renderLeadSources();
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderLeadSources() {
    const tableWrapper = document.getElementById('leadSourcesTableWrapper');
    const tbody = document.getElementById('leadSourcesTableBody');
    const emptyState = document.getElementById('leadSourcesEmptyState');

    if (!leadSources.length) {
        tableWrapper.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    tableWrapper.style.display = 'block';

    const sourceTypeLabels = {
        'landing_page': 'Landing Page',
        'website': 'Website',
        'api': 'API',
        'linkedin': 'LinkedIn',
        'facebook': 'Facebook',
        'manual': 'Manual',
        'import': 'Import'
    };

    tbody.innerHTML = leadSources.map(source => {
        const webhookUrl = source.webhook_key
            ? `${getCrmBaseUrl()}/leads/capture/${escapeHtml(source.webhook_key)}`
            : '-';
        const typeLabel = sourceTypeLabels[source.source_type] || source.source_type;
        const statusClass = source.is_active ? 'active' : 'inactive';
        const statusLabel = source.is_active ? 'Active' : 'Inactive';

        return `
            <tr data-source-id="${source.id}">
                <td>
                    <div class="crm-cell-primary">${escapeHtml(source.source_name)}</div>
                    ${source.source_identifier ? `<div class="crm-cell-secondary">${escapeHtml(source.source_identifier)}</div>` : ''}
                </td>
                <td>
                    <span class="crm-source-badge source-${source.source_type}">${escapeHtml(typeLabel)}</span>
                </td>
                <td class="hide-mobile">
                    ${source.webhook_key ? `
                        <div style="display: flex; align-items: center; gap: 6px; max-width: 300px;">
                            <code class="webhook-url-text" style="font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary);">${escapeHtml(webhookUrl)}</code>
                            <button class="crm-action-btn" onclick="copyWebhookUrl('${escapeHtmlJsAttr(source.webhook_key)}')" title="Copy URL" style="flex-shrink: 0;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                            </button>
                        </div>
                    ` : '<span class="crm-cell-secondary">-</span>'}
                </td>
                <td>
                    <span class="crm-cell-primary">${source.total_leads_received || 0}</span>
                </td>
                <td>
                    <span class="crm-status-badge status-${statusClass}">${statusLabel}</span>
                </td>
                <td>
                    <div class="crm-actions">
                        <button class="crm-action-btn" onclick="openFormStylingModal('${source.id}')" title="Customize Form">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 19l7-7 3 3-7 7-3-3z"/>
                                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
                                <path d="M2 2l7.586 7.586"/>
                                <circle cx="11" cy="11" r="2"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn" onclick="showEmbedCode('${source.id}')" title="Embed Code">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="16 18 22 12 16 6"/>
                                <polyline points="8 6 2 12 8 18"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn" onclick="editLeadSource('${source.id}')" title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn" onclick="regenerateWebhookKey('${source.id}')" title="Regenerate Webhook Key">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                        </button>
                        <button class="crm-action-btn action-delete" onclick="openDeleteLeadSourceModal('${source.id}')" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ─── Lead Source Modal: Create ───────────────────────────────────────────────

async function openNewLeadSourceModal() {
    editingLeadSourceId = null;
    document.getElementById('leadSourceModalTitle').textContent = 'New Lead Source';
    document.getElementById('leadSourceSubmitBtn').textContent = 'Create Source';
    document.getElementById('leadSourceForm').reset();
    document.getElementById('leadSourceId').value = '';
    clearFormFieldsBuilder();
    // Populate the auto-assign-team dropdown with no preselect — a new
    // source defaults to "Assign manually later". Awaited so the dropdown
    // is fully built before the modal becomes interactive.
    await populateLeadSourceTeamDropdown(null);
    openModal('leadSourceModal');
}

// ─── Lead Source Modal: Edit ─────────────────────────────────────────────────

async function editLeadSource(id) {
    const source = leadSources.find(s => s.id === id);
    if (!source) return;

    editingLeadSourceId = id;
    document.getElementById('leadSourceModalTitle').textContent = 'Edit Lead Source';
    document.getElementById('leadSourceSubmitBtn').textContent = 'Update Source';
    document.getElementById('leadSourceId').value = id;
    document.getElementById('leadSourceName').value = source.source_name || '';
    document.getElementById('leadSourceType').value = source.source_type || 'landing_page';
    document.getElementById('leadSourceIdentifier').value = source.source_identifier || '';

    populateFormFieldsBuilder(source.form_fields);
    // Pre-select the currently-saved team for this source so the dropdown
    // reflects the persisted state. Falls through to "— Assign manually —"
    // when the source has no team configured.
    await populateLeadSourceTeamDropdown(source.auto_assign_team_id || null);

    openModal('leadSourceModal');
}

// Cache the team list once per Settings-page session — opening/closing
// the modal doesn't refetch. Mirrors _fbAutoAssignTeams used by the FB
// form mapping modal; we keep a separate cache so the two modals don't
// share lifecycle (the FB cache is cleared on Manage-Forms modal close).
let _leadSourceAutoAssignTeams = null;

async function populateLeadSourceTeamDropdown(preselectTeamId) {
    const sel = document.getElementById('leadSourceAutoAssignTeamSelect');
    if (!sel) return;

    // Fetch teams (cached). On failure, leave the dropdown with just the
    // empty option — auto-assign is optional, no need to block the modal
    // on a teams-API hiccup.
    if (!_leadSourceAutoAssignTeams) {
        try {
            const teams = await api.request('/crm/teams');
            _leadSourceAutoAssignTeams = Array.isArray(teams) ? teams : [];
        } catch {
            _leadSourceAutoAssignTeams = [];
        }
    }

    sel.innerHTML =
        '<option value="">— Assign manually later —</option>' +
        _leadSourceAutoAssignTeams
            .filter(t => t.is_active !== false)
            .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.team_name || t.name || t.id)}</option>`)
            .join('');

    sel.value = preselectTeamId || '';
}

function closeLeadSourceModal() {
    closeModal('leadSourceModal');
    editingLeadSourceId = null;
}

// ─── Lead Source Form Submit ─────────────────────────────────────────────────

async function handleLeadSourceSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById('leadSourceSubmitBtn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="btn-spinner"></span>Saving...';

    try {
        const formFields = getFormFieldsFromBuilder();
        // Derive field_mappings from form_fields: every form key becomes
        // its own alias. The CRM backend's FieldMappingHelper routes
        // standard keys (full_name, email, phone, company_name, job_title…)
        // to their CRM columns and dumps everything else into custom_fields.
        // Empty form_fields → empty mapping, which the backend treats as
        // "use default aliases" (a sensible no-config fallback).
        const fieldMappings = {};
        for (const f of formFields) {
            if (f.key) fieldMappings[f.key] = [f.key];
        }

        // Auto-assign team — empty string maps to null (== "no team
        // configured"). On UPDATE the backend treats null as "leave
        // current value" UNLESS the empty Guid is sent — but our
        // contract here is simpler: empty selection clears the field.
        // The backend's UpdateLeadSourceRequest docstring says "Use
        // Guid.Empty to clear", but Guid.Empty serialises as the
        // all-zeros UUID, which we send instead of null when the
        // user explicitly picks "— Assign manually later —" while
        // editing. On CREATE this distinction doesn't matter (a fresh
        // source has nothing to preserve), so we send null.
        const teamSelectValue = document.getElementById('leadSourceAutoAssignTeamSelect').value;
        const autoAssignTeamId = teamSelectValue
            ? teamSelectValue
            : (editingLeadSourceId ? '00000000-0000-0000-0000-000000000000' : null);

        const payload = {
            source_name: document.getElementById('leadSourceName').value.trim(),
            source_type: document.getElementById('leadSourceType').value,
            source_identifier: document.getElementById('leadSourceIdentifier').value.trim() || null,
            field_mappings: JSON.stringify(fieldMappings),
            form_fields: JSON.stringify(formFields),
            auto_assign_team_id: autoAssignTeamId
        };

        if (editingLeadSourceId) {
            await api.request(`/crm/lead-sources/${editingLeadSourceId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            Toast.success('Lead source updated successfully');
        } else {
            await api.request('/crm/lead-sources', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            Toast.success('Lead source created successfully');
        }

        closeLeadSourceModal();
        await loadLeadSources();
    } catch (error) {
        console.error('Error saving lead source:', error);
        Toast.error(error.message || 'Failed to save lead source');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// ─── Lead Source Delete ──────────────────────────────────────────────────────

function openDeleteLeadSourceModal(id) {
    const source = leadSources.find(s => s.id === id);
    if (!source) return;

    deletingLeadSourceId = id;
    document.getElementById('deleteLeadSourceName').textContent = source.source_name || '';
    openModal('deleteLeadSourceModal');
}

function closeDeleteLeadSourceModal() {
    closeModal('deleteLeadSourceModal');
    deletingLeadSourceId = null;
}

async function confirmDeleteLeadSource() {
    if (!deletingLeadSourceId) return;

    const deleteBtn = document.getElementById('confirmDeleteLeadSourceBtn');
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '<span class="btn-spinner"></span>Deleting...';

    try {
        await api.request(`/crm/lead-sources/${deletingLeadSourceId}`, {
            method: 'DELETE'
        });
        Toast.success('Lead source deleted');
        closeDeleteLeadSourceModal();
        await loadLeadSources();
    } catch (error) {
        console.error('Error deleting lead source:', error);
        Toast.error(error.message || 'Failed to delete lead source');
    } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// ─── Webhook Key ─────────────────────────────────────────────────────────────

async function copyWebhookUrl(webhookKey) {
    const url = `${getCrmBaseUrl()}/leads/capture/${webhookKey}`;
    try {
        await navigator.clipboard.writeText(url);
        Toast.success('Webhook URL copied to clipboard');
    } catch {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = url;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        Toast.success('Webhook URL copied to clipboard');
    }
}

async function regenerateWebhookKey(id) {
    const confirmed = await showConfirm(
        'Regenerating the webhook key will invalidate the current URL. Any integrations using the old URL will stop working. Continue?',
        'Regenerate Webhook Key',
        'warning'
    );
    if (!confirmed) return;

    try {
        await api.request(`/crm/lead-sources/${id}/regenerate-key`, {
            method: 'POST'
        });
        Toast.success('Webhook key regenerated');
        await loadLeadSources();
    } catch (error) {
        console.error('Error regenerating webhook key:', error);
        Toast.error(error.message || 'Failed to regenerate webhook key');
    }
}

// ─── Form Fields Builder (typed fields rendered on the public form) ──────────
// Distinct from Field Mappings above (which is alias-only ingestion). This
// drives WHAT shows up on the lead's form: text/email/tel/textarea/select,
// per-field width, required, options (for select).

const FF_TYPES = ['text', 'email', 'tel', 'textarea', 'select'];
const FF_WIDTHS = ['full', 'half', 'third', 'two-thirds', 'quarter', 'three-quarters'];

// Mirrors FieldMappingHelper.cs defaults — any key here routes to its
// own CRM column at ingestion. Everything else lands in custom_fields.
const FF_STANDARD_KEY_MAP = {
    // Name
    'first_name': 'First name', 'firstname': 'First name', 'fname': 'First name', 'given_name': 'First name',
    'last_name': 'Last name', 'lastname': 'Last name', 'lname': 'Last name', 'family_name': 'Last name', 'surname': 'Last name',
    'full_name': 'Full name (split on first space)', 'fullname': 'Full name (split on first space)', 'name': 'Full name (split on first space)',
    // Contact
    'email': 'Email', 'email_address': 'Email', 'work_email': 'Email',
    'phone': 'Phone', 'phone_number': 'Phone', 'mobile': 'Phone', 'tel': 'Phone',
    'alternate_phone': 'Alternate phone',
    // Company
    'company': 'Company', 'company_name': 'Company', 'organization': 'Company', 'org': 'Company',
    'job_title': 'Job title', 'jobtitle': 'Job title', 'title': 'Job title', 'position': 'Job title',
    // Address
    'city': 'City', 'state': 'State', 'country': 'Country', 'address': 'Address',
    'pincode': 'Postal code', 'zip': 'Postal code', 'postal_code': 'Postal code',
    // Other
    'website': 'Website', 'campaign_name': 'Campaign', 'notes': 'Notes',
    'product_interest': 'Product interest'
};

function clearFormFieldsBuilder() {
    const list = document.getElementById('formFieldsList');
    if (list) list.innerHTML = '';
}

function _ffEscape(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Each card stores its config on a private data object. The visible
// row only renders the label, type pill, required pill — the rest
// is edited via the sub-modal (cog button).
let _ffSubModalActiveCard = null;
let _ffSubModalKeyEdited = false;

function addFormFieldCard(field) {
    const list = document.getElementById('formFieldsList');
    if (!list) return;

    const f = field || { key: '', type: 'text', label: '', placeholder: '', required: false, width: 'full', options: [] };

    const card = document.createElement('div');
    card.className = 'ff-row';
    card.dataset.ffCard = '1';

    // Store full config on the card; sub-modal reads/writes this.
    card._ffData = {
        key: f.key || '',
        type: f.type || 'text',
        label: f.label || '',
        placeholder: f.placeholder || '',
        required: !!f.required,
        width: f.width || 'full',
        options: Array.isArray(f.options) ? f.options.slice() : [],
        keyUserEdited: !!f.key  // if it came in with a key, treat as user-set
    };

    card.innerHTML = `
        <span class="ff-row-handle" title="Drag to reorder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>
        </span>
        <input type="text" class="ff-row-label" data-ff-row-label placeholder="Untitled field">
        <span class="ff-type-pill" data-ff-row-type></span>
        <span class="ff-required-pill" data-ff-row-required style="display:none;">required</span>
        <div class="ff-row-actions">
            <button type="button" class="ff-icon-btn ff-cog" title="Field settings" data-ff-settings>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
            </button>
            <button type="button" class="ff-icon-btn" title="Move up" data-ff-up>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
            <button type="button" class="ff-icon-btn" title="Move down" data-ff-down>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <button type="button" class="ff-icon-btn ff-danger" title="Remove field" data-ff-remove>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `;

    _ffRenderRowPills(card);
    card.querySelector('[data-ff-row-label]').value = card._ffData.label;

    card.querySelector('[data-ff-row-label]').addEventListener('input', (e) => {
        card._ffData.label = e.target.value;
        if (!card._ffData.keyUserEdited) {
            card._ffData.key = _slugify(card._ffData.label);
        }
    });

    card.querySelector('[data-ff-remove]').addEventListener('click', () => card.remove());
    card.querySelector('[data-ff-up]').addEventListener('click', () => {
        const prev = card.previousElementSibling;
        if (prev && prev.dataset.ffCard) list.insertBefore(card, prev);
    });
    card.querySelector('[data-ff-down]').addEventListener('click', () => {
        const next = card.nextElementSibling;
        if (next && next.dataset.ffCard) list.insertBefore(next, card);
    });
    card.querySelector('[data-ff-settings]').addEventListener('click', () => {
        openFieldSettings(card);
    });

    list.appendChild(card);
    return card;
}

function _ffRenderRowPills(card) {
    const d = card._ffData;
    card.querySelector('[data-ff-row-type]').textContent = d.type;
    card.querySelector('[data-ff-row-required]').style.display = d.required ? '' : 'none';
}

// ─── Field-settings sub-modal (opens on top of leadSourceModal) ──────────────

function openFieldSettings(card) {
    _ffSubModalActiveCard = card;
    _ffSubModalKeyEdited = card._ffData.keyUserEdited;

    const d = card._ffData;
    document.getElementById('fsLabel').value = d.label;
    document.getElementById('fsType').value = d.type;
    document.getElementById('fsWidth').value = d.width;
    document.getElementById('fsPlaceholder').value = d.placeholder;
    document.getElementById('fsKey').value = d.key;
    document.getElementById('fsRequired').checked = d.required;

    const optsText = Array.isArray(d.options)
        ? d.options.map(o => o.label && o.label !== o.value ? `${o.value}|${o.label}` : o.value).join('\n')
        : '';
    document.getElementById('fsOptions').value = optsText;

    _ffSyncOptionsVisibility();
    _ffRenderKeyStatus();

    // One-time wiring for the sub-modal inputs (no-op on subsequent opens)
    _ffWireSubModal();

    openModal('fieldSettingsModal');
    // Focus label so user can immediately type
    setTimeout(() => document.getElementById('fsLabel')?.focus(), 50);
}

function _ffRenderKeyStatus() {
    const el = document.getElementById('fsKeyStatus');
    if (!el) return;
    const key = (document.getElementById('fsKey').value || '').trim().toLowerCase();
    if (!key) {
        el.innerHTML = '';
        return;
    }
    const mappedTo = FF_STANDARD_KEY_MAP[key];
    if (mappedTo) {
        el.innerHTML = `<span class="ff-key-pill ff-key-pill-ok">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Maps to <strong>${mappedTo}</strong> column
        </span>`;
    } else {
        el.innerHTML = `<span class="ff-key-pill ff-key-pill-warn">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Stored as custom field — won't fill name / email / phone columns
        </span>`;
    }
}

function _ffSyncOptionsVisibility() {
    const wrap = document.getElementById('fsOptionsWrap');
    if (!wrap) return;
    wrap.style.display = document.getElementById('fsType').value === 'select' ? '' : 'none';
}

let _ffSubModalWired = false;
function _ffWireSubModal() {
    if (_ffSubModalWired) return;
    _ffSubModalWired = true;

    const labelEl = document.getElementById('fsLabel');
    const keyEl = document.getElementById('fsKey');
    const typeEl = document.getElementById('fsType');

    labelEl.addEventListener('input', () => {
        if (!_ffSubModalKeyEdited) {
            keyEl.value = _slugify(labelEl.value);
            _ffRenderKeyStatus();
        }
    });
    keyEl.addEventListener('input', () => {
        _ffSubModalKeyEdited = true;
        _ffRenderKeyStatus();
    });
    typeEl.addEventListener('change', _ffSyncOptionsVisibility);
}

function closeFieldSettings() {
    closeModal('fieldSettingsModal');
    _ffSubModalActiveCard = null;
}

function saveFieldSettings() {
    if (!_ffSubModalActiveCard) return closeFieldSettings();

    const label = document.getElementById('fsLabel').value.trim();
    if (!label) {
        if (typeof Toast !== 'undefined') Toast.error('Label is required');
        return;
    }

    const key = document.getElementById('fsKey').value.trim() || _slugify(label);
    const type = document.getElementById('fsType').value || 'text';
    const width = document.getElementById('fsWidth').value || 'full';
    const placeholder = document.getElementById('fsPlaceholder').value;
    const required = document.getElementById('fsRequired').checked;

    let options = [];
    if (type === 'select') {
        const text = document.getElementById('fsOptions').value || '';
        options = text.split('\n').map(line => {
            const t = line.trim();
            if (!t) return null;
            const idx = t.indexOf('|');
            if (idx === -1) return { value: t, label: t };
            const v = t.slice(0, idx).trim();
            const l = t.slice(idx + 1).trim();
            return v ? { value: v, label: l || v } : null;
        }).filter(Boolean);
    }

    const card = _ffSubModalActiveCard;
    card._ffData = { key, type, label, placeholder, required, width, options, keyUserEdited: _ffSubModalKeyEdited };
    card.querySelector('[data-ff-row-label]').value = label;
    _ffRenderRowPills(card);

    closeFieldSettings();
}

function _slugify(s) {
    return String(s || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function populateFormFieldsBuilder(formFieldsJson) {
    clearFormFieldsBuilder();
    if (!formFieldsJson) return;

    let fields;
    try {
        fields = typeof formFieldsJson === 'string'
            ? JSON.parse(formFieldsJson)
            : formFieldsJson;
    } catch (e) {
        console.error('Error parsing form_fields:', e);
        return;
    }
    if (!Array.isArray(fields)) return;

    fields.forEach(f => {
        if (f && typeof f === 'object') addFormFieldCard(f);
    });
}

function getFormFieldsFromBuilder() {
    const cards = document.querySelectorAll('#formFieldsList [data-ff-card]');
    const out = [];
    cards.forEach(card => {
        const d = card._ffData;
        if (!d) return;

        // Prefer the live label from the inline row input (it may have
        // been edited without opening the sub-modal).
        const liveLabel = card.querySelector('[data-ff-row-label]')?.value?.trim() || d.label || '';
        const key = (d.key || '').trim() || _slugify(liveLabel);
        if (!key) return;

        const field = {
            key,
            type: d.type || 'text',
            label: liveLabel || key,
            placeholder: d.placeholder || '',
            required: !!d.required,
            width: d.width || 'full'
        };
        if (field.type === 'select') {
            field.options = Array.isArray(d.options) ? d.options : [];
        }
        out.push(field);
    });
    return out;
}

// ─── Embed Code ─────────────────────────────────────────────────────────────

let activeEmbedTab = 'widget';

function showEmbedCode(id) {
    const source = leadSources.find(s => s.id === id);
    if (!source || !source.webhook_key) return;

    const crmBase = getCrmBaseUrl();
    const webhookUrl = `${crmBase}/leads/capture/${source.webhook_key}`;

    // ── Widget Script tab ──
    // Derive the embed script URL from the frontend origin (where lead-form.js is served)
    const frontendOrigin = window.location.origin;
    // Widget data-api needs the bare origin (no /api suffix) since lead-form.js appends /api/leads/...
    const crmOrigin = typeof CONFIG !== 'undefined' && CONFIG.endpoints?.crm
        ? CONFIG.endpoints.crm
        : crmBase.replace(/\/api\/?$/, '');
    const widgetCode = `<!-- Ragenaizer Lead Capture Widget -->
<button id="contact-btn">Get in Touch</button>
<script src="${frontendOrigin}/embed/lead-form.js"
        data-key="${source.webhook_key}"
        data-api="${crmOrigin}"
        data-trigger="#contact-btn"
        data-position="center"><\/script>`;

    // ── HTML Form tab ── (existing raw HTML logic)
    const htmlCode = generateRawHtmlForm(source, webhookUrl);

    document.getElementById('embedCodeSourceName').textContent = source.source_name;
    document.getElementById('embedCodeWidget').textContent = widgetCode;
    document.getElementById('embedCodeHtml').textContent = htmlCode;

    // Reset to widget tab
    switchEmbedTab('widget');
    openModal('embedCodeModal');
}

function generateRawHtmlForm(source, webhookUrl) {
    let mappings = {};
    try {
        mappings = typeof source.field_mappings === 'string'
            ? JSON.parse(source.field_mappings || '{}')
            : (source.field_mappings || {});
    } catch (e) { /* use empty */ }

    const inputStyle = 'width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 6px; box-sizing: border-box;';
    const labelStyle = 'display: block; margin-bottom: 4px; font-weight: 500;';

    const fieldMeta = {
        'first_name': { label: 'First Name', type: 'text', placeholder: 'First name' },
        'last_name': { label: 'Last Name', type: 'text', placeholder: 'Last name' },
        'full_name': { label: 'Full Name', type: 'text', placeholder: 'Your full name' },
        'email': { label: 'Email', type: 'email', placeholder: 'you@example.com', required: true },
        'phone': { label: 'Phone', type: 'tel', placeholder: '+1 (555) 000-0000' },
        'company_name': { label: 'Company', type: 'text', placeholder: 'Company name' },
        'job_title': { label: 'Job Title', type: 'text', placeholder: 'Your role' },
    };

    let fieldsHtml = '';
    const keys = Object.keys(mappings);
    if (keys.length === 0) {
        keys.push('full_name', 'email', 'phone', 'company_name');
    }

    keys.forEach((key, i) => {
        const meta = fieldMeta[key] || {};
        const label = meta.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const type = meta.type || 'text';
        const placeholder = meta.placeholder || label;
        const required = meta.required || key === 'email';
        const isLast = i === keys.length - 1;
        const marginBottom = isLast ? '16px' : '12px';
        const aliases = Array.isArray(mappings[key]) ? mappings[key] : [];
        const inputName = aliases[0] || key;

        if (key === 'notes' || key === 'message' || key === 'description') {
            fieldsHtml += `
  <div style="margin-bottom: ${marginBottom};">
    <label style="${labelStyle}">${label}${required ? ' *' : ''}</label>
    <textarea name="${inputName}" rows="3"${required ? ' required' : ''} placeholder="${placeholder}"
      style="${inputStyle} resize: vertical;"></textarea>
  </div>`;
        } else {
            fieldsHtml += `
  <div style="margin-bottom: ${marginBottom};">
    <label style="${labelStyle}">${label}${required ? ' *' : ''}</label>
    <input name="${inputName}" type="${type}"${required ? ' required' : ''} placeholder="${placeholder}"
      style="${inputStyle}">
  </div>`;
        }
    });

    return `<form action="${webhookUrl}" method="POST" style="max-width: 480px; margin: 0 auto; font-family: system-ui, sans-serif;">
  <h3 style="margin-bottom: 16px;">Get in Touch</h3>
${fieldsHtml}

  <button type="submit"
    style="width: 100%; padding: 12px; background: #2563eb; color: #fff; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer;">
    Submit
  </button>
</form>`;
}

function switchEmbedTab(tab) {
    activeEmbedTab = tab;
    // Toggle tab content
    document.getElementById('embedTab-widget').style.display = tab === 'widget' ? '' : 'none';
    document.getElementById('embedTab-html').style.display = tab === 'html' ? '' : 'none';

    // Toggle active tab button styles
    document.querySelectorAll('.embed-tab-btn').forEach(btn => {
        const isActive = btn.getAttribute('data-embed-tab') === tab;
        btn.classList.toggle('active', isActive);
        btn.style.color = isActive ? 'var(--brand-primary, #6366f1)' : 'var(--text-secondary)';
        btn.style.borderBottomColor = isActive ? 'var(--brand-primary, #6366f1)' : 'transparent';
    });
}

async function copyEmbedCode() {
    const contentId = activeEmbedTab === 'widget' ? 'embedCodeWidget' : 'embedCodeHtml';
    const code = document.getElementById(contentId).textContent;
    try {
        await navigator.clipboard.writeText(code);
        Toast.success('Embed code copied to clipboard');
    } catch {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        Toast.success('Embed code copied to clipboard');
    }
}

function closeEmbedCodeModal() {
    closeModal('embedCodeModal');
}

// ─── Form Styling Editor ─────────────────────────────────────────────────────

let formStylingSourceId = null;
let formStylingFields = null; // cached fields for preview

// Baseline shared across all presets — the new design-system keys.
// Anything not overridden by the preset falls back to these.
const FS_TYPOGRAPHY_DEFAULTS = {
    font_heading: 'system',
    font_body: 'system',
    font_label: 'system',
    label_uppercase: false,
    headline_gradient: false,
    bg_style: 'solid',          // solid | gradient | aurora | grid | dots
    hud_brackets: false,
    button_gradient: false,
    eyebrow_text: '',           // small uppercase label, top-LEFT of the header strip
    badge_text: '',             // small uppercase label, top-RIGHT of the header strip
    badge_dot: false,           // small coloured dot before the badge text
    badge_dot_color: '#34D399', // colour of that dot
    render_select_as: 'dropdown', // dropdown | pills (for select fields)
    grid_columns: 1,            // 1–4 — how many columns the field grid uses
    hairlines: false,           // thin gradient rule under eyebrow + above footer
    footer_text: ''             // small text left-aligned in the footer (CTA on right)
};

const LIGHT_DEFAULTS = {
    theme: 'light',
    position: 'center',
    form_title: '',
    background_color: '#ffffff',
    background_opacity: 1.0,
    text_color: '#1e1e2e',
    label_color: '#3f3f46',
    input_bg_color: '#fafafa',
    input_text_color: '#1e1e2e',
    button_color: '#6366f1',
    button_hover_color: '#4f46e5',
    button_text_color: '#ffffff',
    button_text: 'Submit',
    border_color: '#e4e4e7',
    border_radius: 10,
    glassy_effect: false,
    show_labels: true,
    logo_url: '',
    logo_position: 'top',
    logo_height: 32,
    input_height: 40,
    button_height: 44,
    form_width: 440,
    ...FS_TYPOGRAPHY_DEFAULTS
};

const DARK_DEFAULTS = {
    theme: 'dark',
    position: 'center',
    form_title: '',
    background_color: '#1e1e2e',
    background_opacity: 0.95,
    text_color: '#e4e4e7',
    label_color: '#d4d4d8',
    input_bg_color: '#27273a',
    input_text_color: '#e4e4e7',
    button_color: '#6366f1',
    button_hover_color: '#4f46e5',
    button_text_color: '#ffffff',
    button_text: 'Submit',
    border_color: '#3f3f46',
    border_radius: 10,
    glassy_effect: false,
    show_labels: true,
    logo_url: '',
    logo_position: 'top',
    logo_height: 32,
    input_height: 40,
    button_height: 44,
    form_width: 440,
    ...FS_TYPOGRAPHY_DEFAULTS
};

// Agency-style "dark studio" preset — deep navy with aurora orbs,
// serif headline with gradient text, monospace uppercase labels, violet
// CTA gradient. Generic — any agency / studio / consulting tenant can
// start here and tweak.
const AGENCY_DARK_DEFAULTS = {
    theme: 'dark',
    position: 'center',
    form_title: '',
    background_color: '#0E1018',        // surface
    background_opacity: 1.0,
    text_color: '#EAEAF5',
    label_color: '#8A88A6',              // muted — small uppercase labels
    input_bg_color: '#171929',           // translucent-feel input
    input_text_color: '#EAEAF5',
    button_color: '#8B5CF6',             // violet top stop
    button_hover_color: '#5B21B6',       // violet bottom stop
    button_text_color: '#FFFFFF',
    button_text: 'Send brief →',
    border_color: '#1F2236',             // line
    border_radius: 14,
    glassy_effect: true,
    show_labels: true,
    logo_url: '',
    logo_position: 'top',
    logo_height: 32,
    input_height: 48,
    button_height: 48,
    form_width: 600,
    font_heading: 'fraunces',
    font_body: 'inter-tight',
    font_label: 'jetbrains-mono',
    label_uppercase: true,
    headline_gradient: true,
    bg_style: 'aurora',
    hud_brackets: true,
    button_gradient: true,
    eyebrow_text: 'FORM · BRIEF',
    badge_text: 'SECURE',
    badge_dot: true,
    badge_dot_color: '#34D399',
    render_select_as: 'pills',
    grid_columns: 2,
    hairlines: true,
    footer_text: 'WE REPLY WITHIN ONE WORKING DAY.'
};

const FS_PRESETS = {
    'default-light': LIGHT_DEFAULTS,
    'default-dark': DARK_DEFAULTS,
    'agency-dark': AGENCY_DARK_DEFAULTS
};

// Google Fonts URL fragments for each font choice. Map key → (family
// param, css-family string). Loaded on demand by the preview iframe
// and the embed widget so we only request fonts the tenant has chosen.
const FS_FONTS = {
    'system':         { gf: null, css: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
    'inter':          { gf: 'Inter:wght@300..700', css: '"Inter", system-ui, sans-serif' },
    'inter-tight':    { gf: 'Inter+Tight:wght@300..700', css: '"Inter Tight", "Inter", system-ui, sans-serif' },
    'roboto':         { gf: 'Roboto:wght@300..700', css: '"Roboto", system-ui, sans-serif' },
    'open-sans':      { gf: 'Open+Sans:wght@300..700', css: '"Open Sans", system-ui, sans-serif' },
    'space-grotesk':  { gf: 'Space+Grotesk:wght@300..700', css: '"Space Grotesk", system-ui, sans-serif' },
    'fraunces':       { gf: 'Fraunces:opsz,wght@9..144,300..700', css: '"Fraunces", Georgia, serif' },
    'playfair':       { gf: 'Playfair+Display:wght@400..900', css: '"Playfair Display", Georgia, serif' },
    'lora':           { gf: 'Lora:wght@400..700', css: '"Lora", Georgia, serif' },
    'jetbrains-mono': { gf: 'JetBrains+Mono:wght@300..700', css: '"JetBrains Mono", ui-monospace, monospace' },
    'fira-code':      { gf: 'Fira+Code:wght@300..700', css: '"Fira Code", ui-monospace, monospace' },
    'ibm-plex-mono':  { gf: 'IBM+Plex+Mono:wght@300..700', css: '"IBM Plex Mono", ui-monospace, monospace' },
    'space-mono':     { gf: 'Space+Mono:wght@400;700', css: '"Space Mono", ui-monospace, monospace' }
};

// Build a single Google Fonts <link> URL for a set of font keys (skips
// 'system' and duplicates). Returns null when nothing needs loading.
function buildGoogleFontsLink(keys) {
    const families = [];
    const seen = new Set();
    for (const k of keys) {
        const f = FS_FONTS[k];
        if (!f || !f.gf || seen.has(f.gf)) continue;
        seen.add(f.gf);
        families.push('family=' + f.gf);
    }
    if (families.length === 0) return null;
    return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

function fsFontFamily(key) {
    return (FS_FONTS[key] || FS_FONTS.system).css;
}

// Color picker sync pairs: [colorInputId, hexInputId]
const FS_COLOR_PAIRS = [
    ['fsBgColor', 'fsBgColorHex'],
    ['fsTextColor', 'fsTextColorHex'],
    ['fsLabelColor', 'fsLabelColorHex'],
    ['fsInputBgColor', 'fsInputBgColorHex'],
    ['fsInputTextColor', 'fsInputTextColorHex'],
    ['fsButtonColor', 'fsButtonColorHex'],
    ['fsButtonTextColor', 'fsButtonTextColorHex'],
    ['fsBorderColor', 'fsBorderColorHex'],
    ['fsBadgeDotColor', 'fsBadgeDotColorHex'],
];

let _fsSyncBound = false;

function initFormStylingSync() {
    if (_fsSyncBound) return;
    _fsSyncBound = true;

    // Sync color pickers <-> hex inputs
    FS_COLOR_PAIRS.forEach(([colorId, hexId]) => {
        const colorEl = document.getElementById(colorId);
        const hexEl = document.getElementById(hexId);
        if (!colorEl || !hexEl) return;

        colorEl.addEventListener('input', () => {
            hexEl.value = colorEl.value;
            renderStylingPreview();
        });
        hexEl.addEventListener('input', () => {
            const v = hexEl.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                colorEl.value = v;
            }
            renderStylingPreview();
        });
    });

    // Opacity slider
    const opacitySlider = document.getElementById('fsOpacity');
    const opacityLabel = document.getElementById('fsOpacityValue');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', () => {
            opacityLabel.textContent = `${Math.round(opacitySlider.value * 100)}%`;
            renderStylingPreview();
        });
    }

    // Border radius slider
    const radiusSlider = document.getElementById('fsBorderRadius');
    const radiusLabel = document.getElementById('fsRadiusValue');
    if (radiusSlider) {
        radiusSlider.addEventListener('input', () => {
            radiusLabel.textContent = `${radiusSlider.value}px`;
            renderStylingPreview();
        });
    }

    // Theme dropdown — reset only colors to new theme defaults, preserve everything else
    const themeSelect = document.getElementById('fsTheme');
    if (themeSelect) {
        themeSelect.addEventListener('change', () => {
            const current = getFormStylingValues();
            const defaults = themeSelect.value === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
            // Merge: use new theme colors but preserve non-color settings
            const merged = {
                ...defaults,
                position: current.position,
                form_title: current.form_title,
                button_text: current.button_text,
                logo_url: current.logo_url,
                logo_position: current.logo_position,
                logo_height: current.logo_height,
                input_height: current.input_height,
                button_height: current.button_height,
                border_radius: current.border_radius,
                glassy_effect: current.glassy_effect,
                show_labels: current.show_labels,
                form_width: current.form_width,
            };
            populateFormStylingControls(merged);
            renderStylingPreview();
        });
    }

    // Position, form title, button text, logo URL, logo position — live preview
    ['fsPosition', 'fsFormTitle', 'fsButtonText', 'fsLogoUrl', 'fsLogoPosition'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => renderStylingPreview());
    });

    // Logo height slider
    const logoHeightSlider = document.getElementById('fsLogoHeight');
    const logoHeightLabel = document.getElementById('fsLogoHeightValue');
    if (logoHeightSlider) {
        logoHeightSlider.addEventListener('input', () => {
            if (logoHeightLabel) logoHeightLabel.textContent = `${logoHeightSlider.value}px`;
            renderStylingPreview();
        });
    }

    // Input height slider
    const inputHeightSlider = document.getElementById('fsInputHeight');
    const inputHeightLabel = document.getElementById('fsInputHeightValue');
    if (inputHeightSlider) {
        inputHeightSlider.addEventListener('input', () => {
            if (inputHeightLabel) inputHeightLabel.textContent = `${inputHeightSlider.value}px`;
            renderStylingPreview();
        });
    }

    // Button height slider
    const buttonHeightSlider = document.getElementById('fsButtonHeight');
    const buttonHeightLabel = document.getElementById('fsButtonHeightValue');
    if (buttonHeightSlider) {
        buttonHeightSlider.addEventListener('input', () => {
            if (buttonHeightLabel) buttonHeightLabel.textContent = `${buttonHeightSlider.value}px`;
            renderStylingPreview();
        });
    }

    // Form width slider
    const formWidthSlider = document.getElementById('fsFormWidth');
    const formWidthLabel = document.getElementById('fsFormWidthValue');
    if (formWidthSlider) {
        formWidthSlider.addEventListener('input', () => {
            if (formWidthLabel) formWidthLabel.textContent = `${formWidthSlider.value}px`;
            renderStylingPreview();
        });
    }

    // Glassy toggle
    const glassyCheckbox = document.getElementById('fsGlassyEffect');
    if (glassyCheckbox) {
        glassyCheckbox.addEventListener('change', () => {
            updateGlassyToggleVisual();
            renderStylingPreview();
        });
    }

    // Show labels toggle
    const showLabelsCb = document.getElementById('fsShowLabels');
    if (showLabelsCb) {
        showLabelsCb.addEventListener('change', () => {
            updateShowLabelsToggleVisual();
            renderStylingPreview();
        });
    }

    // ── Preset dropdown — one-click brand match ─────────────────────────
    const presetSel = document.getElementById('fsPreset');
    if (presetSel) {
        presetSel.addEventListener('change', () => {
            const preset = FS_PRESETS[presetSel.value];
            if (!preset) return;
            populateFormStylingControls(preset);
            renderStylingPreview();
        });
    }

    // ── New design-system controls — live preview ───────────────────────
    ['fsFontHeading', 'fsFontBody', 'fsFontLabel', 'fsBgStyle', 'fsRenderSelectAs', 'fsGridColumns'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => renderStylingPreview());
    });
    ['fsLabelUppercase', 'fsHeadlineGradient', 'fsHudBrackets', 'fsButtonGradient', 'fsBadgeDot', 'fsHairlines'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            updateNewToggleVisuals();
            renderStylingPreview();
        });
    });
    ['fsEyebrowText', 'fsBadgeText', 'fsFooterText'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => renderStylingPreview());
    });
}

function updateGlassyToggleVisual() {
    const cb = document.getElementById('fsGlassyEffect');
    const toggle = document.getElementById('fsGlassyToggle');
    const knob = document.getElementById('fsGlassyKnob');
    if (!cb || !toggle || !knob) return;

    if (cb.checked) {
        toggle.style.background = 'var(--brand-primary, #6366f1)';
        knob.style.transform = 'translateX(18px)';
    } else {
        toggle.style.background = 'var(--border-primary, #d4d4d8)';
        knob.style.transform = 'translateX(0)';
    }
}

function updateShowLabelsToggleVisual() {
    const cb = document.getElementById('fsShowLabels');
    const toggle = document.getElementById('fsShowLabelsToggle');
    const knob = document.getElementById('fsShowLabelsKnob');
    if (!cb || !toggle || !knob) return;

    if (cb.checked) {
        toggle.style.background = 'var(--brand-primary, #6366f1)';
        knob.style.transform = 'translateX(18px)';
    } else {
        toggle.style.background = 'var(--border-primary, #d4d4d8)';
        knob.style.transform = 'translateX(0)';
    }
}

function getFormStylingValues() {
    return {
        theme: document.getElementById('fsTheme')?.value || 'light',
        position: document.getElementById('fsPosition')?.value || 'center',
        form_title: document.getElementById('fsFormTitle')?.value?.trim() || '',
        background_color: document.getElementById('fsBgColorHex')?.value || '#ffffff',
        background_opacity: parseFloat(document.getElementById('fsOpacity')?.value || '1'),
        text_color: document.getElementById('fsTextColorHex')?.value || '#1e1e2e',
        label_color: document.getElementById('fsLabelColorHex')?.value || '#3f3f46',
        input_bg_color: document.getElementById('fsInputBgColorHex')?.value || '#fafafa',
        input_text_color: document.getElementById('fsInputTextColorHex')?.value || '#1e1e2e',
        button_color: document.getElementById('fsButtonColorHex')?.value || '#6366f1',
        button_hover_color: document.getElementById('fsButtonColorHex')?.value || '#4f46e5',
        button_text_color: document.getElementById('fsButtonTextColorHex')?.value || '#ffffff',
        button_text: document.getElementById('fsButtonText')?.value || 'Submit',
        border_color: document.getElementById('fsBorderColorHex')?.value || '#e4e4e7',
        border_radius: parseInt(document.getElementById('fsBorderRadius')?.value || '10'),
        glassy_effect: document.getElementById('fsGlassyEffect')?.checked || false,
        show_labels: document.getElementById('fsShowLabels')?.checked !== false,
        logo_url: document.getElementById('fsLogoUrl')?.value?.trim() || '',
        logo_position: document.getElementById('fsLogoPosition')?.value || 'top',
        logo_height: parseInt(document.getElementById('fsLogoHeight')?.value || '32'),
        input_height: parseInt(document.getElementById('fsInputHeight')?.value || '40'),
        button_height: parseInt(document.getElementById('fsButtonHeight')?.value || '44'),
        form_width: parseInt(document.getElementById('fsFormWidth')?.value || '440'),
        // ── New design-system knobs ─────────────────────────────────────
        font_heading: document.getElementById('fsFontHeading')?.value || 'system',
        font_body: document.getElementById('fsFontBody')?.value || 'system',
        font_label: document.getElementById('fsFontLabel')?.value || 'system',
        label_uppercase: document.getElementById('fsLabelUppercase')?.checked || false,
        headline_gradient: document.getElementById('fsHeadlineGradient')?.checked || false,
        bg_style: document.getElementById('fsBgStyle')?.value || 'solid',
        hud_brackets: document.getElementById('fsHudBrackets')?.checked || false,
        button_gradient: document.getElementById('fsButtonGradient')?.checked || false,
        eyebrow_text: document.getElementById('fsEyebrowText')?.value?.trim() || '',
        badge_text: document.getElementById('fsBadgeText')?.value?.trim() || '',
        badge_dot: document.getElementById('fsBadgeDot')?.checked || false,
        badge_dot_color: document.getElementById('fsBadgeDotColorHex')?.value || '#34D399',
        render_select_as: document.getElementById('fsRenderSelectAs')?.value || 'dropdown',
        grid_columns: Math.max(1, Math.min(4, parseInt(document.getElementById('fsGridColumns')?.value, 10) || 1)),
        hairlines: document.getElementById('fsHairlines')?.checked || false,
        footer_text: document.getElementById('fsFooterText')?.value?.trim() || ''
    };
}

function populateFormStylingControls(s) {
    // Theme, position, form title
    const themeEl = document.getElementById('fsTheme');
    if (themeEl) themeEl.value = s.theme || 'light';
    const posEl = document.getElementById('fsPosition');
    if (posEl) posEl.value = s.position || 'center';
    const formTitleEl = document.getElementById('fsFormTitle');
    if (formTitleEl) formTitleEl.value = s.form_title || '';

    // Color pairs
    const colorMap = {
        'fsBgColor': s.background_color,
        'fsTextColor': s.text_color,
        'fsLabelColor': s.label_color,
        'fsInputBgColor': s.input_bg_color,
        'fsInputTextColor': s.input_text_color,
        'fsButtonColor': s.button_color,
        'fsButtonTextColor': s.button_text_color,
        'fsBorderColor': s.border_color,
    };

    for (const [colorId, val] of Object.entries(colorMap)) {
        const colorEl = document.getElementById(colorId);
        const hexEl = document.getElementById(colorId + 'Hex');
        if (colorEl && val) colorEl.value = val;
        if (hexEl && val) hexEl.value = val;
    }

    // Opacity
    const opacitySlider = document.getElementById('fsOpacity');
    const opacityLabel = document.getElementById('fsOpacityValue');
    if (opacitySlider) opacitySlider.value = s.background_opacity ?? 1;
    if (opacityLabel) opacityLabel.textContent = `${Math.round((s.background_opacity ?? 1) * 100)}%`;

    // Border radius
    const radiusSlider = document.getElementById('fsBorderRadius');
    const radiusLabel = document.getElementById('fsRadiusValue');
    if (radiusSlider) radiusSlider.value = s.border_radius ?? 10;
    if (radiusLabel) radiusLabel.textContent = `${s.border_radius ?? 10}px`;

    // Button text
    const btnTextEl = document.getElementById('fsButtonText');
    if (btnTextEl) btnTextEl.value = s.button_text || 'Submit';

    // Glassy
    const glassyCb = document.getElementById('fsGlassyEffect');
    if (glassyCb) glassyCb.checked = !!s.glassy_effect;
    updateGlassyToggleVisual();

    // Show labels
    const showLabelsCb = document.getElementById('fsShowLabels');
    if (showLabelsCb) showLabelsCb.checked = s.show_labels !== false;
    updateShowLabelsToggleVisual();

    // Logo
    const logoUrlEl = document.getElementById('fsLogoUrl');
    if (logoUrlEl) logoUrlEl.value = s.logo_url || '';
    const logoPosEl = document.getElementById('fsLogoPosition');
    if (logoPosEl) logoPosEl.value = s.logo_position || 'top';
    const logoHeightSlider = document.getElementById('fsLogoHeight');
    const logoHeightLabel = document.getElementById('fsLogoHeightValue');
    if (logoHeightSlider) logoHeightSlider.value = s.logo_height || 32;
    if (logoHeightLabel) logoHeightLabel.textContent = `${s.logo_height || 32}px`;

    // Input & Button height
    const inputHeightSlider = document.getElementById('fsInputHeight');
    const inputHeightLabel = document.getElementById('fsInputHeightValue');
    if (inputHeightSlider) inputHeightSlider.value = s.input_height || 40;
    if (inputHeightLabel) inputHeightLabel.textContent = `${s.input_height || 40}px`;

    const buttonHeightSlider = document.getElementById('fsButtonHeight');
    const buttonHeightLabel = document.getElementById('fsButtonHeightValue');
    if (buttonHeightSlider) buttonHeightSlider.value = s.button_height || 44;
    if (buttonHeightLabel) buttonHeightLabel.textContent = `${s.button_height || 44}px`;

    const formWidthSlider = document.getElementById('fsFormWidth');
    const formWidthLabel = document.getElementById('fsFormWidthValue');
    if (formWidthSlider) formWidthSlider.value = s.form_width || 440;
    if (formWidthLabel) formWidthLabel.textContent = `${s.form_width || 440}px`;

    // ── New design-system knobs ─────────────────────────────────────────
    const setVal = (id, val, fallback) => {
        const el = document.getElementById(id);
        if (el) el.value = val ?? fallback;
    };
    const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    };
    setVal('fsFontHeading', s.font_heading, 'system');
    setVal('fsFontBody', s.font_body, 'system');
    setVal('fsFontLabel', s.font_label, 'system');
    setChecked('fsLabelUppercase', s.label_uppercase);
    setChecked('fsHeadlineGradient', s.headline_gradient);
    setVal('fsBgStyle', s.bg_style, 'solid');
    setChecked('fsHudBrackets', s.hud_brackets);
    setChecked('fsButtonGradient', s.button_gradient);
    setVal('fsEyebrowText', s.eyebrow_text, '');
    setVal('fsBadgeText', s.badge_text, '');
    setChecked('fsBadgeDot', s.badge_dot);
    const dotColorEl = document.getElementById('fsBadgeDotColor');
    const dotHexEl = document.getElementById('fsBadgeDotColorHex');
    if (dotColorEl && s.badge_dot_color) dotColorEl.value = s.badge_dot_color;
    if (dotHexEl && s.badge_dot_color) dotHexEl.value = s.badge_dot_color;
    setVal('fsRenderSelectAs', s.render_select_as, 'dropdown');
    setVal('fsGridColumns', String(s.grid_columns ?? 1), '1');
    setChecked('fsHairlines', s.hairlines);
    setVal('fsFooterText', s.footer_text, '');
    updateNewToggleVisuals();
}

// Visual sync for the three new toggle switches (label-uppercase,
// headline-gradient, hud-brackets, button-gradient).
function updateNewToggleVisuals() {
    const pairs = [
        ['fsLabelUppercase', 'fsLabelUppercaseToggle', 'fsLabelUppercaseKnob'],
        ['fsHeadlineGradient', 'fsHeadlineGradientToggle', 'fsHeadlineGradientKnob'],
        ['fsHudBrackets', 'fsHudBracketsToggle', 'fsHudBracketsKnob'],
        ['fsButtonGradient', 'fsButtonGradientToggle', 'fsButtonGradientKnob'],
        ['fsBadgeDot', 'fsBadgeDotToggle', 'fsBadgeDotKnob'],
        ['fsHairlines', 'fsHairlinesToggle', 'fsHairlinesKnob']
    ];
    for (const [cbId, trackId, knobId] of pairs) {
        const cb = document.getElementById(cbId);
        const t = document.getElementById(trackId);
        const k = document.getElementById(knobId);
        if (!cb || !t || !k) continue;
        if (cb.checked) {
            t.style.background = 'var(--brand-primary, #6366f1)';
            k.style.transform = 'translateX(18px)';
        } else {
            t.style.background = 'var(--border-primary, #d4d4d8)';
            k.style.transform = 'translateX(0)';
        }
    }
}

function hexToRgba(hex, opacity) {
    if (!hex || typeof hex !== 'string') return `rgba(0,0,0,${opacity})`;
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(0,0,0,${opacity})`;
    return `rgba(${r},${g},${b},${opacity})`;
}

let _renderPreviewTimer = null;
function renderStylingPreview() {
    // Debounce to avoid rapid iframe reloads
    clearTimeout(_renderPreviewTimer);
    _renderPreviewTimer = setTimeout(_renderStylingPreviewNow, 60);
}

function _renderStylingPreviewNow() {
    const container = document.getElementById('formStylingPreviewContainer');
    if (!container) return;

    const s = getFormStylingValues();
    const isDark = s.theme === 'dark';
    const radius = `${s.border_radius}px`;
    const bgRgba = hexToRgba(s.background_color, s.background_opacity);
    // Always use rgba so opacity slider works regardless of glassy toggle
    const cardBg = bgRgba;
    const cardBorder = s.glassy_effect ? `border: 1px solid ${hexToRgba(s.border_color, 0.3)};` : `border: 1px solid ${s.border_color};`;
    const glassyFilter = s.glassy_effect ? 'backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);' : '';
    const inputH = s.input_height || 40;
    const buttonH = s.button_height || 44;

    // ── New design-system computed pieces ──────────────────────────────
    const fontHeading = fsFontFamily(s.font_heading);
    const fontBody = fsFontFamily(s.font_body);
    const fontLabel = fsFontFamily(s.font_label === 'system' ? s.font_body : s.font_label);
    const gfLink = buildGoogleFontsLink([s.font_heading, s.font_body, s.font_label]);
    const gfTag = gfLink ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${gfLink}">` : '';

    const labelTransform = s.label_uppercase ? 'text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.7rem;' : '';
    const titleGradient = s.headline_gradient
        ? 'background: linear-gradient(95deg, currentColor 0%, #A78BFA 35%, #38BDF8 75%, #BEF264 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent;'
        : '';
    const buttonGradient = s.button_gradient
        ? `background: linear-gradient(180deg, ${s.button_color} 0%, ${s.button_hover_color} 100%);`
        : `background: ${s.button_color};`;

    // Column count — clamped 1..4 (any field-width hint maps into a span
    // out of this number of columns).
    const gridCols = Math.max(1, Math.min(4, parseInt(s.grid_columns, 10) || 1));

    // Body background — what the form floats over. WiseTrack-style aurora
    // adds blurred conic-gradient orbs behind a solid dark base.
    const bodyBg = buildPreviewBodyBg(s);
    const hudBracketsHtml = s.hud_brackets ? `
        <span class="pf-hud pf-hud-tl"></span>
        <span class="pf-hud pf-hud-br"></span>
    ` : '';

    // Build preview fields from cached source fields. When the cache is
    // empty (no real form yet), surface a representative demo so the
    // tenant can SEE how pills + grid + textarea render against the
    // chosen styling — otherwise toggling knobs has no visual effect.
    const fields = formStylingFields || [
        { label: 'Full Name', type: 'text', placeholder: 'Jane Doe', required: false, width: 'half' },
        { label: 'Email', type: 'email', placeholder: 'jane@company.com', required: false, width: 'half' },
        { label: 'Company', type: 'text', placeholder: 'Acme Inc.', required: false },
        { label: 'What can we help with?', type: 'text', placeholder: 'Custom application (HyperScripts)', required: false },
        { label: 'Budget', type: 'select', width: 'half', options: [{ value: 'l', label: '< ₹10L' }, { value: 'm', label: '₹10–50L' }, { value: 'h', label: '₹50L+' }], required: false },
        { label: 'Timeline', type: 'select', width: 'half', options: [{ value: '1', label: '< 3 mo' }, { value: '2', label: '3–6 mo' }, { value: '3', label: '6 mo+' }], required: false },
        { label: 'Project Details', type: 'textarea', placeholder: 'What do you want to build? When do you need it? Any constraints we should know about…', required: false }
    ];

    const showLabels = s.show_labels !== false;

    let fieldsHtml = '';
    fields.forEach((f, fieldIdx) => {
        const reqMark = f.required ? `<span style="color: #ef4444; margin-left: 2px;"> *</span>` : '';
        const labelHtml = showLabels ? `<label class="pf-label">${_escHtml(f.label)}${reqMark}</label>` : '';
        const isSelect = (f.type === 'select' || f.type === 'single_select') && Array.isArray(f.options) && f.options.length > 0;
        // Field span — translate width hint into a grid span out of
        // gridCols. full / undefined → spans the whole row. Textareas
        // always span the whole row regardless of their hint.
        let fieldCls = 'pf-field ';
        if (f.type === 'textarea' || !f.width || f.width === 'full') {
            fieldCls += 'pf-field--full';
        } else {
            // half = 1/2, third = 1/3, quarter = 1/4, two-thirds = 2/3,
            // three-quarters = 3/4. Compute span = round(gridCols * fraction).
            const fractions = { half: 1/2, third: 1/3, quarter: 1/4, 'two-thirds': 2/3, 'three-quarters': 3/4 };
            const frac = fractions[f.width] ?? 1;
            const span = Math.max(1, Math.min(gridCols, Math.round(gridCols * frac)));
            fieldCls += 'pf-span-' + span;
        }

        if (isSelect && s.render_select_as === 'pills') {
            // Segmented pill chips — second option marked active for the
            // preview so the active state is visible (matches the
            // "₹10–50L" + "3-6 MO" highlighted state on WiseTrack).
            const pillsHtml = f.options.map((opt, i) => {
                const lbl = (typeof opt === 'string') ? opt : (opt.label || opt.value || '');
                const activeClass = i === 1 ? 'pf-pill pf-pill-active' : 'pf-pill';
                return `<button type="button" disabled class="${activeClass}">${_escHtml(lbl)}</button>`;
            }).join('');
            fieldsHtml += `
                <div class="${fieldCls}">
                    ${labelHtml}
                    <div class="pf-pill-row">${pillsHtml}</div>
                </div>`;
        } else if (isSelect) {
            const optsHtml = f.options.map(opt => {
                const lbl = (typeof opt === 'string') ? opt : (opt.label || opt.value || '');
                return `<option>${_escHtml(lbl)}</option>`;
            }).join('');
            fieldsHtml += `
                <div class="${fieldCls}">
                    ${labelHtml}
                    <select disabled class="pf-input">${optsHtml}</select>
                </div>`;
        } else if (f.type === 'textarea') {
            fieldsHtml += `
                <div class="pf-field pf-field--full">
                    ${labelHtml}
                    <textarea rows="3" placeholder="${_escHtml(f.placeholder || '')}" disabled class="pf-textarea"></textarea>
                </div>`;
        } else {
            fieldsHtml += `
                <div class="${fieldCls}">
                    ${labelHtml}
                    <input type="${f.type || 'text'}" placeholder="${_escHtml(f.placeholder || '')}" disabled class="pf-input">
                </div>`;
        }
    });
    // Wrap every field in a CSS grid so width:half fields can pair up.
    fieldsHtml = `<div class="pf-fields-grid">${fieldsHtml}</div>`;

    const formTitle = s.form_title || '';

    // Logo HTML (no onerror — iframe sandbox blocks inline scripts)
    const logoUrl = s.logo_url || '';
    const logoHeight = s.logo_height || 32;
    const logoPos = s.logo_position || 'top';
    const logoHtml = logoUrl
        ? `<div class="pf-logo ${logoPos === 'bottom' ? 'pf-logo-bottom' : ''}"><img src="${_escHtml(logoUrl)}" alt="Logo"></div>`
        : '';

    // Extra top padding on body when there's nothing above it (no logo-top, no title, no eyebrow)
    const hasTopContent = (logoPos === 'top' && logoUrl) || formTitle || s.eyebrow_text || s.secure_badge;
    const bodyPadTop = hasTopContent ? '20px' : '48px';

    // Build a fully self-contained HTML document for the iframe
    const motifClass = (s.bg_style === 'aurora' || s.bg_style === 'grid' || s.bg_style === 'dots')
        ? `pf-motif-${s.bg_style}` : '';

    const iframeDoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${gfTag}
<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
        margin: 0; padding: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        min-height: 100%;
    }
    body {
        display: flex; align-items: flex-start; justify-content: center; padding: 16px;
        position: relative;
        overflow: hidden;
        min-height: 100%;
        font-family: ${fontBody};
        ${bodyBg}
    }
    body::before, body::after {
        content: ""; position: fixed; pointer-events: none;
    }
    /* Background motifs — wired by .pf-motif-* classes on body */
    body.pf-motif-aurora::before {
        inset: -10%;
        background:
            radial-gradient(40vmax 30vmax at 18% 10%, rgba(124,58,237,0.45), transparent 60%),
            radial-gradient(35vmax 28vmax at 85% 90%, rgba(34,211,238,0.35), transparent 60%),
            radial-gradient(28vmax 22vmax at 50% 50%, rgba(99,102,241,0.20), transparent 60%);
        filter: blur(40px);
        opacity: 0.8;
    }
    body.pf-motif-grid::before {
        inset: 0;
        background-image:
            linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
        background-size: 48px 48px;
        mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
        -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
    }
    body.pf-motif-dots::before {
        inset: 0;
        background-image: radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px);
        background-size: 28px 28px;
    }
    .pf-card {
        width: 100%;
        max-width: ${s.form_width || 440}px;
        position: relative;
        background: ${cardBg};
        border-radius: ${radius};
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04);
        color: ${s.text_color};
        font-family: ${fontBody};
        overflow: hidden;
        ${cardBorder}
        ${glassyFilter}
    }
    .pf-close {
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 2;
        background: none;
        border: none;
        padding: 6px;
        border-radius: 8px;
        color: ${isDark ? '#a1a1aa' : '#71717a'};
        cursor: default;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .pf-header {
        padding: 20px 24px 0;
        padding-right: 48px;
    }
    .pf-title {
        font-family: ${fontHeading};
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: -0.02em;
        line-height: 1.15;
        color: ${s.text_color};
        ${titleGradient}
    }
    /* HUD corner brackets — small L-shapes top-left + bottom-right */
    .pf-hud {
        position: absolute;
        width: 14px;
        height: 14px;
        border-color: ${hexToRgba(s.button_color, 0.7)};
        pointer-events: none;
    }
    .pf-hud-tl { top: 8px; left: 8px; border-top: 1px solid; border-left: 1px solid; }
    .pf-hud-br { bottom: 8px; right: 8px; border-bottom: 1px solid; border-right: 1px solid; }
    /* Header strip across the top of the form card — two free-text
       slots (left + right) plus an optional coloured dot before the
       right slot. Both texts and the dot are tenant-configurable. */
    .pf-eyebrow-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px 4px;
        font-family: ${fontLabel};
        font-size: 0.65rem;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: ${s.label_color};
    }
    .pf-eyebrow { opacity: 0.8; }
    .pf-badge {
        display: inline-flex; align-items: center; gap: 6px;
        color: ${s.badge_dot ? s.badge_dot_color : s.label_color};
        opacity: 0.9;
    }
    .pf-badge-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: ${s.badge_dot_color || '#34D399'};
        box-shadow: 0 0 8px ${hexToRgba(s.badge_dot_color || '#34D399', 0.7)};
    }
    /* Segmented pill chips for select fields */
    .pf-pill-row {
        display: flex; flex-wrap: wrap; gap: 8px;
    }
    .pf-pill {
        font-family: ${fontLabel};
        font-size: 0.68rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        padding: 0.35rem 0.6rem;
        border-radius: 6px;
        border: 1px solid ${s.border_color};
        background: ${s.input_bg_color};
        color: ${s.label_color};
        cursor: default;
        white-space: nowrap;
        flex: 0 1 auto;
    }
    .pf-pill-active {
        border-color: ${hexToRgba(s.button_color, 0.5)};
        background: ${hexToRgba(s.button_color, 0.10)};
        color: ${s.text_color};
    }
    .pf-body { padding: ${bodyPadTop} 24px 24px; }
    /* N-column field grid (1-4, tenant-configurable). Each field can
       override its span via a width hint (full / half / third /
       quarter / two-thirds / three-quarters). Width values are clamped
       so a "quarter" field on a 2-col grid still occupies 1 column,
       never less. Falls back to single column on narrow viewports. */
    .pf-fields-grid {
        display: grid;
        grid-template-columns: repeat(${gridCols}, 1fr);
        gap: 14px 16px;
    }
    @media (max-width: 480px) {
        .pf-fields-grid { grid-template-columns: 1fr; }
        .pf-fields-grid > .pf-field { grid-column: 1 / -1; }
    }
    .pf-field { margin-bottom: 0; min-width: 0; }
    /* Span helper classes — pre-emitted up to 4 to keep CSS simple. */
    .pf-span-1 { grid-column: span 1; }
    .pf-span-2 { grid-column: span ${Math.min(gridCols, 2)}; }
    .pf-span-3 { grid-column: span ${Math.min(gridCols, 3)}; }
    .pf-span-4 { grid-column: span ${Math.min(gridCols, 4)}; }
    .pf-field--full { grid-column: 1 / -1; }
    /* Thin gradient hairline rule, used under the eyebrow + above the footer */
    .pf-hairline {
        height: 1px;
        margin: 14px 24px 0;
        background: linear-gradient(90deg, transparent, ${hexToRgba(s.border_color, 0.5)} 35%, ${hexToRgba(s.button_color, 0.5)} 75%, transparent);
    }
    /* Footer split: helper text on the left, submit button on the right.
       Falls back to centered button when footer_text is empty. */
    .pf-footer-row {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding: 18px 24px 22px;
    }
    .pf-footer-row .pf-submit { width: auto; padding: 0 24px; }
    .pf-footer-text {
        font-family: ${fontLabel};
        font-size: 0.65rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: ${s.label_color};
        opacity: 0.8;
    }
    .pf-label {
        display: block;
        font-family: ${fontLabel};
        font-size: 0.82rem;
        font-weight: 600;
        margin-bottom: 6px;
        color: ${s.label_color};
        ${labelTransform}
    }
    .pf-input {
        width: 100%;
        height: ${inputH}px;
        padding: 0 14px;
        font-size: 0.88rem;
        font-family: inherit;
        border: 1.5px solid ${s.border_color};
        border-radius: ${radius};
        background: ${s.input_bg_color};
        color: ${s.input_text_color};
        outline: none;
        box-sizing: border-box;
        transition: border-color 0.15s;
    }
    .pf-textarea {
        width: 100%;
        min-height: ${Math.round(inputH * 1.8)}px;
        padding: 8px 14px;
        font-size: 0.88rem;
        font-family: inherit;
        border: 1.5px solid ${s.border_color};
        border-radius: ${radius};
        background: ${s.input_bg_color};
        color: ${s.input_text_color};
        outline: none;
        box-sizing: border-box;
        resize: none;
    }
    .pf-submit {
        width: 100%;
        height: ${buttonH}px;
        padding: 0 20px;
        font-size: 0.95rem;
        font-weight: 600;
        font-family: ${fontBody};
        border: none;
        border-radius: ${radius};
        cursor: default;
        ${buttonGradient}
        color: ${s.button_text_color};
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 4px;
        box-shadow: ${s.button_gradient
            ? '0 14px 30px -10px ' + hexToRgba(s.button_color, 0.55) + ', inset 0 1px 0 rgba(255,255,255,0.22)'
            : '0 1px 3px rgba(0,0,0,0.12)'};
    }
    .pf-footer {
        text-align: center;
        padding: 0 24px 16px;
        font-size: 0.72rem;
        color: ${isDark ? '#52525b' : '#a1a1aa'};
    }
    .pf-footer span { font-weight: 500; }
    .pf-logo {
        text-align: center;
        padding: 16px 24px 4px;
    }
    .pf-logo-bottom {
        padding: 4px 24px 12px;
    }
    .pf-logo img {
        max-height: ${logoHeight}px;
        max-width: 80%;
        object-fit: contain;
    }
</style>
</head>
<body class="${motifClass}">
    <div class="pf-card">
        ${hudBracketsHtml}
        ${(s.eyebrow_text || s.badge_text) ? `
            <div class="pf-eyebrow-row">
                <span class="pf-eyebrow">${_escHtml(s.eyebrow_text || '')}</span>
                ${s.badge_text ? `<span class="pf-badge">${s.badge_dot ? '<span class="pf-badge-dot"></span>' : ''}${_escHtml(s.badge_text)}</span>` : ''}
            </div>
            ${s.hairlines ? '<div class="pf-hairline"></div>' : ''}
        ` : ''}
        <button class="pf-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${logoPos === 'top' ? logoHtml : ''}
        ${formTitle ? `<div class="pf-header"><div class="pf-title">${_escHtml(formTitle)}</div></div>` : ''}
        <div class="pf-body">
            ${fieldsHtml}
        </div>
        ${s.hairlines ? '<div class="pf-hairline" style="margin-top:0;"></div>' : ''}
        ${s.footer_text ? `
            <div class="pf-footer-row">
                <span class="pf-footer-text">${_escHtml(s.footer_text)}</span>
                <button disabled class="pf-submit">${_escHtml(s.button_text || 'Submit')}</button>
            </div>
        ` : `
            <div style="padding: 0 24px 22px;">
                <button disabled class="pf-submit">${_escHtml(s.button_text || 'Submit')}</button>
            </div>
        `}
        ${logoPos === 'bottom' ? logoHtml : ''}
        <div class="pf-footer">Powered by <span>Ragenaizer</span></div>
    </div>
</body>
</html>`;

    // Render into an iframe for complete CSS isolation
    let iframe = container.querySelector('iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.style.cssText = 'width: 100%; border: none; display: block; border-radius: 8px; overflow: hidden;';
        iframe.setAttribute('sandbox', 'allow-same-origin');
        container.innerHTML = '';
        container.appendChild(iframe);
    }
    iframe.srcdoc = iframeDoc;

    // Auto-resize iframe height to fit content
    iframe.onload = () => {
        try {
            const body = iframe.contentDocument?.body;
            if (body) {
                iframe.style.height = body.scrollHeight + 'px';
            }
        } catch (e) { /* cross-origin guard */ }
    };
}

// Build the body background CSS for the preview iframe based on bg_style.
// solid → flat color taken from text_color contrast guess
// gradient → linear violet→navy
// aurora → solid base + ::before blob layer (set via class on body)
// grid/dots → solid base + ::before pattern (set via class on body)
function buildPreviewBodyBg(s) {
    const isDark = s.theme === 'dark';
    const base = isDark ? '#07080F' : '#f7f8fc';
    if (s.bg_style === 'gradient') {
        return isDark
            ? 'background: linear-gradient(135deg, #07080F 0%, #1F1B3E 50%, #07080F 100%);'
            : 'background: linear-gradient(135deg, #f7f8fc 0%, #ede9fe 100%);';
    }
    if (s.bg_style === 'aurora' || s.bg_style === 'grid' || s.bg_style === 'dots') {
        return `background: ${base};`;
    }
    // Solid — keep the existing pleasant demo gradient on light themes,
    // and a clean navy on dark themes, so opacity preview still reads.
    return isDark
        ? 'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);'
        : `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);`;
}

// Lightweight HTML escape for preview (avoids dependency on global escapeHtml)
function _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function openFormStylingModal(id) {
    formStylingSourceId = id;
    const source = leadSources.find(s => s.id === id);
    if (!source) return;

    initFormStylingSync();

    document.getElementById('formStylingSourceId').value = id;
    document.getElementById('formStylingSourceName').textContent = source.source_name || '';

    // Parse existing styling or use defaults
    let styling = {};
    if (source.form_styling && source.form_styling !== '{}') {
        try {
            styling = typeof source.form_styling === 'string'
                ? JSON.parse(source.form_styling)
                : source.form_styling;
        } catch (e) { /* use empty */ }
    }

    const theme = styling.theme || 'light';
    const defaults = theme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
    const merged = { ...defaults, ...styling };

    populateFormStylingControls(merged);

    // Cache field metadata for preview
    try {
        const crmBase = getCrmBaseUrl();
        const crmOrigin = typeof CONFIG !== 'undefined' && CONFIG.endpoints?.crm
            ? CONFIG.endpoints.crm
            : crmBase.replace(/\/api\/?$/, '');
        const res = await fetch(`${crmOrigin}/api/leads/capture/${source.webhook_key}/form-config?v=${Date.now()}`);
        if (res.ok) {
            const config = await res.json();
            formStylingFields = config.fields || null;
        }
    } catch (e) {
        formStylingFields = null;
    }

    renderStylingPreview();
    openModal('formStylingModal');
}

function closeFormStylingModal() {
    closeModal('formStylingModal');
    formStylingSourceId = null;
    formStylingFields = null;
}

function resetFormStylingDefaults() {
    const theme = document.getElementById('fsTheme')?.value || 'light';
    const defaults = theme === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS;
    populateFormStylingControls(defaults);
    renderStylingPreview();
}

async function saveFormStyling() {
    if (!formStylingSourceId) return;

    const saveBtn = document.getElementById('saveFormStylingBtn');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span>Saving...';

    try {
        const styling = getFormStylingValues();

        // Derive button_hover_color as slightly darker version of button_color
        const bc = styling.button_color;
        styling.button_hover_color = darkenHex(bc, 15);

        await api.request(`/crm/lead-sources/${formStylingSourceId}`, {
            method: 'PUT',
            body: JSON.stringify({
                form_styling: JSON.stringify(styling)
            })
        });

        Toast.success('Form styling saved successfully');
        closeFormStylingModal();
        await loadLeadSources();
    } catch (error) {
        console.error('Error saving form styling:', error);
        Toast.error(error.message || 'Failed to save styling');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

function darkenHex(hex, percent) {
    if (!hex) return '#4f46e5';
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    r = Math.max(0, Math.round(r * (1 - percent / 100)));
    g = Math.max(0, Math.round(g * (1 - percent / 100)));
    b = Math.max(0, Math.round(b * (1 - percent / 100)));
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

// ─── Danger Zone: tenant wipe handlers ──────────────────────────────────────
// All endpoints derive tenant_id from the JWT — we never send it, so a
// SUPERADMIN can only wipe their own tenant.
let _pendingWipeMode = null;
// For mode='range', stash the validated start/end dates here so confirmWipe()
// can pass them to the wipe call without re-reading the inputs (and without
// risking a state mismatch if the user touches the date pickers between
// "Preview" and "Confirm Wipe").
let _pendingWipeRange = null;

function openWipeModal(mode) {
    _pendingWipeMode = mode;
    _pendingWipeRange = null;
    const titleEl = document.getElementById('wipeModalTitle');
    const descEl = document.getElementById('wipeModalDescription');
    const tenantEl = document.getElementById('wipeTenantId');
    const inputEl = document.getElementById('wipeConfirmInput');
    const btn = document.getElementById('wipeConfirmBtn');

    // Pull tenant_id from the JWT for display only — server uses its own claim.
    let tenantId = '(unknown)';
    try {
        const tok = localStorage.getItem('ragenaizer_authToken') || '';
        const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        tenantId = payload.tenant_id || '(unknown)';
    } catch {}
    tenantEl.textContent = tenantId;

    if (mode === 'leads') {
        titleEl.textContent = 'Wipe Lead Data';
        descEl.innerHTML = 'This will delete <strong>all leads, contacts, deals, companies, activities, notes, tasks, and history</strong> for this tenant. Teams, members, functional areas, deal stages, lead sources, integrations, and settings will be preserved.';
    } else if (mode === 'range') {
        const startDate = document.getElementById('wipeRangeStartDate').value;
        const endDate = document.getElementById('wipeRangeEndDate').value;
        if (!startDate || !endDate) {
            Toast.error('Pick both a start and an end date first.');
            return;
        }
        if (endDate < startDate) {
            Toast.error('End date must be on or after start date.');
            return;
        }
        _pendingWipeRange = { startDate, endDate };
        titleEl.textContent = 'Wipe Leads by Date Range';
        descEl.innerHTML = `This will delete <strong>leads created between ${startDate} and ${endDate}</strong> (inclusive on both ends), plus all their lead-scoped child rows: activities, follow-ups, email sends (and their events/replies), tasks, notes, transfer/help requests, assignment history. <strong>Companies, contacts, and deals are NOT deleted</strong> — they can belong to leads outside this range.`;
    } else {
        titleEl.textContent = 'Wipe All CRM Data';
        descEl.innerHTML = 'This will delete <strong>EVERYTHING</strong> for this tenant — including teams, members, functional areas, deal stages, lead sources, integrations, and CRM settings. Use only when seeding a fresh tenant.';
    }

    inputEl.value = '';
    btn.disabled = true;
    document.getElementById('wipeModal').classList.add('active');
    setTimeout(() => inputEl.focus(), 50);
}

// Show the row counts that the wipe-leads-by-range call would delete.
// Pure read — no DB writes — so safe to run as often as the user clicks.
async function previewWipeLeadsByRange() {
    const startDate = document.getElementById('wipeRangeStartDate').value;
    const endDate = document.getElementById('wipeRangeEndDate').value;
    const previewEl = document.getElementById('wipeRangePreview');
    if (!startDate || !endDate) {
        previewEl.innerHTML = '<span style="color:var(--color-warning);">Pick both a start and an end date.</span>';
        return;
    }
    if (endDate < startDate) {
        previewEl.innerHTML = '<span style="color:var(--color-danger);">End date must be on or after start date.</span>';
        return;
    }
    previewEl.textContent = 'Counting…';
    try {
        const res = await api.request('/crm/crm-admin/wipe-leads-by-range/preview', {
            method: 'POST',
            body: JSON.stringify({ start_date: startDate, end_date: endDate })
        });
        if (res.leads_count === 0) {
            previewEl.innerHTML = `<span style="color:var(--text-secondary);">No leads created between <strong>${startDate}</strong> and <strong>${endDate}</strong> — nothing to wipe.</span>`;
            return;
        }
        // The parenthetical used to read "(tasks, notes, transfer/help
        // requests, assignment history)". That list was written when the
        // backend counted five other tables; it counts twelve now, and the
        // omitted ones are the alarming ones — call recordings, transcripts
        // and quality scores. An admin reading the old label would conclude
        // their call history survived this wipe. It does not.
        //
        // Naming the destructive categories explicitly and ending with "and
        // other lead-scoped records" keeps it accurate without pinning the
        // copy to a table list that will drift again.
        previewEl.innerHTML = `Will delete <strong>${res.leads_count} leads</strong>, ${res.activities_count} activities, ${res.followups_count} follow-ups, ${res.email_sends_count} email sends, and ${res.other_child_rows_count} other child rows — including <strong>call records, recordings, transcripts and call scores</strong>, sequence enrolments, WhatsApp campaign recipients, tasks, notes and assignment history. <strong>Total: ${res.total_rows_count} rows.</strong> Companies, contacts, and deals are not deleted.`;
    } catch (e) {
        console.error('Preview wipe failed:', e);
        // Use the canonical escapeHtml (defined at top of file) instead of
        // the inline .replace(/</g) which only covered '<' and would let
        // attacker-controlled error messages slip ">"/quote-based XSS through.
        previewEl.innerHTML = `<span style="color:var(--color-danger);">${escapeHtml(e.message || 'Preview failed')}</span>`;
    }
}

function closeWipeModal() {
    document.getElementById('wipeModal').classList.remove('active');
    _pendingWipeMode = null;
}

function onWipeInputChange() {
    const val = document.getElementById('wipeConfirmInput').value;
    document.getElementById('wipeConfirmBtn').disabled = (val !== 'WIPE');
}

async function confirmWipe() {
    const mode = _pendingWipeMode;
    const btn = document.getElementById('wipeConfirmBtn');
    if (!mode || document.getElementById('wipeConfirmInput').value !== 'WIPE') return;

    let endpoint, body;
    if (mode === 'leads') {
        endpoint = '/crm/crm-admin/wipe-leads';
        body = { confirm: 'WIPE' };
    } else if (mode === 'range') {
        if (!_pendingWipeRange) { Toast.error('Date range missing — re-open the modal.'); return; }
        endpoint = '/crm/crm-admin/wipe-leads-by-range';
        body = { confirm: 'WIPE', start_date: _pendingWipeRange.startDate, end_date: _pendingWipeRange.endDate };
    } else {
        endpoint = '/crm/crm-admin/wipe-all';
        body = { confirm: 'WIPE' };
    }

    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Wiping...';

    try {
        const res = await api.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        Toast.success(`Wiped — ${res.deleted_rows} rows deleted (${res.scope}).`);
        closeWipeModal();
        // Bounce to dashboard so the user sees a fresh state. For range wipes
        // stay on settings — there's still other data to manage and the user
        // probably wants to verify the count by checking the leads page anyway.
        if (mode === 'range') {
            // Reset the range form + clear the preview blurb so it doesn't
            // mislead about a now-stale count.
            document.getElementById('wipeRangeStartDate').value = '';
            document.getElementById('wipeRangeEndDate').value = '';
            const previewEl = document.getElementById('wipeRangePreview');
            if (previewEl) previewEl.textContent = '';
        } else {
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
        }
    } catch (e) {
        console.error('Wipe failed:', e);
        Toast.error(e.message || 'Wipe failed');
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ─── Lead deletion audit log ────────────────────────────────────────────────
// Reads /api/leads/deletion-log (CRM admins + superadmin) and renders the rows
// inside the Danger Zone modal. Date pickers are optional — both ends blank
// = full history.

let _deletionLogState = { page: 1, pageSize: 50, total: 0 };

function openDeletionLogModal() {
    document.getElementById('deletionLogModal').classList.add('active');
    _deletionLogState.page = 1;
    loadDeletionLog();
}

function closeDeletionLogModal() {
    document.getElementById('deletionLogModal').classList.remove('active');
}

async function loadDeletionLog() {
    const tbody = document.getElementById('deletionLogTbody');
    const totalEl = document.getElementById('deletionLogTotalCount');
    const pagerEl = document.getElementById('deletionLogPager');
    if (!tbody) return;

    const fromEl = document.getElementById('deletionLogFrom');
    const toEl   = document.getElementById('deletionLogTo');
    const params = new URLSearchParams();
    params.set('page', _deletionLogState.page);
    params.set('pageSize', _deletionLogState.pageSize);
    if (fromEl?.value) params.set('from', fromEl.value);
    if (toEl?.value)   params.set('to',   toEl.value);

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-secondary);">Loading…</td></tr>';
    try {
        const res = await api.request('/crm/leads/deletion-log?' + params.toString());
        const items = res?.data || [];
        _deletionLogState.total = res?.total ?? items.length;

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-secondary);">No deletions in this window.</td></tr>';
        } else {
            tbody.innerHTML = items.map(r => {
                const when = r.performed_at ? new Date(r.performed_at).toLocaleString() : '—';
                const actor = r.performed_by_name || r.performed_by_email || r.performed_by_user_id || '—';
                const actorEmail = r.performed_by_email && r.performed_by_name ? `<div style="color:var(--text-secondary); font-size:0.78rem;">${escapeHtml(r.performed_by_email)}</div>` : '';
                const leadDisplay = `${escapeHtml(r.lead_name || '(unnamed)')}${r.lead_number ? `<div style="color:var(--text-secondary); font-size:0.78rem;">${escapeHtml(r.lead_number)}</div>` : ''}`;
                const contact = [r.lead_email, r.lead_phone].filter(Boolean).map(escapeHtml).join('<br>');
                let source = '';
                if (r.lead_source_name) {
                    source = escapeHtml(r.lead_source_name);
                    if (r.lead_source) source += ` <span style="color:var(--text-secondary);">· ${escapeHtml(r.lead_source)}</span>`;
                } else if (r.lead_source) {
                    source = escapeHtml(r.lead_source);
                } else {
                    source = '<span style="color:var(--text-secondary);">— manual / import —</span>';
                }
                return `<tr>
                    <td>${escapeHtml(when)}</td>
                    <td>${escapeHtml(actor)}${actorEmail}</td>
                    <td>${leadDisplay}</td>
                    <td>${contact || '—'}</td>
                    <td>${source}</td>
                </tr>`;
            }).join('');
        }

        if (totalEl) totalEl.textContent = `${_deletionLogState.total} deletion(s)`;

        // Pager: just prev / next buttons. The total doubles as "where am I".
        if (pagerEl) {
            const totalPages = Math.max(1, Math.ceil(_deletionLogState.total / _deletionLogState.pageSize));
            pagerEl.innerHTML = `
                <button class="btn btn-outline-secondary btn-sm" ${_deletionLogState.page <= 1 ? 'disabled' : ''} onclick="_deletionLogPage(-1)">‹ Prev</button>
                <span style="color:var(--text-secondary); font-size:0.85rem; align-self:center;">Page ${_deletionLogState.page} / ${totalPages}</span>
                <button class="btn btn-outline-secondary btn-sm" ${_deletionLogState.page >= totalPages ? 'disabled' : ''} onclick="_deletionLogPage(1)">Next ›</button>`;
        }
    } catch (e) {
        console.error('Failed to load deletion log:', e);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--color-danger);">${escapeHtml(e?.message || 'Failed to load deletion log')}</td></tr>`;
    }
}

function _deletionLogPage(delta) {
    _deletionLogState.page = Math.max(1, _deletionLogState.page + delta);
    loadDeletionLog();
}

// ═══════════════════════════════════════════════════════════════════════════
// Google Sheets integration
// Parallels the Facebook flow: card shows connected accounts + connected sheets,
// modal walks through spreadsheet picker → tab picker → field mapping.
// ═══════════════════════════════════════════════════════════════════════════

// CRM-field vocabulary offered in the mapping dropdown. Mirrors what the
// backend's BuildLead recognizes — extending both here and in
// GoogleSheetsPollingService.BuildLead keeps the two aligned.
const GS_CRM_FIELDS = [
    { value: 'skip',           label: '— Ignore this column —' },
    { value: 'source_lead_id', label: 'Unique row ID (dedup)' },
    { value: 'first_name',     label: 'First name' },
    { value: 'last_name',      label: 'Last name' },
    { value: 'full_name',      label: 'Full name (split on first space)' },
    { value: 'email',          label: 'Email' },
    { value: 'phone',          label: 'Phone' },
    { value: 'company_name',   label: 'Company name' },
    { value: 'job_title',      label: 'Job title' },
    { value: '__custom__',     label: 'Custom field…' },
];

let _gsConnections = [];
let _gsSelectedConnectionId = null;
let _gsSelectedSpreadsheet = null;   // { spreadsheetId, name }
let _gsSelectedTab = null;           // { name, index }
let _gsHeaders = [];
let _gsSampleRows = [];
// SearchableDropdown instances for the OAuth mapping table. Tracked so we can
// read values on save and dispose them cleanly when the table re-renders.
let _gsColDropdowns = new Map();     // col letter -> SearchableDropdown
let _gsRowIdDropdown = null;
let _gsSearchTimer = null;
let _gsServiceAccount = { enabled: false, email: null };
// Cached list of connected sheets — used to pre-select the saved team in the
// connect/share modal when a tenant re-connects the same sheet+tab, so the
// "Assign manually later" default doesn't silently nuke their previously
// chosen team. Refreshed on every loadGoogleSheetsState().
let _gsConnectedSheets = [];

async function loadGoogleSheetsState() {
    try {
        // SA info fetched in parallel so the share button visibility flips
        // in one render pass with the rest of the card.
        const [conns, sheets, saInfo] = await Promise.all([
            api.request('/crm/GoogleSheets/connections'),
            api.request('/crm/GoogleSheets/sheets'),
            api.request('/crm/GoogleSheets/service-account/info').catch(() => ({ enabled: false }))
        ]);
        _gsConnections = conns || [];
        _gsConnectedSheets = Array.isArray(sheets) ? sheets : [];
        _gsServiceAccount = saInfo || { enabled: false };
        renderGoogleSheetsCard(_gsConnections, _gsConnectedSheets);
        // Lazy-start the realtime hub once data is on screen so the user
        // never sees stale "last sync" timestamps.
        setupGoogleSheetsRealtime();
    } catch (e) {
        console.error('Failed to load Google Sheets state:', e);
    }
}

// ─── SignalR live updates for the Integrations tab ────────────────────
//
// The Hangfire poller fires CrmEvents.GoogleSheetSynced on every tick per
// source. We listen so the connected-sheets table refreshes its "Last sync"
// column in real time, and the Logs modal refreshes if it's open for the
// affected source. Without this, the user has to keep clicking Refresh.
let _gsHubConnection = null;
function setupGoogleSheetsRealtime() {
    if (_gsHubConnection) return; // already wired
    if (typeof signalR === 'undefined') return;
    if (!api.isAuthenticated || !api.isAuthenticated()) return;
    const hubUrl = (typeof CONFIG !== 'undefined' && CONFIG.crmSignalRHubUrl) ? CONFIG.crmSignalRHubUrl : null;
    if (!hubUrl) return;

    try {
        _gsHubConnection = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, { accessTokenFactory: () => api.token || '' })
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        _gsHubConnection.on('GoogleSheetSynced', (payload) => {
            // Debounce: a tick processing 30 leads will fan out 30 NewLeadReceived
            // events, but only ONE GoogleSheetSynced per source. Still throttle
            // to coalesce bursts when many sources finish back-to-back.
            if (window._gsHubRefreshTimer) return;
            window._gsHubRefreshTimer = setTimeout(() => {
                window._gsHubRefreshTimer = null;
                loadGoogleSheetsState().catch(e => console.warn('GS realtime refresh failed:', e));
                // If the Logs modal is open for the source that just finished,
                // refresh it too — same trick the dashboard uses.
                if (_gsSyncLogsCurrentSourceId && payload?.leadSourceId === _gsSyncLogsCurrentSourceId) {
                    refreshGoogleSheetSyncLogs();
                }
            }, 600);
        });

        _gsHubConnection.start().catch(e => {
            // Transient connection failures don't matter — withAutomaticReconnect
            // handles it. The 2-min Hangfire cadence is the worst-case fallback.
            console.warn('GS hub: failed to connect', e?.message || e);
        });
    } catch (e) {
        console.warn('GS hub setup failed:', e?.message || e);
        _gsHubConnection = null;
    }
}

// ─── Google Sheets connections — compact table view ─────────────────────
// State for the filter/search/pagination toolbar. Kept in module scope so
// pill clicks, search input, and account dropdown can all mutate it without
// touching the underlying connection/sheet caches.
const _gsList = {
    accountFilter: 'all',  // 'all' | connection_id | 'sa'
    statusFilter: 'all',   // 'all' | 'active' | 'paused' | 'stale'
    search: '',
    page: 1,
    pageSize: 10,
    accountDropdown: null, // SearchableDropdown instance for account filter
    rows: [],              // flattened, normalized rows ready to render
};
const GS_STALE_HOURS = 24;
const GS_SA_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

function gsClassifyStatus(sheet) {
    if (!sheet.is_active) return 'paused';
    if (!sheet.last_polled_at) return 'active'; // pending first sync — treat as active, not stale
    const ageHours = (Date.now() - new Date(sheet.last_polled_at).getTime()) / 3600000;
    if (ageHours > GS_STALE_HOURS) return 'stale';
    return 'active';
}

function gsBuildRows(connections, sheets) {
    const accountByConn = new Map();
    connections.forEach(c => accountByConn.set(c.id, c.google_email));
    return sheets.map(s => {
        const isSa = !s.connection_id || s.connection_id === GS_SA_CONNECTION_ID;
        return {
            lead_source_id: s.lead_source_id,
            connection_id: isSa ? 'sa' : s.connection_id,
            // Carried through for the mapping editor: it re-opens the wizard's
            // mapping step against this exact sheet, so it needs the id and
            // the mapping/assignment state the PUT would otherwise overwrite.
            spreadsheet_id: s.spreadsheet_id,
            field_mappings: s.field_mappings,
            auto_assign_user_id: s.auto_assign_user_id ?? null,
            auto_assign_team_id: s.auto_assign_team_id ?? null,
            spreadsheet_name: s.spreadsheet_name || s.source_name || '(untitled sheet)',
            sheet_tab_name: s.sheet_tab_name || '',
            source_name: s.source_name || '',
            account_label: isSa ? 'Shared (no sign-in)' : (accountByConn.get(s.connection_id) || '—'),
            account_is_sa: isSa,
            is_active: !!s.is_active,
            last_polled_at: s.last_polled_at,
            total_leads_received: s.total_leads_received || 0,
            status: gsClassifyStatus(s),
        };
    });
}

function renderGoogleSheetsCard(connections, sheets) {
    const statusDot = document.getElementById('gsStatusDot');
    const statusText = document.getElementById('gsStatusText');
    const wrap = document.getElementById('gsConnectionsWrap');
    const shareBtn = document.getElementById('gsShareBtn');
    if (!statusDot || !wrap) return;

    if (shareBtn) shareBtn.style.display = _gsServiceAccount?.enabled ? 'inline-flex' : 'none';

    const activeConns = connections.filter(c => c.is_active);
    const saSheets = sheets.filter(s => !s.connection_id || s.connection_id === GS_SA_CONNECTION_ID);

    if (activeConns.length === 0 && saSheets.length === 0) {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Not connected';
        wrap.style.display = 'none';
        _gsList.rows = [];
        return;
    }

    statusDot.classList.remove('disconnected');
    statusDot.classList.add('connected');
    const parts = [];
    if (activeConns.length > 0) parts.push(`${activeConns.length} account${activeConns.length === 1 ? '' : 's'}`);
    if (saSheets.length > 0) parts.push(`${saSheets.length} shared`);
    parts.push(`${sheets.length} sheet${sheets.length === 1 ? '' : 's'}`);
    statusText.textContent = 'Connected (' + parts.join(', ') + ')';

    _gsList.rows = gsBuildRows(connections, sheets);
    wrap.style.display = 'block';
    gsRenderAccountFilter(activeConns, saSheets.length > 0);
    gsWireToolbarOnce();
    gsRenderTable();
}

function gsRenderAccountFilter(activeConns, hasSa) {
    const container = document.getElementById('gsAccountFilter');
    if (!container) return;
    const opts = [{ value: 'all', label: `All accounts (${activeConns.length + (hasSa ? 1 : 0)})` }];
    activeConns.forEach(c => opts.push({ value: c.id, label: c.google_email }));
    if (hasSa) opts.push({ value: 'sa', label: 'Shared sheets (no sign-in)' });

    // Rebuild from scratch so the option set stays in sync as accounts come
    // and go. We can't call SearchableDropdown.destroy() because its destroy
    // removes the host container itself from the DOM — we need the same
    // #gsAccountFilter div around for the next mount.
    container.innerHTML = '';
    _gsList.accountDropdown = null;
    _gsList.accountDropdown = new SearchableDropdown(container, {
        options: opts,
        placeholder: 'All accounts',
        searchPlaceholder: 'Search accounts…',
        compact: true,
        onChange: (val) => {
            _gsList.accountFilter = val || 'all';
            _gsList.page = 1;
            gsRenderTable();
        }
    });
    if (_gsList.accountDropdown.setValue) _gsList.accountDropdown.setValue(_gsList.accountFilter);
}

let _gsToolbarWired = false;
function gsWireToolbarOnce() {
    if (_gsToolbarWired) return;
    _gsToolbarWired = true;

    document.querySelectorAll('#gsStatusPills .gs-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#gsStatusPills .gs-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _gsList.statusFilter = btn.getAttribute('data-status');
            _gsList.page = 1;
            gsRenderTable();
        });
    });

    const search = document.getElementById('gsSearchInput');
    if (search) {
        let t = null;
        search.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => {
                _gsList.search = (search.value || '').trim().toLowerCase();
                _gsList.page = 1;
                gsRenderTable();
            }, 200);
        });
    }
}

function gsApplyFilters(rows) {
    return rows.filter(r => {
        if (_gsList.accountFilter !== 'all' && r.connection_id !== _gsList.accountFilter) return false;
        if (_gsList.statusFilter !== 'all' && r.status !== _gsList.statusFilter) return false;
        if (_gsList.search) {
            const hay = `${r.spreadsheet_name} ${r.sheet_tab_name} ${r.source_name} ${r.account_label}`.toLowerCase();
            if (!hay.includes(_gsList.search)) return false;
        }
        return true;
    });
}

function gsRenderTable() {
    const tbody = document.getElementById('gsSheetsTableBody');
    if (!tbody) return;

    // Update pill counts (always against the unfiltered set so users can see the total).
    const counts = { all: _gsList.rows.length, active: 0, paused: 0, stale: 0 };
    _gsList.rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
    set('gsCountAll', counts.all);
    set('gsCountActive', counts.active);
    set('gsCountPaused', counts.paused);
    set('gsCountStale', counts.stale);

    const filtered = gsApplyFilters(_gsList.rows);
    const totalPages = Math.max(1, Math.ceil(filtered.length / _gsList.pageSize));
    if (_gsList.page > totalPages) _gsList.page = totalPages;
    const start = (_gsList.page - 1) * _gsList.pageSize;
    const pageRows = filtered.slice(start, start + _gsList.pageSize);

    if (filtered.length === 0) {
        const msg = _gsList.rows.length === 0
            ? 'No sheets connected yet. Click <strong>Connect via sheet share</strong> above to add one.'
            : 'No sheets match the current filters.';
        tbody.innerHTML = `<tr class="gs-empty-row"><td colspan="7">${msg}</td></tr>`;
    } else {
        tbody.innerHTML = pageRows.map(r => {
            const statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
            const lastSync = r.last_polled_at ? formatRelative(r.last_polled_at) : 'Pending';
            const accountTag = r.account_is_sa ? '<span class="gs-account-tag">SA</span>' : '';
            const toggleLabel = r.is_active ? 'Pause' : 'Resume';
            return `
                <tr data-source-id="${escapeHtml(r.lead_source_id)}">
                    <td>
                        <div class="crm-cell-primary">${escapeHtml(r.spreadsheet_name)}</div>
                        <div class="crm-cell-secondary">&rsaquo; ${escapeHtml(r.sheet_tab_name || '—')}</div>
                    </td>
                    <td>${escapeHtml(r.source_name || '—')}</td>
                    <td><div class="gs-account-cell" title="${escapeHtml(r.account_label)}">${accountTag}${escapeHtml(r.account_label)}</div></td>
                    <td><span class="gs-status-badge gs-status-${r.status}">${statusLabel}</span></td>
                    <td style="text-align:right;">${r.total_leads_received.toLocaleString()}</td>
                    <td>${escapeHtml(lastSync)}</td>
                    <td class="gs-actions-cell">
                        <button class="btn btn-sm btn-primary" onclick="syncGoogleSheetNow('${escapeHtmlJsAttr(r.lead_source_id)}', this)" title="Re-scan sheet from row 1. Already-imported leads stay untouched.">Sync now</button>
                        <button class="btn btn-sm btn-outline" onclick="openGoogleSheetSyncLogs('${escapeHtmlJsAttr(r.lead_source_id)}', '${escapeHtmlJsAttr(r.spreadsheet_name)}', '${escapeHtmlJsAttr(r.sheet_tab_name || '')}')" title="Polling sync history">Logs</button>
                        <button class="btn btn-sm btn-outline" onclick="openActivityLog('/crm/GoogleSheets/sources/${escapeHtml(r.lead_source_id)}/audit-log?limit=200', '${escapeHtmlJsAttr(r.spreadsheet_name)}')" title="Audit trail — who paused / resumed / disconnected, with timestamps">Activity</button>
                        <button class="btn btn-sm btn-outline" onclick="openGoogleSheetMappingEditor('${escapeHtmlJsAttr(r.lead_source_id)}')" title="Change which sheet column feeds which CRM field. Applies from the next sync.">Mapping</button>
                        <button class="btn btn-sm btn-outline" onclick="toggleGoogleSheet('${escapeHtmlJsAttr(r.lead_source_id)}', ${!r.is_active})">${toggleLabel}</button>
                        <!-- Remove hidden (May 2026): identical DB effect as Pause but
                             confused users into thinking their data was wiped.
                             Disconnect at the Google account level for full revoke. -->
                    </td>
                </tr>
            `;
        }).join('');
    }

    gsRenderPagination(filtered.length, totalPages);
}

function gsRenderPagination(filteredCount, totalPages) {
    const wrap = document.getElementById('gsPagination');
    const info = document.getElementById('gsPaginationInfo');
    const buttons = document.getElementById('gsPaginationButtons');
    if (!wrap || !info || !buttons) return;

    if (filteredCount <= _gsList.pageSize) {
        // CSS rule on .crm-pagination has `display: grid !important` so an
        // inline style can't hide it without also using !important.
        wrap.style.setProperty('display', 'none', 'important');
        info.textContent = '';
        buttons.innerHTML = '';
        return;
    }
    wrap.style.setProperty('display', 'grid', 'important');

    const start = (_gsList.page - 1) * _gsList.pageSize + 1;
    const end = Math.min(_gsList.page * _gsList.pageSize, filteredCount);
    info.textContent = `Showing ${start}–${end} of ${filteredCount}`;

    const btn = (label, page, opts = {}) => {
        const disabled = opts.disabled ? 'disabled' : '';
        const active = opts.active ? 'active' : '';
        return `<button class="crm-page-btn ${active}" ${disabled} data-page="${page}">${label}</button>`;
    };
    const parts = [btn('‹', _gsList.page - 1, { disabled: _gsList.page === 1 })];
    // Compact numeric range — show first, last, and a window around current.
    const window = 1;
    const pages = new Set([1, totalPages, _gsList.page]);
    for (let i = _gsList.page - window; i <= _gsList.page + window; i++) {
        if (i > 1 && i < totalPages) pages.add(i);
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    let prev = 0;
    sorted.forEach(p => {
        if (p - prev > 1) parts.push('<span class="crm-page-ellipsis">…</span>');
        parts.push(btn(String(p), p, { active: p === _gsList.page }));
        prev = p;
    });
    parts.push(btn('›', _gsList.page + 1, { disabled: _gsList.page === totalPages }));
    buttons.innerHTML = parts.join('');
    buttons.querySelectorAll('button[data-page]').forEach(b => {
        b.addEventListener('click', () => {
            const p = parseInt(b.getAttribute('data-page'), 10);
            if (!Number.isFinite(p) || p < 1 || p > totalPages) return;
            _gsList.page = p;
            gsRenderTable();
        });
    });
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatRelative(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate);
    const ms = Date.now() - d.getTime();
    const s = Math.round(ms / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
}

async function connectGoogleSheets() {
    const btn = document.getElementById('gsConnectBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening Google…'; }
    try {
        const res = await api.request('/crm/GoogleSheets/auth-url');
        if (!res || !res.auth_url) throw new Error('No auth URL returned');
        // Full-page redirect so the callback comes back to THIS page with google_status=...
        window.location.href = res.auth_url;
    } catch (e) {
        console.error('Failed to start Google OAuth:', e);
        Toast.error(e.message || 'Could not start Google sign-in');
        if (btn) { btn.disabled = false; btn.textContent = 'Connect Google Account'; }
    }
}

async function disconnectGoogleAccount(connectionId, email) {
    const ok = await showConfirm(
        `Disconnect Google account ${email}? All sheets from this account will stop syncing.`,
        'Disconnect Google account',
        'danger'
    );
    if (!ok) return;
    try {
        await api.request(`/crm/GoogleSheets/connections/${connectionId}`, { method: 'DELETE' });
        Toast.success('Google account disconnected.');
        await loadGoogleSheetsState();
    } catch (e) {
        Toast.error(e.message || 'Failed to disconnect Google account');
    }
}

async function toggleGoogleSheet(sourceId, makeActive) {
    try {
        await api.request(`/crm/GoogleSheets/sheets/${sourceId}/toggle`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !!makeActive })
        });
        Toast.success(makeActive ? 'Resumed syncing.' : 'Paused.');
        await loadGoogleSheetsState();
    } catch (e) {
        Toast.error(e.message || 'Failed to toggle sheet');
    }
}

// Manual on-demand sync. Backend resets the cursor to 0 and dedups by
// source_lead_id, so already-imported leads are NEVER touched — the rescan
// only inserts rows that were silently skipped or are new since the last
// successful tick. Runs as a Hangfire background job; the UI refreshes
// automatically when the SignalR `GoogleSheetSynced` event fires.
async function syncGoogleSheetNow(sourceId, btnEl) {
    const ok = await showConfirm(
        'Re-scan this sheet from the top? Already-imported leads stay untouched (dedup by lead id) — only missing or new rows get added.',
        'Sync now',
        'primary'
    );
    if (!ok) return;
    const original = btnEl ? btnEl.textContent : null;
    if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Queuing…'; }
    try {
        const res = await api.request(`/crm/GoogleSheets/sources/${sourceId}/sync-now?fullRescan=true`, { method: 'POST' });
        Toast.success(res?.message || 'Sync queued — results will appear shortly.');
        // Don't poll — the existing SignalR `GoogleSheetSynced` listener
        // refreshes the table and Logs modal as each batch finishes.
    } catch (e) {
        Toast.error(e.message || 'Failed to start sync');
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.textContent = original || 'Sync now';
        }
    }
}

async function disconnectGoogleSheet(sourceId) {
    const ok = await showConfirm(
        'Stop syncing this sheet? Existing leads stay in the CRM.',
        'Disconnect sheet',
        'danger'
    );
    if (!ok) return;
    try {
        await api.request(`/crm/GoogleSheets/sheets/${sourceId}`, { method: 'DELETE' });
        Toast.success('Sheet disconnected.');
        await loadGoogleSheetsState();
    } catch (e) {
        Toast.error(e.message || 'Failed to disconnect sheet');
    }
}

// ─── Sync logs modal (per-source audit trail) ─────────────────────────────
//
// The Logs action button on each connected sheet calls openGoogleSheetSyncLogs
// to surface the latest 50 google_sheet_sync_log entries from the backend.
// Lets admins answer "did the sync run today?" without grepping logs.
let _gsSyncLogsCurrentSourceId = null;

function openGoogleSheetSyncLogs(sourceId, spreadsheetName, sheetTabName) {
    _gsSyncLogsCurrentSourceId = sourceId;
    const subtitle = document.getElementById('gsSyncLogsSubtitle');
    if (subtitle) {
        subtitle.textContent = sheetTabName
            ? `${spreadsheetName} › ${sheetTabName}`
            : spreadsheetName;
    }
    const modal = document.getElementById('gsSyncLogsModal');
    if (modal) modal.classList.add('active');
    refreshGoogleSheetSyncLogs();
}

function closeGoogleSheetSyncLogs() {
    const modal = document.getElementById('gsSyncLogsModal');
    if (modal) modal.classList.remove('active');
    _gsSyncLogsCurrentSourceId = null;
}

async function refreshGoogleSheetSyncLogs() {
    const sourceId = _gsSyncLogsCurrentSourceId;
    if (!sourceId) return;

    const loadingEl = document.getElementById('gsSyncLogsLoading');
    const emptyEl = document.getElementById('gsSyncLogsEmpty');
    const wrapEl = document.getElementById('gsSyncLogsTableWrap');
    const tbody = document.getElementById('gsSyncLogsTableBody');

    if (loadingEl) loadingEl.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';
    if (wrapEl) wrapEl.style.display = 'none';
    if (tbody) tbody.innerHTML = '';

    try {
        const data = await api.request(`/crm/GoogleSheets/sources/${sourceId}/sync-logs?limit=100`);
        const items = (data && data.items) || [];
        if (loadingEl) loadingEl.style.display = 'none';
        if (items.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
            return;
        }
        if (wrapEl) wrapEl.style.display = 'block';
        tbody.innerHTML = items.map(it => {
            const start = it.started_at ? new Date(it.started_at).toLocaleString() : '—';
            const outcome = it.outcome || 'in-flight';
            const outcomeBadge = `<span class="gs-status-badge gs-sync-${outcome}">${escapeHtml(outcome)}</span>`;
            const cursor = (it.last_read_row_before ?? '—') + ' → ' + (it.last_read_row_after ?? '—');
            const dur = it.duration_ms != null ? `${it.duration_ms} ms` : '—';
            const note = it.error_message ? escapeHtml(it.error_message) : '';
            return `
                <tr>
                    <td>${escapeHtml(start)}</td>
                    <td>${outcomeBadge}</td>
                    <td style="text-align:right;">${(it.rows_read ?? 0).toLocaleString()}</td>
                    <td style="text-align:right;">${(it.leads_created ?? 0).toLocaleString()}</td>
                    <td>${escapeHtml(cursor)}</td>
                    <td style="text-align:right;">${escapeHtml(dur)}</td>
                    <td style="max-width:380px; word-break: break-word; color: var(--text-secondary);">${note}</td>
                </tr>`;
        }).join('');
    } catch (e) {
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            emptyEl.textContent = 'Failed to load sync history: ' + (e.message || 'unknown error');
        }
    }
}

// ─── Picker modal ────────────────────────────────────────────────────────

function openGoogleSheetPicker() {
    if (_gsConnections.length === 0) {
        Toast.info('Connect a Google account first.');
        return;
    }
    document.getElementById('gsSheetPickerModal').classList.add('active');
    document.getElementById('gsModalTitle').textContent = 'Choose a spreadsheet';
    document.getElementById('gsModalSubtitle').textContent = '';
    document.getElementById('gsSaveBtn').style.display = 'none';

    // Reset stage visibility
    document.getElementById('gsStageSpreadsheets').style.display = 'block';
    document.getElementById('gsStageTabs').style.display = 'none';
    document.getElementById('gsStageMapping').style.display = 'none';

    // Populate connection picker
    const sel = document.getElementById('gsConnectionSelect');
    sel.innerHTML = _gsConnections.filter(c => c.is_active).map(c =>
        `<option value="${c.id}">${escapeHtml(c.google_email)}</option>`
    ).join('');
    _gsSelectedConnectionId = sel.value;

    loadGoogleSpreadsheets();
}

function closeGoogleSheetPicker() {
    document.getElementById('gsSheetPickerModal').classList.remove('active');
    _gsSelectedSpreadsheet = null;
    _gsSelectedTab = null;
    _gsHeaders = [];
    _gsSampleRows = [];
    // Clear edit mode too, or the next "Connect a sheet" would PUT the new
    // mapping onto whichever source was last edited instead of connecting.
    _gsEditSourceId = null;
    _gsEditMapping = null;
}

function loadGoogleSpreadsheetsDebounced() {
    clearTimeout(_gsSearchTimer);
    _gsSearchTimer = setTimeout(loadGoogleSpreadsheets, 300);
}

async function loadGoogleSpreadsheets() {
    _gsSelectedConnectionId = document.getElementById('gsConnectionSelect').value;
    const q = (document.getElementById('gsSheetSearch').value || '').trim();
    const container = document.getElementById('gsSheetsList');
    container.innerHTML = '<div style="padding:12px; color: var(--text-secondary);">Loading spreadsheets…</div>';
    try {
        const query = q ? `?q=${encodeURIComponent(q)}` : '';
        const files = await api.request(`/crm/GoogleSheets/connections/${_gsSelectedConnectionId}/spreadsheets${query}`);
        if (!files || files.length === 0) {
            container.innerHTML = '<div style="padding:12px; color: var(--text-secondary);">No spreadsheets found. Create one in Google Drive, or refine your search.</div>';
            return;
        }
        container.innerHTML = files.map(f => `
            <div class="gs-pickable-row" onclick="gsSelectSpreadsheet('${f.spreadsheet_id}', this.dataset.name)" data-name="${escapeHtml(f.name)}"
                 style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid var(--border-color); border-radius:6px; margin-bottom:6px; cursor:pointer;">
                <div>
                    <div style="font-weight:500;">${escapeHtml(f.name)}</div>
                    <div style="color:var(--text-secondary); font-size:0.85em;">${f.modified_time ? 'Modified ' + formatRelative(f.modified_time) : ''}</div>
                </div>
                <span style="color: var(--text-secondary);">&rarr;</span>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<div style="padding:12px; color: var(--color-error);">Failed to list spreadsheets: ${escapeHtml(e.message || 'error')}</div>`;
    }
}

async function gsSelectSpreadsheet(spreadsheetId, name) {
    // Store as snake_case so every downstream reader uses the same key shape
    // as the backend response bodies (project convention: SnakeCaseLower JSON).
    // The ES6 shorthand {spreadsheetId, name} accidentally created a camelCase
    // key that didn't match the snake_case lookups further down the flow.
    _gsSelectedSpreadsheet = { spreadsheet_id: spreadsheetId, name };
    document.getElementById('gsStageSpreadsheets').style.display = 'none';
    document.getElementById('gsStageTabs').style.display = 'block';
    document.getElementById('gsModalTitle').textContent = 'Pick a tab';
    document.getElementById('gsModalSubtitle').textContent = name;
    document.getElementById('gsTabsSpreadsheetName').textContent = name;

    const container = document.getElementById('gsTabsList');
    container.innerHTML = '<div style="padding:12px; color: var(--text-secondary);">Loading tabs…</div>';
    try {
        const res = await api.request(`/crm/GoogleSheets/connections/${_gsSelectedConnectionId}/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs`);
        const tabs = res.tabs || [];
        if (tabs.length === 0) {
            container.innerHTML = '<div style="padding:12px; color: var(--text-secondary);">This spreadsheet has no tabs we can see.</div>';
            return;
        }
        container.innerHTML = tabs.map(t => `
            <div class="gs-pickable-row" onclick="gsSelectTab('${escapeHtmlJsAttr(t.name)}', ${t.index})"
                 style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid var(--border-color); border-radius:6px; margin-bottom:6px; cursor:pointer;">
                <div style="font-weight:500;">${escapeHtml(t.name)}</div>
                <span style="color: var(--text-secondary);">&rarr;</span>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<div style="padding:12px; color: var(--color-error);">Failed to list tabs: ${escapeHtml(e.message || 'error')}</div>`;
    }
}

function gsGoBackToSpreadsheets() {
    document.getElementById('gsStageSpreadsheets').style.display = 'block';
    document.getElementById('gsStageTabs').style.display = 'none';
    document.getElementById('gsStageMapping').style.display = 'none';
    document.getElementById('gsModalTitle').textContent = 'Choose a spreadsheet';
    document.getElementById('gsModalSubtitle').textContent = '';
    document.getElementById('gsSaveBtn').style.display = 'none';
}

function gsGoBackToTabs() {
    document.getElementById('gsStageSpreadsheets').style.display = 'none';
    document.getElementById('gsStageTabs').style.display = 'block';
    document.getElementById('gsStageMapping').style.display = 'none';
    document.getElementById('gsModalTitle').textContent = 'Pick a tab';
    document.getElementById('gsModalSubtitle').textContent = _gsSelectedSpreadsheet?.name || '';
    document.getElementById('gsSaveBtn').style.display = 'none';
}

async function gsSelectTab(tabName, tabIndex) {
    _gsSelectedTab = { name: tabName, index: tabIndex };
    document.getElementById('gsStageTabs').style.display = 'none';
    document.getElementById('gsStageMapping').style.display = 'block';
    document.getElementById('gsModalTitle').textContent = 'Map columns';
    document.getElementById('gsModalSubtitle').textContent = `${_gsSelectedSpreadsheet.name} › ${tabName}`;
    document.getElementById('gsMappingSpreadsheetName').textContent = _gsSelectedSpreadsheet.name;
    document.getElementById('gsMappingTabName').textContent = tabName;
    document.getElementById('gsSaveBtn').style.display = 'inline-flex';
    document.getElementById('gsHeaderRow').value = 1;

    // Prefill the source-name label so the user can accept or tweak it.
    // Keeps the field user-editable; backend falls back to "GS · <sheet> · <tab>"
    // if the user clears it, but client-side we require non-empty.
    const label = `${_gsSelectedSpreadsheet.name} — ${tabName}`;
    const labelInput = document.getElementById('gsSourceNameInput');
    if (labelInput) labelInput.value = label.slice(0, 200);

    await gsReloadPreview();
}

async function gsReloadPreview() {
    const tbody = document.querySelector('#gsMappingTable tbody');
    tbody.innerHTML = '<tr><td colspan="4" style="padding:12px; color: var(--text-secondary);">Loading preview…</td></tr>';
    const headerRow = Math.max(1, parseInt(document.getElementById('gsHeaderRow').value || '1', 10));
    try {
        // Service-account sheets have no OAuth connection row — their preview
        // lives under a different path. The mapping editor can be opened on
        // either kind, so the branch has to exist here rather than at the one
        // call site the connect wizard used.
        const isSa = _gsSelectedConnectionId === 'sa' || !_gsSelectedConnectionId;
        const url = isSa
            ? `/crm/GoogleSheets/service-account` +
              `/spreadsheets/${encodeURIComponent(_gsSelectedSpreadsheet.spreadsheet_id)}` +
              `/tabs/${encodeURIComponent(_gsSelectedTab.name)}` +
              `/preview?headerRow=${headerRow}`
            : `/crm/GoogleSheets/connections/${_gsSelectedConnectionId}` +
              `/spreadsheets/${encodeURIComponent(_gsSelectedSpreadsheet.spreadsheet_id)}` +
              `/tabs/${encodeURIComponent(_gsSelectedTab.name)}` +
              `/preview?headerRow=${headerRow}`;
        const res = await api.request(url);
        _gsHeaders = res.headers || [];
        _gsSampleRows = res.sample_rows || [];
        renderGsMappingTable();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color: var(--color-error); padding:12px;">Failed to load preview: ${escapeHtml(e.message || 'error')}</td></tr>`;
    }
}

function gsColLetter(i) {
    let s = '', n = i + 1;
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
}

function gsGuessMapping(header) {
    const h = (header || '').toLowerCase().trim();
    if (!h) return 'skip';
    // Meta's canonical columns.
    if (h === 'id') return 'source_lead_id';
    if (h === 'email') return 'email';
    if (h === 'phone_number' || h === 'phone') return 'phone';
    if (h === 'full_name') return 'full_name';
    if (h === 'first_name') return 'first_name';
    if (h === 'last_name') return 'last_name';
    if (h === 'company_name' || h === 'company') return 'company_name';
    if (h === 'job_title' || h === 'title') return 'job_title';
    return 'skip';
}

function renderGsMappingTable() {
    const tbody = document.querySelector('#gsMappingTable tbody');
    const rowIdContainer = document.getElementById('gsRowIdColumnDd');
    const width = Math.max(_gsHeaders.length, ...(_gsSampleRows.map(r => r.length) || [0]));

    // Capture the prior row-ID selection so a header-row tweak doesn't reset it.
    const existingRowId = _gsRowIdDropdown ? _gsRowIdDropdown.getValue() : '';
    _gsColDropdowns.clear();
    _gsRowIdDropdown = null;

    if (width === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:12px; color: var(--text-secondary);">No columns found at the chosen header row. Is the header row correct?</td></tr>`;
        rowIdContainer.innerHTML = '';
        return;
    }

    let tableHtml = '';
    const rowIdOptions = [{ value: '', label: '(none — CRM generates one)' }];
    const rowMeta = [];
    let autoRowId = '';
    for (let i = 0; i < width; i++) {
        const letter = gsColLetter(i);
        const header = _gsHeaders[i] || `Column ${letter}`;
        const sample = (_gsSampleRows[0] && _gsSampleRows[0][i]) || '';
        // In edit mode the sheet already has a mapping — that is the truth,
        // and the name-guesser must not override it. A user who deliberately
        // mapped "Contact" → company_name would otherwise have it silently
        // reset every time they opened the editor.
        const guess = gsResolveExistingMapping(letter) ?? gsGuessMapping(header);
        tableHtml += `
            <tr>
                <td><strong>${letter}</strong></td>
                <td>${escapeHtml(header)}</td>
                <td style="color: var(--text-secondary);">${escapeHtml(sample)}</td>
                <td>
                    <div id="gsColDd_${letter}" class="gs-col-map-dd"></div>
                    <input type="text" class="form-control gs-col-custom-name" data-col="${letter}"
                        placeholder="Field name (e.g. city)" style="display:none; margin-top:6px;">
                </td>
            </tr>`;
        rowIdOptions.push({ value: letter, label: `${letter} — ${header}` });
        rowMeta.push({ letter, guess, header });
        if (guess === 'source_lead_id' && !autoRowId) autoRowId = letter;
    }
    tbody.innerHTML = tableHtml;

    rowMeta.forEach(({ letter, guess, header }) => {
        const container = document.getElementById(`gsColDd_${letter}`);
        if (!container) return;
        const customInput = document.querySelector(`.gs-col-custom-name[data-col="${letter}"]`);
        const dd = new SearchableDropdown(container, {
            id: `gsColDd_${letter}`,
            options: GS_CRM_FIELDS,
            value: guess,
            placeholder: '— Ignore this column —',
            compact: true,
            onChange: (val) => {
                if (!customInput) return;
                if (val === '__custom__') {
                    customInput.style.display = '';
                    if (!customInput.value) customInput.value = (header || '').toLowerCase().trim().replace(/\s+/g, '_');
                    customInput.focus();
                } else {
                    customInput.style.display = 'none';
                }
            },
        });
        _gsColDropdowns.set(letter, dd);
    });

    _gsRowIdDropdown = new SearchableDropdown(rowIdContainer, {
        id: 'gsRowIdColumnDd',
        options: rowIdOptions,
        value: existingRowId || autoRowId || '',
        placeholder: '(none — CRM generates one)',
        compact: true,
    });
}

// ─── Edit the mapping of an ALREADY-connected sheet ─────────────────────────
//
// PUT /api/GoogleSheets/sheets/{sourceId}/mapping existed from the start with
// no caller. Without it the only way to fix a mapping — after a column is
// added, renamed or reordered in the sheet — was to walk the whole connect
// wizard again, re-picking the account, spreadsheet and tab you had already
// picked. This drops the user straight onto the mapping step for a sheet they
// have, with their current mapping already selected.
let _gsEditSourceId = null;      // non-null ⇒ save PUTs instead of connecting
let _gsEditMapping = null;       // the sheet's current field_mappings

// Returns the mapped value for a column letter in edit mode, or null when we
// are connecting a new sheet (so the caller falls back to the name-guesser).
// A `custom:foo` mapping resolves to the __custom__ option; the free-text name
// is filled in separately once the dropdown exists.
function gsResolveExistingMapping(letter) {
    if (!_gsEditMapping) return null;
    const v = _gsEditMapping[letter];
    if (v == null) return 'skip';                     // present-but-unmapped is a real answer
    if (typeof v === 'string' && v.startsWith('custom:')) return '__custom__';
    return v;
}

async function openGoogleSheetMappingEditor(sourceId) {
    const row = (_gsList?.rows || []).find(r => r.lead_source_id === sourceId);
    if (!row) { Toast.error('Sheet not found — refresh and try again.'); return; }

    let mapping = {};
    try {
        mapping = typeof row.field_mappings === 'string'
            ? JSON.parse(row.field_mappings || '{}')
            : (row.field_mappings || {});
    } catch { mapping = {}; }

    _gsEditSourceId = sourceId;
    _gsEditMapping = mapping;
    _gsSelectedConnectionId = row.connection_id;
    _gsSelectedSpreadsheet = { spreadsheet_id: row.spreadsheet_id, name: row.spreadsheet_name };
    _gsSelectedTab = { name: row.sheet_tab_name, index: 0 };

    document.getElementById('gsSheetPickerModal').classList.add('active');
    ['gsStageSpreadsheets', 'gsStageTabs'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    document.getElementById('gsStageMapping').style.display = 'block';
    document.getElementById('gsModalTitle').textContent = 'Edit column mapping';
    document.getElementById('gsModalSubtitle').textContent =
        `${row.spreadsheet_name} › ${row.sheet_tab_name}`;
    document.getElementById('gsMappingSpreadsheetName').textContent = row.spreadsheet_name;
    document.getElementById('gsMappingTabName').textContent = row.sheet_tab_name;
    document.getElementById('gsSaveBtn').style.display = 'inline-flex';

    // The header row is stored inside the mapping itself; honour it so the
    // preview lines up with what the poller actually reads.
    const headerRow = Number(mapping._header_row) || 1;
    document.getElementById('gsHeaderRow').value = headerRow;

    const labelInput = document.getElementById('gsSourceNameInput');
    if (labelInput) labelInput.value = row.source_name || '';

    await gsReloadPreview();
    gsFillCustomFieldNames();
}

// After the dropdowns exist, write the custom field names back into their
// free-text inputs — the dropdown only knows "__custom__", not "custom:city".
function gsFillCustomFieldNames() {
    if (!_gsEditMapping) return;
    for (const [col, val] of Object.entries(_gsEditMapping)) {
        if (typeof val !== 'string' || !val.startsWith('custom:')) continue;
        const input = document.querySelector(`.gs-col-custom-name[data-col="${col}"]`);
        if (input) { input.value = val.slice('custom:'.length); input.style.display = ''; }
    }
}

async function saveGoogleSheetConnection() {
    const btn = document.getElementById('gsSaveBtn');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving…';

    // Require a tenant-chosen label so leads from different sheets are
    // distinguishable on the Leads page. Backend also validates but we
    // short-circuit the POST to avoid the round-trip.
    const labelInput = document.getElementById('gsSourceNameInput');
    const sourceName = (labelInput?.value || '').trim();
    if (sourceName.length < 2) {
        Toast.warning('Give this source a short label (e.g. "Software Dev Q2") so you can filter these leads later.');
        labelInput?.focus();
        btn.disabled = false;
        btn.textContent = original;
        return;
    }

    // Build field_mappings payload from the dropdowns.
    const map = {};
    const usedCustomNames = new Set();
    for (const [col, dd] of _gsColDropdowns.entries()) {
        const val = dd.getValue();
        if (!col || !val || val === 'skip') continue;
        if (val === '__custom__') {
            const input = document.querySelector(`.gs-col-custom-name[data-col="${col}"]`);
            const name = (input?.value || '').trim().toLowerCase().replace(/\s+/g, '_');
            if (!name) {
                Toast.warning(`Enter a name for custom field in column ${col}, or set it to Ignore.`);
                input?.focus();
                btn.disabled = false;
                btn.textContent = original;
                return;
            }
            if (usedCustomNames.has(name)) {
                Toast.warning(`Custom field name "${name}" is used twice. Each custom field must be unique.`);
                input?.focus();
                btn.disabled = false;
                btn.textContent = original;
                return;
            }
            usedCustomNames.add(name);
            map[col] = `custom:${name}`;
        } else {
            map[col] = val;
        }
    }
    const rowIdCol = (_gsRowIdDropdown && _gsRowIdDropdown.getValue()) || null;
    if (rowIdCol) {
        map[rowIdCol] = 'source_lead_id';
        map['_row_id_column'] = rowIdCol;
    }
    const headerRow = Math.max(1, parseInt(document.getElementById('gsHeaderRow').value || '1', 10));
    map['_header_row'] = headerRow;

    try {
        if (_gsEditSourceId) {
            // Editing an existing sheet: the account, spreadsheet and tab are
            // already settled, so only the mapping moves. Carry the current
            // auto-assign settings through — this endpoint overwrites them,
            // and omitting them would silently unassign the source.
            const existing = (_gsList?.rows || []).find(r => r.lead_source_id === _gsEditSourceId);
            await api.request(`/crm/GoogleSheets/sheets/${_gsEditSourceId}/mapping`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    field_mappings: JSON.stringify(map),
                    auto_assign_user_id: existing?.auto_assign_user_id ?? null,
                    auto_assign_team_id: existing?.auto_assign_team_id ?? null
                })
            });
            Toast.success('Mapping updated. The next sync uses the new columns.');
            closeGoogleSheetPicker();
            await loadGoogleSheetsState();
            return;
        }

        await api.request('/crm/GoogleSheets/sheets/connect', {
            method: 'POST',
            body: JSON.stringify({
                connection_id: _gsSelectedConnectionId,
                spreadsheet_id: _gsSelectedSpreadsheet.spreadsheet_id,
                spreadsheet_name: _gsSelectedSpreadsheet.name,
                sheet_tab_name: _gsSelectedTab.name,
                field_mappings: JSON.stringify(map),
                header_row: headerRow,
                auto_assign_user_id: null,
                source_name: sourceName
            })
        });
        Toast.success('Sheet connected. Leads will start flowing within 2 minutes.');
        closeGoogleSheetPicker();
        await loadGoogleSheetsState();
    } catch (e) {
        Toast.error(e.message || 'Failed to save sheet connection');
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Google Sheets — service-account SHARE flow.
// Tenant shares their sheet with a fixed SA email and pastes the URL;
// we verify + ingest. No OAuth, no verification.
// ═══════════════════════════════════════════════════════════════════════════

let _gsShareSpreadsheet = null;       // { spreadsheetId, name }
let _gsShareTab = null;               // { name, index }
let _gsShareHeaders = [];
let _gsShareSampleRows = [];
let _gsShareColDropdowns = new Map(); // col letter -> SearchableDropdown
let _gsShareRowIdDropdown = null;

function openGoogleSheetShareModal() {
    if (!_gsServiceAccount?.enabled || !_gsServiceAccount.email) {
        Toast.error('Service-account flow is not configured on the server.');
        return;
    }
    document.getElementById('gsShareModal').classList.add('active');
    document.getElementById('gsSaEmailDisplay').value = _gsServiceAccount.email;
    document.getElementById('gsShareUrlInput').value = '';
    document.getElementById('gsShareError').style.display = 'none';
    document.getElementById('gsShareError').textContent = '';
    document.getElementById('gsShareStage1').style.display = 'block';
    document.getElementById('gsShareStage2').style.display = 'none';
    document.getElementById('gsShareStage3').style.display = 'none';
    document.getElementById('gsShareSaveBtn').style.display = 'none';
    // Fire-and-forget — Stage 3 is the only place the dropdown is read, so
    // populating it asynchronously after modal open is fine.
    populateGsAutoAssignTeams();
}

// Reuses the FB teams cache (_fbAutoAssignTeams) so opening both modals in
// the same session doesn't double-fetch /crm/teams. preselectTeamId is set
// later by gsShareSelectTab() when re-connecting an existing sheet so the
// "Assign manually later" default doesn't silently clear a saved team.
async function populateGsAutoAssignTeams(preselectTeamId) {
    const sel = document.getElementById('gsShareAutoAssignTeamSelect');
    if (!sel) return;
    if (!_fbAutoAssignTeams) {
        try {
            const teams = await api.request('/crm/teams');
            _fbAutoAssignTeams = Array.isArray(teams) ? teams : [];
        } catch {
            _fbAutoAssignTeams = [];
        }
    }
    sel.innerHTML =
        '<option value="">— Assign manually later —</option>' +
        _fbAutoAssignTeams
            .filter(t => t.is_active !== false)
            .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.team_name || t.name || t.id)}</option>`)
            .join('');
    sel.value = preselectTeamId || '';
}

function closeGoogleSheetShareModal() {
    document.getElementById('gsShareModal').classList.remove('active');
    _gsShareSpreadsheet = null;
    _gsShareTab = null;
}

async function copyGsSaEmail() {
    try {
        await navigator.clipboard.writeText(_gsServiceAccount.email || '');
        Toast.success('Copied. Now share your sheet with this email.');
    } catch {
        // clipboard API can be blocked — fall back to selecting the input.
        const el = document.getElementById('gsSaEmailDisplay');
        if (el) { el.select(); document.execCommand('copy'); Toast.success('Copied.'); }
    }
}

function gsShareBack() {
    document.getElementById('gsShareStage1').style.display = 'block';
    document.getElementById('gsShareStage2').style.display = 'none';
    document.getElementById('gsShareStage3').style.display = 'none';
    document.getElementById('gsShareSaveBtn').style.display = 'none';
}

function gsShareBackToTabs() {
    document.getElementById('gsShareStage1').style.display = 'none';
    document.getElementById('gsShareStage2').style.display = 'block';
    document.getElementById('gsShareStage3').style.display = 'none';
    document.getElementById('gsShareSaveBtn').style.display = 'none';
}

async function verifyGoogleSheetShared() {
    const btn = document.getElementById('gsShareVerifyBtn');
    const errEl = document.getElementById('gsShareError');
    const url = (document.getElementById('gsShareUrlInput').value || '').trim();
    if (!url) {
        errEl.textContent = 'Paste the sheet URL first.';
        errEl.style.display = 'flex';
        return;
    }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Verifying…';
    errEl.style.display = 'none';
    try {
        const res = await api.request('/crm/GoogleSheets/service-account/verify-sheet', {
            method: 'POST',
            body: JSON.stringify({ sheet_url: url })
        });
        if (!res.accessible) {
            errEl.textContent = res.error || 'Sheet not accessible. Share it with ' + (res.share_with_email || _gsServiceAccount.email) + ' and retry.';
            errEl.style.display = 'flex';
            return;
        }
        _gsShareSpreadsheet = { spreadsheet_id: res.spreadsheet_id, name: res.spreadsheet_name || 'Untitled' };
        document.getElementById('gsShareSheetName').textContent = _gsShareSpreadsheet.name;
        // Render tab list
        const tabs = res.tabs || [];
        const list = document.getElementById('gsShareTabsList');
        list.innerHTML = tabs.map(t => `
            <div class="gs-pickable-row" onclick="gsShareSelectTab('${escapeHtmlJsAttr(t.name)}', ${t.index})"
                 style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid var(--border-color); border-radius:6px; margin-bottom:6px; cursor:pointer;">
                <div style="font-weight:500;">${escapeHtml(t.name)}</div>
                <span style="color: var(--text-secondary);">&rarr;</span>
            </div>
        `).join('');
        document.getElementById('gsShareStage1').style.display = 'none';
        document.getElementById('gsShareStage2').style.display = 'block';
    } catch (e) {
        errEl.textContent = e.message || 'Verification failed.';
        errEl.style.display = 'flex';
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function gsShareSelectTab(tabName, tabIndex) {
    _gsShareTab = { name: tabName, index: tabIndex };
    document.getElementById('gsShareStage2').style.display = 'none';
    document.getElementById('gsShareStage3').style.display = 'block';
    document.getElementById('gsShareMappingName').textContent = _gsShareSpreadsheet.name;
    document.getElementById('gsShareMappingTab').textContent = tabName;
    document.getElementById('gsShareSaveBtn').style.display = 'inline-flex';
    document.getElementById('gsShareHeaderRow').value = 1;

    // Prefill source-name label (same pattern as OAuth picker).
    const label = `${_gsShareSpreadsheet.name} — ${tabName}`;
    const labelInput = document.getElementById('gsShareSourceNameInput');
    if (labelInput) labelInput.value = label.slice(0, 200);

    // If this exact sheet+tab is already connected, pre-select its saved
    // team so re-saving doesn't silently clear it. Both OAuth + service-
    // account paths surface auto_assign_team_id on the connected-sheets
    // endpoint after this change; this lookup matches both.
    const existing = (_gsConnectedSheets || []).find(s =>
        s.spreadsheet_id === _gsShareSpreadsheet.spreadsheet_id &&
        s.sheet_tab_name === tabName);
    populateGsAutoAssignTeams(existing?.auto_assign_team_id || '');

    await gsShareReloadPreview();
}

async function gsShareReloadPreview() {
    const tbody = document.querySelector('#gsShareMappingTable tbody');
    tbody.innerHTML = '<tr><td colspan="4" style="padding:12px; color: var(--text-secondary);">Loading preview…</td></tr>';
    const headerRow = Math.max(1, parseInt(document.getElementById('gsShareHeaderRow').value || '1', 10));
    try {
        const res = await api.request(
            `/crm/GoogleSheets/service-account/spreadsheets/${encodeURIComponent(_gsShareSpreadsheet.spreadsheet_id)}` +
            `/tabs/${encodeURIComponent(_gsShareTab.name)}/preview?headerRow=${headerRow}`
        );
        _gsShareHeaders = res.headers || [];
        _gsShareSampleRows = res.sample_rows || [];
        renderGsShareMappingTable();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color: var(--color-error); padding:12px;">Failed to load preview: ${escapeHtml(e.message || 'error')}</td></tr>`;
    }
}

function renderGsShareMappingTable() {
    const tbody = document.querySelector('#gsShareMappingTable tbody');
    const rowIdContainer = document.getElementById('gsShareRowIdColDd');
    const width = Math.max(_gsShareHeaders.length, ...(_gsShareSampleRows.map(r => r.length) || [0]));

    const existing = _gsShareRowIdDropdown ? _gsShareRowIdDropdown.getValue() : '';
    _gsShareColDropdowns.clear();
    _gsShareRowIdDropdown = null;

    if (width === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:12px; color: var(--text-secondary);">No columns at the chosen header row.</td></tr>';
        rowIdContainer.innerHTML = '';
        return;
    }

    let rows = '';
    const rowIdOptions = [{ value: '', label: '(none — CRM generates one)' }];
    const rowMeta = [];
    let autoRowId = '';
    for (let i = 0; i < width; i++) {
        const letter = gsColLetter(i);
        const header = _gsShareHeaders[i] || `Column ${letter}`;
        const sample = (_gsShareSampleRows[0] && _gsShareSampleRows[0][i]) || '';
        const guess = gsGuessMapping(header);
        rows += `
            <tr>
                <td><strong>${letter}</strong></td>
                <td>${escapeHtml(header)}</td>
                <td style="color: var(--text-secondary);">${escapeHtml(sample)}</td>
                <td>
                    <div id="gsShareColDd_${letter}" class="gs-col-map-dd"></div>
                    <input type="text" class="form-control gs-share-col-custom-name" data-col="${letter}"
                        placeholder="Field name (e.g. city)" style="display:none; margin-top:6px;">
                </td>
            </tr>`;
        rowIdOptions.push({ value: letter, label: `${letter} — ${header}` });
        rowMeta.push({ letter, guess, header });
        if (guess === 'source_lead_id' && !autoRowId) autoRowId = letter;
    }
    tbody.innerHTML = rows;

    rowMeta.forEach(({ letter, guess, header }) => {
        const container = document.getElementById(`gsShareColDd_${letter}`);
        if (!container) return;
        const customInput = document.querySelector(`.gs-share-col-custom-name[data-col="${letter}"]`);
        const dd = new SearchableDropdown(container, {
            id: `gsShareColDd_${letter}`,
            options: GS_CRM_FIELDS,
            value: guess,
            placeholder: '— Ignore this column —',
            compact: true,
            onChange: (val) => {
                if (!customInput) return;
                if (val === '__custom__') {
                    customInput.style.display = '';
                    if (!customInput.value) customInput.value = (header || '').toLowerCase().trim().replace(/\s+/g, '_');
                    customInput.focus();
                } else {
                    customInput.style.display = 'none';
                }
            },
        });
        _gsShareColDropdowns.set(letter, dd);
    });

    _gsShareRowIdDropdown = new SearchableDropdown(rowIdContainer, {
        id: 'gsShareRowIdColDd',
        options: rowIdOptions,
        value: existing || autoRowId || '',
        placeholder: '(none — CRM generates one)',
        compact: true,
    });
}

async function saveGoogleSheetShareConnection() {
    const btn = document.getElementById('gsShareSaveBtn');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Saving…';

    const labelInput = document.getElementById('gsShareSourceNameInput');
    const sourceName = (labelInput?.value || '').trim();
    if (sourceName.length < 2) {
        Toast.warning('Give this source a short label (e.g. "Software Dev Q2") so you can filter these leads later.');
        labelInput?.focus();
        btn.disabled = false;
        btn.textContent = orig;
        return;
    }

    const map = {};
    const usedCustomNames = new Set();
    for (const [col, dd] of _gsShareColDropdowns.entries()) {
        const val = dd.getValue();
        if (!col || !val || val === 'skip') continue;
        if (val === '__custom__') {
            const input = document.querySelector(`.gs-share-col-custom-name[data-col="${col}"]`);
            const name = (input?.value || '').trim().toLowerCase().replace(/\s+/g, '_');
            if (!name) {
                Toast.warning(`Enter a name for custom field in column ${col}, or set it to Ignore.`);
                input?.focus();
                btn.disabled = false;
                btn.textContent = orig;
                return;
            }
            if (usedCustomNames.has(name)) {
                Toast.warning(`Custom field name "${name}" is used twice. Each custom field must be unique.`);
                input?.focus();
                btn.disabled = false;
                btn.textContent = orig;
                return;
            }
            usedCustomNames.add(name);
            map[col] = `custom:${name}`;
        } else {
            map[col] = val;
        }
    }
    const rowIdCol = (_gsShareRowIdDropdown && _gsShareRowIdDropdown.getValue()) || null;
    if (rowIdCol) { map[rowIdCol] = 'source_lead_id'; map['_row_id_column'] = rowIdCol; }
    const headerRow = Math.max(1, parseInt(document.getElementById('gsShareHeaderRow').value || '1', 10));
    map['_header_row'] = headerRow;

    // Mirror the FB sentinel: empty select value → empty UUID = explicit
    // clear on the backend; real UUID → assign that team. Anything else
    // would leave the column untouched (null), which is fine on create but
    // surprising on edit. Empty UUID is the only safe way to say "no team".
    const teamSel = document.getElementById('gsShareAutoAssignTeamSelect');
    const teamSelVal = (teamSel?.value || '').trim();
    const autoTeamId = teamSelVal === '' ? '00000000-0000-0000-0000-000000000000' : teamSelVal;

    try {
        await api.request('/crm/GoogleSheets/service-account/connect', {
            method: 'POST',
            body: JSON.stringify({
                spreadsheet_id: _gsShareSpreadsheet.spreadsheet_id,
                spreadsheet_name: _gsShareSpreadsheet.name,
                sheet_tab_name: _gsShareTab.name,
                field_mappings: JSON.stringify(map),
                header_row: headerRow,
                auto_assign_user_id: null,
                auto_assign_team_id: autoTeamId,
                source_name: sourceName
            })
        });
        Toast.success('Sheet connected. Leads will start flowing within 2 minutes.');
        closeGoogleSheetShareModal();
        await loadGoogleSheetsState();
    } catch (e) {
        Toast.error(e.message || 'Failed to save.');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ─── Phase 3 of unified-mailbox plan: shared-mailbox picker UX ─────────────
// Powered by /api/mailbox-attachments/* — the controller proxies to
// EmailService gRPC. Three concerns:
//   1. Load + render the tenant default and per-flow attachments
//   2. Modal-driven picker over EmailService's shared-mailbox catalog
//   3. Migration banner that flags flows pointing at non-shared / inactive boxes

let _sharedMailboxes = [];          // cache of EmailService catalog (shared, active)
let _flowAttachments = [];          // cache of flow_mailbox_attachments rows
let _tenantDefaultMailbox = null;   // Mailbox object or null
let _pickerMode = null;             // {kind: 'tenant-default' | 'flow', flowId, flowType}

async function refreshSharedMailboxPicker() {
    try {
        // Three calls in parallel — they're cheap and the UI is fully redrawn from the result.
        const [catalog, defaultMb, attachments] = await Promise.all([
            api.request('/crm/mailbox-attachments/shared-mailboxes'),
            api.request('/crm/mailbox-attachments/tenant-default'),
            api.request('/crm/mailbox-attachments/attachments'),
        ]);
        _sharedMailboxes = catalog?.mailboxes || [];
        _tenantDefaultMailbox = defaultMb?.mailbox || null;
        _flowAttachments = attachments?.attachments || [];
        renderTenantDefaultMailbox();
        renderFlowAttachments();
        renderMigrationBanner();
    } catch (e) {
        console.warn('[mailbox-picker] refresh failed:', e);
        // Non-fatal — leave the legacy mailbox table working. EmailService gRPC may be down.
        const lbl = document.getElementById('tenantDefaultMailboxLabel');
        if (lbl) lbl.textContent = 'EmailService unreachable';
    }
}

function renderTenantDefaultMailbox() {
    const lbl = document.getElementById('tenantDefaultMailboxLabel');
    const clearBtn = document.getElementById('tenantDefaultClearBtn');
    if (!lbl) return;
    if (_tenantDefaultMailbox) {
        lbl.innerHTML = `<strong>${escapeHtml(_tenantDefaultMailbox.email_address)}</strong>`
            + (_tenantDefaultMailbox.display_name
                ? ` <span style="color:var(--text-secondary);">· ${escapeHtml(_tenantDefaultMailbox.display_name)}</span>`
                : '');
        if (clearBtn) clearBtn.style.display = '';
    } else {
        lbl.innerHTML = '<em style="color:var(--text-secondary);">None — campaigns have no default sender</em>';
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

function renderAttachedBy(a) {
    const name = a.attached_by_display_name;
    const email = a.attached_by_email;
    if (name && email && name !== email) {
        return `${escapeHtml(name)} <span style="color:var(--text-secondary);font-size:0.85em;">&lt;${escapeHtml(email)}&gt;</span>`;
    }
    if (name) return escapeHtml(name);
    if (email) return escapeHtml(email);
    const raw = a.attached_by || '';
    // Auth lookup miss — show short GUID instead of the full ugly one.
    if (/^[0-9a-f-]{36}$/i.test(raw)) {
        return `<code title="${escapeHtml(raw)}" style="font-size:0.85em;color:var(--text-secondary);">${escapeHtml(raw.slice(0, 8))}…</code>`;
    }
    return escapeHtml(raw);
}

function renderFlowAttachments() {
    const tbody = document.getElementById('flowAttachmentsTableBody');
    const emptyEl = document.getElementById('flowAttachmentsEmpty');
    const wrapper = document.getElementById('flowAttachmentsTableWrapper');
    if (!tbody) return;
    if (_flowAttachments.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        if (wrapper) wrapper.style.display = 'none';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (wrapper) wrapper.style.display = '';
    tbody.innerHTML = _flowAttachments.map(a => {
        const flowLabel = `${escapeHtml(a.flow_type)} · <code style="font-size:0.78em;">${escapeHtml(String(a.flow_id).slice(0, 8))}…</code>`;
        const mbLabel = a.mailbox_email === '(missing)'
            ? `<span style="color:var(--color-error);">(mailbox deleted)</span>`
            : escapeHtml(a.mailbox_email);
        const status = a.needs_migration
            ? `<span style="color:#f59e0b;">⚠ ${a.is_shared ? 'inactive' : 'personal — needs migration'}</span>`
            : `<span style="color:var(--color-success);">✓ shared & active</span>`;
        return `<tr${a.needs_migration ? ' style="background: rgba(245, 158, 11, 0.05);"' : ''}>
            <td>${flowLabel}</td>
            <td>${mbLabel}</td>
            <td class="hide-mobile">${status}</td>
            <td class="hide-mobile">${renderAttachedBy(a)}</td>
            <td>
                <button class="btn btn-secondary btn-sm" type="button" onclick="openFlowAttachmentPicker('${a.flow_type}','${a.flow_id}')">Change</button>
                <button class="btn btn-secondary btn-sm" type="button" onclick="detachFlow('${a.flow_type}','${a.flow_id}')">Remove</button>
            </td>
        </tr>`;
    }).join('');
}

function renderMigrationBanner() {
    const banner = document.getElementById('migrationBanner');
    const text = document.getElementById('migrationBannerText');
    if (!banner || !text) return;
    const flagged = _flowAttachments.filter(a => a.needs_migration).length;
    if (flagged === 0) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = '';
    text.textContent = ` ${flagged} flow${flagged === 1 ? ' is' : 's are'} still attached to personal or inactive mailboxes. Switch to a shared mailbox below to keep customer conversations with the team.`;
}

// ─── Picker modal ─────────────────────────────────────────────────────────
function openTenantDefaultPicker() {
    _pickerMode = { kind: 'tenant-default' };
    const titleEl = document.getElementById('sharedMailboxPickerTitle');
    if (titleEl) titleEl.textContent = 'Pick the tenant default mailbox';
    showPicker();
}
function openFlowAttachmentPicker(flowType, flowId) {
    _pickerMode = { kind: 'flow', flowType, flowId };
    const titleEl = document.getElementById('sharedMailboxPickerTitle');
    if (titleEl) titleEl.textContent = `Pick mailbox for this ${flowType}`;
    showPicker();
}
function closeSharedMailboxPicker() {
    const m = document.getElementById('sharedMailboxPickerModal');
    if (m) m.classList.remove('active');
    _pickerMode = null;
}

function showPicker() {
    const list = document.getElementById('sharedMailboxPickerList');
    const empty = document.getElementById('sharedMailboxPickerEmpty');
    const modal = document.getElementById('sharedMailboxPickerModal');
    if (!list || !modal) return;
    if (_sharedMailboxes.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = '';
    } else {
        if (empty) empty.style.display = 'none';
        list.innerHTML = _sharedMailboxes.map(m => `
            <button type="button" class="btn btn-secondary"
                    style="text-align:left; padding: 12px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px;"
                    onclick="confirmPickerSelection('${m.id}')">
                <div>
                    <div style="font-weight:500;">${escapeHtml(m.email_address)}</div>
                    <div style="color:var(--text-secondary); font-size:0.78rem; margin-top:2px;">
                        ${escapeHtml(m.provider_type)} · daily cap ${m.daily_cap || '—'} · hourly cap ${m.hourly_cap || '—'}
                    </div>
                </div>
                <span style="color:var(--brand-primary); font-size:0.78rem;">Select →</span>
            </button>
        `).join('');
    }
    modal.classList.add('active');
}

async function confirmPickerSelection(mailboxId) {
    if (!_pickerMode) return;
    const mode = _pickerMode;
    closeSharedMailboxPicker();
    try {
        if (mode.kind === 'tenant-default') {
            await api.request('/crm/mailbox-attachments/tenant-default', {
                method: 'PUT', body: JSON.stringify({ mailbox_id: mailboxId })
            });
            Toast.success('Tenant default mailbox updated');
        } else if (mode.kind === 'flow') {
            await api.request(`/crm/mailbox-attachments/flow/${encodeURIComponent(mode.flowType)}/${encodeURIComponent(mode.flowId)}`,
                { method: 'PUT', body: JSON.stringify({ mailbox_id: mailboxId }) });
            Toast.success('Flow mailbox updated');
        }
        await refreshSharedMailboxPicker();
    } catch (e) {
        // Surface the BL governance-gate errors (personal mailbox / inactive / cross-tenant)
        Toast.error(e.message || 'Could not update mailbox attachment.');
    }
}

async function clearTenantDefaultMailbox() {
    if (!confirm('Clear the tenant default mailbox? Campaigns without a flow-specific override will have no sender until you set a new default.')) return;
    try {
        await api.request('/crm/mailbox-attachments/tenant-default', { method: 'DELETE' });
        Toast.success('Tenant default cleared');
        await refreshSharedMailboxPicker();
    } catch (e) { Toast.error(e.message || 'Could not clear default'); }
}

async function detachFlow(flowType, flowId) {
    if (!confirm(`Remove the mailbox attachment for this ${flowType}? It will fall back to the tenant default.`)) return;
    try {
        await api.request(`/crm/mailbox-attachments/flow/${encodeURIComponent(flowType)}/${encodeURIComponent(flowId)}`,
            { method: 'DELETE' });
        Toast.success('Flow attachment removed');
        await refreshSharedMailboxPicker();
    } catch (e) { Toast.error(e.message || 'Could not remove attachment'); }
}

// Tiny escaper so we don't pull in lodash for a 5-line need.
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Expose the entry points the inline onclick handlers reference.
window.refreshSharedMailboxPicker = refreshSharedMailboxPicker;
window.openTenantDefaultPicker = openTenantDefaultPicker;
window.openFlowAttachmentPicker = openFlowAttachmentPicker;
window.closeSharedMailboxPicker = closeSharedMailboxPicker;
window.confirmPickerSelection = confirmPickerSelection;
window.clearTenantDefaultMailbox = clearTenantDefaultMailbox;
window.detachFlow = detachFlow;

// ─── Calling (Exotel BYOK) — read-only status ─────────────────────────────
// All CRUD for BYOK credentials lives in Auth Admin → API Keys (the
// single source of truth). This page just renders the current status so
// CRM admins can see whether Exotel is wired without leaving the app.

async function loadCallsIntegration() {
    const dot = document.getElementById('callsStatusDot');
    const txt = document.getElementById('callsStatusText');
    const tbody = document.getElementById('callsNumbersTbody');
    const list = document.getElementById('callsNumbersList');
    const empty = document.getElementById('callsNumbersEmpty');
    if (!dot || !txt || !tbody) return;

    try {
        const numbers = await api.request('/crm/calls/numbers');
        if (!Array.isArray(numbers) || numbers.length === 0) {
            dot.classList.add('disconnected'); dot.classList.remove('connected');
            txt.textContent = 'Not connected';
            list.style.display = 'none';
            empty.style.display = '';
            return;
        }
        const anyActive = numbers.some(n => n.is_active);
        dot.classList.toggle('connected', anyActive);
        dot.classList.toggle('disconnected', !anyActive);
        txt.textContent = anyActive
            ? `Connected — ${numbers.length} number${numbers.length > 1 ? 's' : ''} configured`
            : `${numbers.length} number${numbers.length > 1 ? 's' : ''} configured, all inactive`;

        // Provider badge — pretty label per known provider, with a coloured
        // pill so reps can tell at a glance whether a row is Exotel vs
        // MyOperator (since both can coexist for the same tenant).
        const providerLabel = (p) => {
            const slug = (p || '').toLowerCase();
            if (slug === 'exotel') return { name: 'Exotel', bg: '#2563eb' };
            if (slug === 'myoperator') return { name: 'MyOperator', bg: '#9333ea' };
            return { name: p || 'Unknown', bg: '#6b7280' };
        };
        // Toggle visibility based on caller's role. Sales reps see the
        // active flag as read-only; admins (and SUPERADMIN) can flip it.
        // Toggling proxies to Auth's PUT /api/tenant-api-keys/{provider}/{serviceType}
        // — same SSoT pattern as the rest of BYOK.
        const canToggle = (() => {
            try {
                const roles = (api.getUser && (api.getUser().roles || api.getUser().role)) || [];
                const list = Array.isArray(roles) ? roles : String(roles).split(',');
                return list.some(r => /CRM_ADMIN|SUPERADMIN/i.test(r));
            } catch (_) { return false; }
        })();

        tbody.innerHTML = numbers.map(n => {
            const p = providerLabel(n.provider);
            const toggleCell = canToggle
                ? `<label class="cm-switch" title="${n.is_active ? 'Toggle off' : 'Toggle on'}" data-prov="${escapeHtml(n.provider)}" data-key="${escapeHtml(n.instance_key)}">
                       <input type="checkbox" ${n.is_active ? 'checked' : ''}>
                       <span class="cm-switch-slider"></span>
                   </label>
                   <span style="font-size:0.85em;color:var(--text-secondary);margin-left:8px;">${n.is_active ? 'On' : 'Off'}</span>`
                : `<span class="status-badge ${n.is_active ? 'active' : 'inactive'}">${n.is_active ? 'Active' : 'Inactive'}</span>`;
            // Webhook URL cell — distinguishes "row is off" from "Auth env
            // var missing" so admins know what action to take. The url is
            // only ever empty when Auth's GetDecryptedApiKeyAsync refuses
            // (inactive row) or when CRM_PUBLIC_URL isn't set in Auth.
            let webhookCell;
            if (n.webhook_url) {
                webhookCell = `<code style="font-size:0.78em;user-select:all;word-break:break-all;">${escapeHtml(n.webhook_url)}</code>`;
            } else if (!n.is_active) {
                webhookCell = '<span style="color:var(--text-secondary);font-size:0.85em;">Disabled — toggle on to view webhook URL</span>';
            } else {
                webhookCell = '<span style="color:var(--text-secondary);font-size:0.85em;">No webhook URL — set CRM_PUBLIC_URL in Auth config</span>';
            }
            // Inbound-connect URL: pasted into the ExoPhone's "Voice App URL"
            // so Exotel asks CRM who to ring on incoming calls. Same gating
            // story as the webhook URL — only populated when the row is
            // active and Auth knows CRM_PUBLIC_URL.
            let inboundCell;
            if (n.inbound_connect_url) {
                inboundCell = `<code style="font-size:0.78em;user-select:all;word-break:break-all;">${escapeHtml(n.inbound_connect_url)}</code>`;
            } else {
                inboundCell = '<span style="color:var(--text-secondary);font-size:0.85em;">—</span>';
            }
            return `
            <tr data-instance="${escapeHtml(n.instance_key)}" data-provider="${escapeHtml(n.provider)}">
                <td><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:0.75rem;font-weight:600;color:#fff;background:${p.bg};">${escapeHtml(p.name)}</span></td>
                <td><code>${escapeHtml(n.instance_key)}</code></td>
                <td>${toggleCell}</td>
                <td>${webhookCell}</td>
                <td>${inboundCell}</td>
            </tr>`;
        }).join('');

        // Bind toggle handlers — uses api.updateApiKey() so the call is
        // routed through the shared client (handles base URL, auth header,
        // CORS, token refresh). Auth is the SSoT for tenant_api_keys.is_active.
        tbody.querySelectorAll('.cm-switch input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', async () => {
                const label = input.closest('.cm-switch');
                const prov = label.getAttribute('data-prov');
                const key = label.getAttribute('data-key');
                const next = input.checked;
                input.disabled = true;
                try {
                    await api.updateApiKey(prov, 'telephony', { isActive: next }, key);
                    Toast.success(`${prov} number ${key} ${next ? 'enabled' : 'disabled'}`);
                    // Invalidate calls.js's 30s "configured" cache so other
                    // pages (leads, lead-detail) pick up the new state on
                    // their next decorate pass instead of waiting 30s.
                    if (typeof window.bustCallsConfigCache === 'function') {
                        window.bustCallsConfigCache();
                    }
                    loadCallsIntegration();  // re-render so the "On/Off" hint updates
                } catch (err) {
                    Toast.error(err?.message || 'Toggle failed');
                    input.checked = !next;  // revert
                } finally {
                    input.disabled = false;
                }
            });
        });
        list.style.display = '';
        empty.style.display = 'none';
    } catch (e) {
        console.warn('[calls] loadIntegration failed:', e?.message || e);
    }
}

// Auto-load when the Integrations tab opens.
document.addEventListener('DOMContentLoaded', () => {
    const tab = document.getElementById('tab-integrations');
    if (!tab) return;
    if (tab.classList.contains('active') || getComputedStyle(tab).display !== 'none') {
        loadCallsIntegration();
    }
    document.querySelectorAll('[data-tab="integrations"], [onclick*="integrations"]').forEach(btn => {
        btn.addEventListener('click', () => setTimeout(loadCallsIntegration, 60));
    });
});

window.loadCallsIntegration = loadCallsIntegration;

// ═══════════════════════════════════════════════════════════════════════════
//  CRM USERS TAB — SUPERADMIN-only. Lists every tenant user that holds a
//  CRM_* role and lets the admin set/clear their phone_number, which becomes
//  the caller_id on the Place-Call modal. Read + write both go through
//  /api/crm-admin/users — CRM service forwards over gRPC to Auth, which is
//  the single source of truth for AspNetUsers.PhoneNumber.
// ═══════════════════════════════════════════════════════════════════════════

let _crmUsersCache = [];

async function loadCrmUsersTab() {
    const loading = document.getElementById('crmUsersLoading');
    const wrapper = document.getElementById('crmUsersTableWrapper');
    const empty = document.getElementById('crmUsersEmptyState');
    if (loading) loading.style.display = '';
    if (wrapper) wrapper.style.display = 'none';
    if (empty) empty.style.display = 'none';

    try {
        const users = await api.request('/crm-admin/users');
        _crmUsersCache = Array.isArray(users) ? users : [];
        renderCrmUsersTable(_crmUsersCache);
    } catch (err) {
        console.error('[crm-users] load failed:', err);
        if (typeof Toast !== 'undefined' && Toast.error) {
            Toast.error('Failed to load CRM users: ' + (err?.message || 'unknown'));
        }
        renderCrmUsersTable([]);
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function renderCrmUsersTable(users) {
    const wrapper = document.getElementById('crmUsersTableWrapper');
    const empty = document.getElementById('crmUsersEmptyState');
    const tbody = document.getElementById('crmUsersTableBody');
    if (!wrapper || !empty || !tbody) return;

    if (!users || users.length === 0) {
        wrapper.style.display = 'none';
        empty.style.display = '';
        return;
    }

    wrapper.style.display = '';
    empty.style.display = 'none';

    tbody.innerHTML = users.map(u => {
        const userId = escapeHtml(u.user_id || '');
        const first = escapeHtml(u.first_name || '');
        const last = escapeHtml(u.last_name || '');
        const email = escapeHtml(u.email || '');
        const phone = u.phone_number ? escapeHtml(u.phone_number) : '';
        const phoneCell = phone
            ? `<code style="font-size:0.86rem; color:var(--text-primary);">${phone}</code>`
            : `<span style="color:var(--text-secondary); font-style:italic;">Not set</span>`;
        const roles = Array.isArray(u.roles) ? u.roles : [];
        const roleBadges = roles.map(r => {
            const isSuper = r === 'SUPERADMIN';
            return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:0.72rem; font-weight:500; margin-right:4px; ${isSuper ? 'background:rgba(239,68,68,.12); color:var(--color-danger);' : 'background:var(--bg-secondary); color:var(--text-secondary); border:1px solid var(--border-color);'}">${escapeHtml(r)}</span>`;
        }).join('');
        return `
            <tr>
                <td data-label="First name">${first || '<span style="color:var(--text-secondary);">—</span>'}</td>
                <td data-label="Last name">${last || '<span style="color:var(--text-secondary);">—</span>'}</td>
                <td data-label="Email">${email}</td>
                <td data-label="Phone number">${phoneCell}</td>
                <td data-label="Roles">${roleBadges || '<span style="color:var(--text-secondary);">—</span>'}</td>
                <td data-label="Actions" style="text-align:right;">
                    <button class="btn btn-outline-secondary btn-sm" onclick="openCrmUserPhoneModal('${userId}')">Edit phone</button>
                </td>
            </tr>
        `;
    }).join('');
}

function openCrmUserPhoneModal(userId) {
    const u = _crmUsersCache.find(x => x.user_id === userId);
    if (!u) {
        if (typeof Toast !== 'undefined' && Toast.error) Toast.error('User not found — refresh and try again');
        return;
    }
    document.getElementById('crmUserPhoneUserId').value = u.user_id || '';
    const displayName = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || '';
    document.getElementById('crmUserPhoneUserName').value = displayName + (u.email ? ` <${u.email}>` : '');
    document.getElementById('crmUserPhoneNumber').value = u.phone_number || '';
    const subtitle = document.getElementById('crmUserPhoneSubtitle');
    if (subtitle) subtitle.textContent = displayName ? `Caller ID for ${displayName}` : 'Update the rep\'s caller ID';
    openModal('crmUserPhoneModal');
    setTimeout(() => document.getElementById('crmUserPhoneNumber')?.focus(), 50);
}

function closeCrmUserPhoneModal() {
    closeModal('crmUserPhoneModal');
}

function clearCrmUserPhone() {
    const phoneField = document.getElementById('crmUserPhoneNumber');
    if (phoneField) {
        phoneField.value = '';
        phoneField.focus();
    }
}

async function handleCrmUserPhoneSubmit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const userId = document.getElementById('crmUserPhoneUserId').value;
    const phoneNumber = (document.getElementById('crmUserPhoneNumber').value || '').trim();
    if (!userId) return;

    const saveBtn = document.getElementById('crmUserPhoneSaveBtn');
    const originalLabel = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    try {
        // CRM service uses JsonNamingPolicy.SnakeCaseLower — body must use snake_case keys
        // or [FromBody] binds the field to null and the server silently clears the phone.
        const resp = await api.request(`/crm-admin/users/${encodeURIComponent(userId)}/phone`, {
            method: 'PUT',
            body: JSON.stringify({ phone_number: phoneNumber })
        });
        if (typeof Toast !== 'undefined' && Toast.success) {
            Toast.success(phoneNumber ? 'Phone updated' : 'Phone cleared');
        }
        // Patch cache locally so we don't need a full reload before refreshCache returns
        const idx = _crmUsersCache.findIndex(u => u.user_id === userId);
        if (idx >= 0) _crmUsersCache[idx].phone_number = resp?.phone_number || '';
        renderCrmUsersTable(_crmUsersCache);
        closeCrmUserPhoneModal();
        // Reload from server to confirm persistence
        loadCrmUsersTab();
    } catch (err) {
        console.error('[crm-users] save phone failed:', err);
        if (typeof Toast !== 'undefined' && Toast.error) {
            Toast.error('Failed to save phone: ' + (err?.message || 'unknown'));
        }
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalLabel || 'Save'; }
    }
}

window.loadCrmUsersTab = loadCrmUsersTab;
window.openCrmUserPhoneModal = openCrmUserPhoneModal;
window.closeCrmUserPhoneModal = closeCrmUserPhoneModal;
window.clearCrmUserPhone = clearCrmUserPhone;
window.handleCrmUserPhoneSubmit = handleCrmUserPhoneSubmit;
