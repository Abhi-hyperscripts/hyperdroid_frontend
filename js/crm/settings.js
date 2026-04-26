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
    return div.innerHTML;
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

    // Only CRM_ADMIN or SUPERADMIN can access settings
    const user = api.getUser();
    const roles = user?.roles || [];
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
    const KNOWN_TABS = ['general','pipeline','integrations','mailboxes','templates','campaigns','lead-sources','functional-groups','teams','danger-zone'];
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
    'teams': 'Teams Setup'
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
    } else if (tabName === 'lead-sources') {
        loadLeadSources();
    } else if (tabName === 'functional-groups' && typeof loadFunctionalGroups === 'function') {
        loadFunctionalGroups();
    } else if (tabName === 'teams' && typeof loadTeamsTab === 'function') {
        loadTeamsTab();
    } else if (tabName === 'mailboxes' && typeof loadMailboxesTab === 'function') {
        loadMailboxesTab();
    } else if (tabName === 'templates' && typeof loadTemplatesTab === 'function') {
        loadTemplatesTab();
    } else if (tabName === 'campaigns' && typeof loadCampaignsTab === 'function') {
        loadCampaignsTab();
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

        const response = await api.request('/crm/crm-settings/default_currency');
        const currency = (response && response.value) ? response.value : 'USD';

        const select = document.getElementById('defaultCurrency');
        if (select) select.value = currency;
        if (defaultCurrencyDropdown) defaultCurrencyDropdown.setValue(currency);
    } catch (error) {
        console.error('Error loading general settings:', error);
    } finally {
        if (loading) loading.style.display = 'none';
        if (form) form.style.display = 'block';
    }
}

async function saveGeneralSettings() {
    const btn = document.getElementById('saveGeneralBtn');
    const spinner = document.getElementById('saveGeneralSpinner');
    const currency = defaultCurrencyDropdown ? defaultCurrencyDropdown.getValue() : document.getElementById('defaultCurrency')?.value;

    if (!currency) return;

    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';

    try {
        await api.request('/crm/crm-settings/default_currency', {
            method: 'PUT',
            body: JSON.stringify({ value: currency })
        });
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

    // Event delegation picks up data-fb-form-action; leadSourceId lives in data-fb-source-id.
    return `
        <div style="display: flex; align-items: center; gap: 10px; padding: 6px 0;"
             data-fb-source-id="${escapeHtml(form.lead_source_id || '')}" data-fb-active="${form.is_active ? '1' : '0'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-secondary); flex-shrink: 0;">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <span style="font-size: 0.9em;">${escapeHtml(form.source_name || 'Unnamed form')}</span>
            ${stateBadge}
            <span style="font-size: 0.8em; color: var(--text-secondary);">${form.total_leads_received || 0} leads</span>
            <div style="margin-left: auto; display: flex; gap: 4px;">
                <button type="button" class="btn btn-outline" data-fb-form-action="toggle" style="padding: 2px 8px; font-size: 0.7rem;">
                    ${form.is_active ? 'Pause' : 'Resume'}
                </button>
                <button type="button" class="btn btn-outline" data-fb-form-action="remove" style="padding: 2px 8px; font-size: 0.7rem;">
                    Remove
                </button>
            </div>
        </div>
    `;
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
            const action = formBtn.getAttribute('data-fb-form-action');
            if (action === 'toggle') toggleFacebookFormSource(sourceId, !isActive);
            else if (action === 'remove') disconnectFacebookFormSource(sourceId);
        }
    });
    _fbPagesListBound = true;
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

    try {
        if (existingId) {
            await api.request(`/crm/facebook/forms/${existingId}/mapping`, {
                method: 'PUT',
                body: JSON.stringify({ field_mappings: JSON.stringify(mappings) })
            });
        } else {
            await api.request('/crm/facebook/forms/connect', {
                method: 'POST',
                body: JSON.stringify({
                    page_id: pageId,
                    form_id: formId,
                    form_name: formName,
                    field_mappings: JSON.stringify(mappings),
                    source_name: sourceName
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
                            <button class="crm-action-btn" onclick="copyWebhookUrl('${escapeHtml(source.webhook_key)}')" title="Copy URL" style="flex-shrink: 0;">
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

function openNewLeadSourceModal() {
    editingLeadSourceId = null;
    document.getElementById('leadSourceModalTitle').textContent = 'New Lead Source';
    document.getElementById('leadSourceSubmitBtn').textContent = 'Create Source';
    document.getElementById('leadSourceForm').reset();
    document.getElementById('leadSourceId').value = '';
    clearFieldMappingsEditor();
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

    // Populate field mappings
    populateFieldMappingsEditor(source.field_mappings);

    openModal('leadSourceModal');
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
        const fieldMappings = getFieldMappingsFromEditor();

        const payload = {
            source_name: document.getElementById('leadSourceName').value.trim(),
            source_type: document.getElementById('leadSourceType').value,
            source_identifier: document.getElementById('leadSourceIdentifier').value.trim() || null,
            field_mappings: JSON.stringify(fieldMappings)
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

// ─── Field Mappings Editor ───────────────────────────────────────────────────

function clearFieldMappingsEditor() {
    document.getElementById('mapFirstName').value = '';
    document.getElementById('mapLastName').value = '';
    document.getElementById('mapFullName').value = '';
    document.getElementById('mapEmail').value = '';
    document.getElementById('mapPhone').value = '';
    document.getElementById('mapCompany').value = '';
    document.getElementById('mapJobTitle').value = '';
    document.getElementById('customFieldMappings').innerHTML = '';
}

function addCustomFieldRow(fieldName = '', aliases = '') {
    const container = document.getElementById('customFieldMappings');
    const row = document.createElement('div');
    row.className = 'custom-field-mapping-row';
    row.innerHTML = `
        <input type="text" class="custom-field-name" placeholder="field_name" value="${fieldName}">
        <input type="text" class="custom-field-aliases" placeholder="alias1, alias2, alias3" value="${aliases}">
        <button type="button" class="btn-remove-custom-field" title="Remove field" onclick="this.parentElement.remove()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    `;
    container.appendChild(row);
}

function populateFieldMappingsEditor(fieldMappingsJson) {
    clearFieldMappingsEditor();
    if (!fieldMappingsJson || fieldMappingsJson === '{}') return;

    try {
        const mappings = typeof fieldMappingsJson === 'string'
            ? JSON.parse(fieldMappingsJson)
            : fieldMappingsJson;

        const fieldMap = {
            'first_name': 'mapFirstName',
            'last_name': 'mapLastName',
            'full_name': 'mapFullName',
            'email': 'mapEmail',
            'phone': 'mapPhone',
            'company_name': 'mapCompany',
            'job_title': 'mapJobTitle'
        };

        const coreKeys = new Set(Object.keys(fieldMap));

        for (const [key, inputId] of Object.entries(fieldMap)) {
            const val = mappings[key];
            if (val) {
                const el = document.getElementById(inputId);
                if (el) {
                    el.value = Array.isArray(val) ? val.join(', ') : val;
                }
            }
        }

        // Load custom fields (any key not in core set)
        for (const [key, val] of Object.entries(mappings)) {
            if (!coreKeys.has(key)) {
                const aliases = Array.isArray(val) ? val.join(', ') : val;
                addCustomFieldRow(key, aliases);
            }
        }
    } catch (e) {
        console.error('Error parsing field mappings:', e);
    }
}

function getFieldMappingsFromEditor() {
    const mappings = {};

    const fields = {
        'first_name': 'mapFirstName',
        'last_name': 'mapLastName',
        'full_name': 'mapFullName',
        'email': 'mapEmail',
        'phone': 'mapPhone',
        'company_name': 'mapCompany',
        'job_title': 'mapJobTitle'
    };

    for (const [key, inputId] of Object.entries(fields)) {
        const val = document.getElementById(inputId)?.value?.trim();
        if (val) {
            mappings[key] = val.split(',').map(s => s.trim()).filter(s => s);
        }
    }

    // Collect custom field mappings
    const customRows = document.querySelectorAll('#customFieldMappings .custom-field-mapping-row');
    customRows.forEach(row => {
        const fieldName = row.querySelector('.custom-field-name')?.value?.trim();
        const aliases = row.querySelector('.custom-field-aliases')?.value?.trim();
        if (fieldName && aliases) {
            const key = fieldName.toLowerCase().replace(/\s+/g, '_');
            mappings[key] = aliases.split(',').map(s => s.trim()).filter(s => s);
        }
    });

    return mappings;
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
    form_width: 440
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
    form_width: 440
};

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
        form_width: parseInt(document.getElementById('fsFormWidth')?.value || '440')
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

    // Build preview fields from cached source fields
    const fields = formStylingFields || [
        { label: 'Email', type: 'email', placeholder: 'you@example.com', required: true },
        { label: 'Phone', type: 'tel', placeholder: '+1 (555) 000-0000', required: false },
    ];

    const showLabels = s.show_labels !== false;

    let fieldsHtml = '';
    fields.forEach(f => {
        const reqMark = f.required ? `<span style="color: #ef4444; margin-left: 2px;"> *</span>` : '';
        const labelHtml = showLabels ? `<label class="pf-label">${_escHtml(f.label)}${reqMark}</label>` : '';
        if (f.type === 'textarea') {
            fieldsHtml += `
                <div class="pf-field">
                    ${labelHtml}
                    <textarea rows="2" placeholder="${_escHtml(f.placeholder || '')}" disabled class="pf-textarea"></textarea>
                </div>`;
        } else {
            fieldsHtml += `
                <div class="pf-field">
                    ${labelHtml}
                    <input type="${f.type || 'text'}" placeholder="${_escHtml(f.placeholder || '')}" disabled class="pf-input">
                </div>`;
        }
    });

    const formTitle = s.form_title || '';

    // Logo HTML (no onerror — iframe sandbox blocks inline scripts)
    const logoUrl = s.logo_url || '';
    const logoHeight = s.logo_height || 32;
    const logoPos = s.logo_position || 'top';
    const logoHtml = logoUrl
        ? `<div class="pf-logo ${logoPos === 'bottom' ? 'pf-logo-bottom' : ''}"><img src="${_escHtml(logoUrl)}" alt="Logo"></div>`
        : '';

    // Extra top padding on body when there's nothing above it (no logo-top, no title)
    const hasTopContent = (logoPos === 'top' && logoUrl) || formTitle;
    const bodyPadTop = hasTopContent ? '20px' : '48px';

    // Build a fully self-contained HTML document for the iframe
    const iframeDoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
        margin: 0; padding: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        min-height: 100%;
    }
    body {
        display: flex; align-items: flex-start; justify-content: center; padding: 16px;
        /* Demo background for opacity/glassy preview */
        background:
            linear-gradient(135deg, #667eea 0%, #764ba2 100%),
            linear-gradient(45deg, #f093fb 0%, #f5576c 100%);
        background-size: cover;
    }
    .pf-card {
        width: 100%;
        max-width: ${s.form_width || 440}px;
        position: relative;
        background: ${cardBg};
        border-radius: ${radius};
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.04);
        color: ${s.text_color};
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
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: ${s.text_color};
    }
    .pf-body { padding: ${bodyPadTop} 24px 24px; }
    .pf-field { margin-bottom: 16px; }
    .pf-label {
        display: block;
        font-size: 0.82rem;
        font-weight: 600;
        margin-bottom: 6px;
        color: ${s.label_color};
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
        font-family: inherit;
        border: none;
        border-radius: ${radius};
        cursor: default;
        background: ${s.button_color};
        color: ${s.button_text_color};
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.12);
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
<body>
    <div class="pf-card">
        <button class="pf-close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${logoPos === 'top' ? logoHtml : ''}
        ${formTitle ? `<div class="pf-header"><div class="pf-title">${_escHtml(formTitle)}</div></div>` : ''}
        <div class="pf-body">
            ${fieldsHtml}
            <button disabled class="pf-submit">${_escHtml(s.button_text || 'Submit')}</button>
        </div>
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
// Both endpoints derive tenant_id from the JWT — we never send it, so a
// SUPERADMIN can only wipe their own tenant.
let _pendingWipeMode = null;

function openWipeModal(mode) {
    _pendingWipeMode = mode;
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
    } else {
        titleEl.textContent = 'Wipe All CRM Data';
        descEl.innerHTML = 'This will delete <strong>EVERYTHING</strong> for this tenant — including teams, members, functional areas, deal stages, lead sources, integrations, and CRM settings. Use only when seeding a fresh tenant.';
    }

    inputEl.value = '';
    btn.disabled = true;
    document.getElementById('wipeModal').classList.add('active');
    setTimeout(() => inputEl.focus(), 50);
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

    const endpoint = mode === 'leads' ? '/crm/crm-admin/wipe-leads' : '/crm/crm-admin/wipe-all';
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Wiping...';

    try {
        const res = await api.request(endpoint, {
            method: 'POST',
            body: JSON.stringify({ confirm: 'WIPE' })
        });
        Toast.success(`Wiped — ${res.deleted_rows} rows deleted (${res.scope}).`);
        closeWipeModal();
        // Bounce to dashboard so the user sees a fresh state.
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
    } catch (e) {
        console.error('Wipe failed:', e);
        Toast.error(e.message || 'Wipe failed');
        btn.disabled = false;
        btn.textContent = original;
    }
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
        _gsServiceAccount = saInfo || { enabled: false };
        renderGoogleSheetsCard(_gsConnections, sheets || []);
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
                        <button class="btn btn-sm btn-outline" onclick="openGoogleSheetSyncLogs('${escapeHtml(r.lead_source_id)}', '${escapeHtml(r.spreadsheet_name)}', '${escapeHtml(r.sheet_tab_name || '')}')">Logs</button>
                        <button class="btn btn-sm btn-outline" onclick="toggleGoogleSheet('${escapeHtml(r.lead_source_id)}', ${!r.is_active})">${toggleLabel}</button>
                        <button class="btn btn-sm btn-outline" onclick="disconnectGoogleSheet('${escapeHtml(r.lead_source_id)}')">Remove</button>
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
            <div class="gs-pickable-row" onclick="gsSelectTab('${escapeHtml(t.name)}', ${t.index})"
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
        const res = await api.request(
            `/crm/GoogleSheets/connections/${_gsSelectedConnectionId}` +
            `/spreadsheets/${encodeURIComponent(_gsSelectedSpreadsheet.spreadsheet_id)}` +
            `/tabs/${encodeURIComponent(_gsSelectedTab.name)}` +
            `/preview?headerRow=${headerRow}`
        );
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
        const guess = gsGuessMapping(header);
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
            <div class="gs-pickable-row" onclick="gsShareSelectTab('${escapeHtml(t.name)}', ${t.index})"
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
