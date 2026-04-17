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

    // Load initial data
    await loadGeneralSettings();
    await loadDealStages();
});

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
    } else if (tabName === 'lead-sources') {
        loadLeadSources();
    } else if (tabName === 'functional-groups' && typeof loadFunctionalGroups === 'function') {
        loadFunctionalGroups();
    } else if (tabName === 'teams' && typeof loadTeamsTab === 'function') {
        loadTeamsTab();
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

async function loadFacebookPages() {
    try {
        const result = await api.request('/crm/facebook/pages');
        facebookPages = result || [];
        renderFacebookPages();
    } catch (error) {
        console.error('Error loading Facebook pages:', error);
        facebookPages = [];
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
        statusText.textContent = `${activePages.length} page${activePages.length > 1 ? 's' : ''} connected`;
        pagesList.style.display = 'block';

        pagesList.innerHTML = activePages.map(page => `
            <li>
                <div class="page-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="color: #1877f2;">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                    <span>${escapeHtml(page.page_name)}</span>
                    <span class="lead-count">${page.total_leads_received} lead${page.total_leads_received !== 1 ? 's' : ''}</span>
                </div>
                <button class="btn btn-outline" style="padding: 4px 12px; font-size: 0.75rem;" onclick="disconnectFacebookPage('${escapeHtml(page.page_id)}')">
                    Disconnect
                </button>
            </li>
        `).join('');
    } else {
        statusDot.className = 'dot disconnected';
        statusText.textContent = 'Not connected';
        pagesList.style.display = 'none';
        pagesList.innerHTML = '';
    }
}

async function connectFacebook() {
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
    const confirmed = await showConfirm('Are you sure you want to disconnect this Facebook page? New leads will no longer be captured.', 'Disconnect Facebook', 'danger');
    if (!confirmed) return;

    try {
        await api.request(`/crm/facebook/disconnect/${pageId}`, {
            method: 'POST'
        });
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
    document.getElementById('wipeModal').classList.add('show');
    setTimeout(() => inputEl.focus(), 50);
}

function closeWipeModal() {
    document.getElementById('wipeModal').classList.remove('show');
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
