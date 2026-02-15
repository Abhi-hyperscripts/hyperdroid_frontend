/**
 * CRM Settings Page JavaScript
 * Handles pipeline stages, Facebook integration, and lead sources configuration
 */

let dealStages = [];
let facebookPages = [];
let editingStageId = null;
let deletingStageId = null;

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

    // Check for OAuth callback parameters
    handleOAuthCallback();

    // Load initial data
    await loadDealStages();
});

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

// ─── Tab Switching ──────────────────────────────────────────────────────────

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.crm-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.crm-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Load tab-specific data
    if (tabName === 'integrations') {
        loadFacebookPages();
    }
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
    const sorted = [...dealStages].sort((a, b) => a.stageOrder - b.stageOrder);

    list.innerHTML = sorted.map((stage, index) => `
        <div class="stage-card" data-stage-id="${stage.id}">
            <div class="stage-card-info">
                <div class="stage-color-dot" style="background: ${escapeHtml(stage.color || '#3b82f6')};"></div>
                <div>
                    <div class="stage-name">${escapeHtml(stage.stageName)}</div>
                    <div class="stage-meta">
                        <span class="stage-type-badge ${stage.stageType}">${escapeHtml(stage.stageType)}</span>
                        <span>Order: ${stage.stageOrder}</span>
                        <span>Win: ${stage.winProbability}%</span>
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
    const sorted = [...dealStages].sort((a, b) => a.stageOrder - b.stageOrder);
    const index = sorted.findIndex(s => s.id === stageId);

    if (index < 0) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === sorted.length - 1) return;

    const swapIndex = direction === 'up' ? index - 1 : index + 1;

    // Swap orders
    const temp = sorted[index].stageOrder;
    sorted[index].stageOrder = sorted[swapIndex].stageOrder;
    sorted[swapIndex].stageOrder = temp;

    // Build reorder payload
    const stages = sorted.map(s => ({
        stageId: s.id,
        newOrder: s.stageOrder
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

    // Set order to max + 1
    const maxOrder = dealStages.reduce((max, s) => Math.max(max, s.stageOrder), 0);
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
    document.getElementById('stageName').value = stage.stageName || '';
    document.getElementById('stageType').value = stage.stageType || 'open';
    document.getElementById('stageOrder').value = stage.stageOrder || 0;
    document.getElementById('stageWinProbability').value = stage.winProbability || 0;
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
    document.getElementById('deleteStageName').textContent = stage.stageName || '';
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
                stageName: document.getElementById('stageName').value.trim(),
                stageType: document.getElementById('stageType').value,
                winProbability: parseFloat(document.getElementById('stageWinProbability').value) || 0,
                color: document.getElementById('stageColor').value || null
            };

            await api.request(`/crm/deal-stages/${editingStageId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            Toast.success('Stage updated successfully');
        } else {
            const payload = {
                pipelineName: 'Default',
                stageName: document.getElementById('stageName').value.trim(),
                stageOrder: parseInt(document.getElementById('stageOrder').value) || 0,
                stageType: document.getElementById('stageType').value,
                winProbability: parseFloat(document.getElementById('stageWinProbability').value) || 0,
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

    const activePages = facebookPages.filter(p => p.isActive);

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
                    <span>${escapeHtml(page.pageName)}</span>
                    <span class="lead-count">${page.totalLeadsReceived} lead${page.totalLeadsReceived !== 1 ? 's' : ''}</span>
                </div>
                <button class="btn btn-outline" style="padding: 4px 12px; font-size: 0.75rem;" onclick="disconnectFacebookPage('${escapeHtml(page.pageId)}')">
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
        if (result && result.authUrl) {
            window.location.href = result.authUrl;
        } else {
            Toast.error('Failed to get Facebook auth URL');
        }
    } catch (error) {
        console.error('Error connecting Facebook:', error);
        Toast.error(error.message || 'Failed to initiate Facebook connection');
    }
}

async function disconnectFacebookPage(pageId) {
    if (!confirm('Are you sure you want to disconnect this Facebook page? New leads will no longer be captured.')) {
        return;
    }

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
