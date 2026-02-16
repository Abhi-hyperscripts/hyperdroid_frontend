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

    Navigation.init('crm', '../');

    // Setup sidebar
    setupSettingsSidebar();

    // Check for OAuth callback parameters
    handleOAuthCallback();

    initSearchableDropdowns();

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
    'lead-sources': 'Lead Sources'
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
    document.querySelectorAll('.crm-settings-sidebar .sidebar-btn').forEach(btn => {
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

        for (const [key, inputId] of Object.entries(fieldMap)) {
            const val = mappings[key];
            if (val) {
                const el = document.getElementById(inputId);
                if (el) {
                    el.value = Array.isArray(val) ? val.join(', ') : val;
                }
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

    return mappings;
}
