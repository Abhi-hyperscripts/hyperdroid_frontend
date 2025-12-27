/**
 * HRMS Organization Chart Page - Scalable Tree View
 * Designed to handle 10,000+ employees efficiently
 */

let orgData = null;
let flatOrgData = []; // Flattened version for search and virtual scrolling
let expandedNodes = new Set();
let searchTimeout = null;
let highlightedId = null;
let selectedId = null;
let departments = [];
let offices = [];

// Virtual scrolling config
const ROW_HEIGHT = 52; // Height of each row in pixels
const BUFFER_SIZE = 10; // Extra rows to render above/below viewport
let visibleData = [];
let scrollContainer = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    if (typeof Navigation !== 'undefined') Navigation.init();

    // Load filter options
    await loadFilterOptions();
    await loadOrgChart();

    // Setup keyboard navigation
    setupKeyboardNavigation();
});

async function loadFilterOptions() {
    try {
        const [deptResponse, officeResponse] = await Promise.all([
            api.getHrmsDepartments(),
            api.getHrmsOffices()
        ]);
        departments = deptResponse.departments || deptResponse || [];
        offices = officeResponse.offices || officeResponse || [];
        populateFilters();
    } catch (error) {
        console.error('Error loading filters:', error);
    }
}

function populateFilters() {
    const deptSelect = document.getElementById('departmentFilter');
    const officeSelect = document.getElementById('officeFilter');

    if (deptSelect) {
        deptSelect.innerHTML = '<option value="">All Departments</option>';
        departments.forEach(dept => {
            deptSelect.innerHTML += `<option value="${dept.id}">${escapeHtml(dept.department_name || dept.name)}</option>`;
        });
    }

    if (officeSelect) {
        officeSelect.innerHTML = '<option value="">All Offices</option>';
        offices.forEach(office => {
            officeSelect.innerHTML += `<option value="${office.id}">${escapeHtml(office.office_name || office.name)}</option>`;
        });
    }
}

async function loadOrgChart(rootEmployeeId = null) {
    const container = document.getElementById('orgTree');
    container.innerHTML = '<div class="tree-loading"><div class="spinner"></div><span>Loading organization chart...</span></div>';

    try {
        orgData = await api.getOrgChart(rootEmployeeId);
        // Flatten the hierarchical data for search and rendering
        flatOrgData = flattenOrgData(orgData);

        // Update stats
        updateStats();

        // Build visible data based on expanded nodes
        buildVisibleData();
        renderOrgTree();
    } catch (error) {
        console.error('Error loading org chart:', error);
        container.innerHTML = '<div class="tree-error"><p>Failed to load organization chart</p></div>';
    }
}

function updateStats() {
    const totalCount = document.getElementById('totalCount');
    const deptCount = document.getElementById('deptCount');
    const managerCount = document.getElementById('managerCount');

    if (totalCount) totalCount.textContent = flatOrgData.length;

    // Count unique departments
    const uniqueDepts = new Set(flatOrgData.map(e => e.department_id).filter(Boolean));
    if (deptCount) deptCount.textContent = uniqueDepts.size;

    // Count managers (employees with direct reports)
    const managers = flatOrgData.filter(e => (e.direct_reports || []).length > 0);
    if (managerCount) managerCount.textContent = managers.length;
}

// Flatten hierarchical data for efficient processing
function flattenOrgData(nodes, parentId = null, level = 0, path = []) {
    if (!nodes || !Array.isArray(nodes)) return [];
    let result = [];
    nodes.forEach(node => {
        const nodePath = [...path, node.id];
        result.push({
            ...node,
            parent_id: parentId,
            level,
            path: nodePath,
            hasChildren: (node.direct_reports || []).length > 0,
            childCount: (node.direct_reports || []).length
        });
        if (node.direct_reports && node.direct_reports.length > 0) {
            result = result.concat(flattenOrgData(node.direct_reports, node.id, level + 1, nodePath));
        }
    });
    return result;
}

// Build list of visible nodes based on expanded state
function buildVisibleData() {
    const searchQuery = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const deptFilter = document.getElementById('departmentFilter')?.value || '';
    const officeFilter = document.getElementById('officeFilter')?.value || '';

    visibleData = [];

    // If searching, show all matching results with their paths expanded
    if (searchQuery) {
        const matchingNodes = flatOrgData.filter(node => {
            const name = getDisplayName(node).toLowerCase();
            const code = (node.employee_code || '').toLowerCase();
            const dept = (node.department || node.department_name || '').toLowerCase();
            const designation = (node.designation || node.designation_name || '').toLowerCase();
            return name.includes(searchQuery) ||
                   code.includes(searchQuery) ||
                   dept.includes(searchQuery) ||
                   designation.includes(searchQuery);
        });

        // Expand paths to all matching nodes
        matchingNodes.forEach(node => {
            node.path.forEach(id => expandedNodes.add(id));
        });
    }

    // Build visible list based on expansion state and filters
    flatOrgData.forEach(node => {
        // Check if this node should be visible
        const isRoot = node.level === 0;
        const parentExpanded = node.parent_id ? expandedNodes.has(node.parent_id) : true;

        // Check all ancestors are expanded
        let allAncestorsExpanded = true;
        if (!isRoot) {
            let currentId = node.parent_id;
            while (currentId && allAncestorsExpanded) {
                if (!expandedNodes.has(currentId)) {
                    allAncestorsExpanded = false;
                }
                const parent = flatOrgData.find(n => n.id === currentId);
                currentId = parent ? parent.parent_id : null;
            }
        }

        if (!isRoot && !allAncestorsExpanded) return;

        // Apply filters
        if (deptFilter && node.department_id !== deptFilter) return;
        if (officeFilter && node.office_id !== officeFilter) return;

        // Check if matches search (if searching)
        if (searchQuery) {
            const name = getDisplayName(node).toLowerCase();
            const code = (node.employee_code || '').toLowerCase();
            const dept = (node.department || node.department_name || '').toLowerCase();
            const designation = (node.designation || node.designation_name || '').toLowerCase();
            const matchesSearch = name.includes(searchQuery) ||
                                  code.includes(searchQuery) ||
                                  dept.includes(searchQuery) ||
                                  designation.includes(searchQuery);
            // Show if matches or is in path to a match
            const inPathToMatch = flatOrgData.some(n =>
                n.path.includes(node.id) && (
                    getDisplayName(n).toLowerCase().includes(searchQuery) ||
                    (n.employee_code || '').toLowerCase().includes(searchQuery)
                )
            );
            if (!matchesSearch && !inPathToMatch) return;
        }

        visibleData.push(node);
    });
}

function renderOrgTree() {
    const container = document.getElementById('orgTree');

    if (!orgData || flatOrgData.length === 0) {
        container.innerHTML = `
            <div class="tree-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="2" width="6" height="6" rx="1"/>
                    <rect x="2" y="16" width="6" height="6" rx="1"/>
                    <rect x="16" y="16" width="6" height="6" rx="1"/>
                    <line x1="12" y1="8" x2="12" y2="13"/>
                    <line x1="5" y1="13" x2="19" y2="13"/>
                    <line x1="5" y1="13" x2="5" y2="16"/>
                    <line x1="19" y1="13" x2="19" y2="16"/>
                </svg>
                <p>No organization data available</p>
            </div>
        `;
        return;
    }

    // Render tree rows
    const rows = visibleData.map((node, index) => renderTreeRow(node, index)).join('');

    container.innerHTML = `
        <div class="tree-header">
            <div class="tree-col tree-col-name">Employee</div>
            <div class="tree-col tree-col-designation">Designation</div>
            <div class="tree-col tree-col-department">Department</div>
            <div class="tree-col tree-col-office">Office</div>
            <div class="tree-col tree-col-reports">Reports</div>
        </div>
        <div class="tree-body" id="treeBody">
            ${rows}
        </div>
    `;

    // Update visible count
    const visibleCount = document.getElementById('visibleCount');
    if (visibleCount) visibleCount.textContent = visibleData.length;

    // Scroll to highlighted node if exists
    if (highlightedId) {
        setTimeout(() => {
            const node = document.querySelector(`[data-id="${highlightedId}"]`);
            if (node) {
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
}

function renderTreeRow(node, index) {
    const displayName = getDisplayName(node);
    const designation = node.designation || node.designation_name || '--';
    const department = node.department || node.department_name || '--';
    const office = node.office_name || node.office || '--';
    const isExpanded = expandedNodes.has(node.id);
    const isHighlighted = node.id === highlightedId;
    const isSelected = node.id === selectedId;
    const hasChildren = node.hasChildren;
    const childCount = node.childCount || 0;
    const indentPx = node.level * 24;

    // Check if matches current search
    const searchQuery = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const matchesSearch = searchQuery && (
        getDisplayName(node).toLowerCase().includes(searchQuery) ||
        (node.employee_code || '').toLowerCase().includes(searchQuery)
    );

    return `
        <div class="tree-row ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''} ${matchesSearch ? 'search-match' : ''}"
             data-id="${node.id}"
             data-index="${index}"
             onclick="selectNode('${node.id}')"
             ondblclick="toggleNode('${node.id}')">
            <div class="tree-col tree-col-name">
                <div class="tree-indent" style="width: ${indentPx}px"></div>
                ${hasChildren ? `
                    <button class="tree-toggle ${isExpanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleNode('${node.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 18 15 12 9 6"/>
                        </svg>
                    </button>
                ` : '<div class="tree-toggle-placeholder"></div>'}
                <div class="tree-avatar ${node.profile_photo_url ? 'has-photo' : ''}">
                    ${node.profile_photo_url
                        ? `<img src="${node.profile_photo_url}" alt="${escapeHtml(displayName)}">`
                        : `<span>${getInitialsFromName(displayName)}</span>`
                    }
                </div>
                <div class="tree-name-info">
                    <span class="tree-name">${escapeHtml(displayName)}</span>
                    <span class="tree-code">${escapeHtml(node.employee_code || '')}</span>
                </div>
            </div>
            <div class="tree-col tree-col-designation">${escapeHtml(designation)}</div>
            <div class="tree-col tree-col-department">${escapeHtml(department)}</div>
            <div class="tree-col tree-col-office">${escapeHtml(office)}</div>
            <div class="tree-col tree-col-reports">
                ${hasChildren ? `<span class="report-count">${childCount}</span>` : '-'}
            </div>
        </div>
    `;
}

function getDisplayName(node) {
    return node.name || `${node.first_name || ''} ${node.last_name || ''}`.trim() || node.employee_code || 'Unknown';
}

function toggleNode(id) {
    if (expandedNodes.has(id)) {
        // Collapse this node and all descendants
        collapseNodeAndDescendants(id);
    } else {
        expandedNodes.add(id);
    }
    buildVisibleData();
    renderOrgTree();
}

function collapseNodeAndDescendants(id) {
    expandedNodes.delete(id);
    // Also collapse all descendants
    flatOrgData.forEach(node => {
        if (node.path && node.path.includes(id) && node.id !== id) {
            expandedNodes.delete(node.id);
        }
    });
}

function selectNode(id) {
    selectedId = id;
    // Re-render to show selection
    document.querySelectorAll('.tree-row').forEach(row => {
        row.classList.toggle('selected', row.dataset.id === id);
    });

    // Show details panel
    showEmployeeDetails(id);
}

function expandAll() {
    flatOrgData.forEach(emp => {
        if (emp.hasChildren) {
            expandedNodes.add(emp.id);
        }
    });
    buildVisibleData();
    renderOrgTree();
}

function collapseAll() {
    expandedNodes.clear();
    buildVisibleData();
    renderOrgTree();
}

function resetChart() {
    highlightedId = null;
    selectedId = null;
    expandedNodes.clear();
    document.getElementById('searchInput').value = '';
    document.getElementById('departmentFilter').value = '';
    document.getElementById('officeFilter').value = '';
    hideDetailsPanel();
    loadOrgChart();
}

function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        buildVisibleData();
        renderOrgTree();
    }, 300);
}

function applyFilters() {
    buildVisibleData();
    renderOrgTree();
}

function showEmployeeDetails(id) {
    const emp = flatOrgData.find(e => e.id === id);
    if (!emp) return;

    const panel = document.getElementById('detailsPanel');
    const content = document.getElementById('detailsContent');

    const displayName = getDisplayName(emp);
    const designation = emp.designation || emp.designation_name || '--';
    const department = emp.department || emp.department_name || '--';
    const office = emp.office_name || emp.office || '--';
    const directReportsCount = emp.childCount || 0;

    // Find manager details
    let manager = null;
    if (emp.parent_id) {
        manager = flatOrgData.find(e => e.id === emp.parent_id);
    }

    content.innerHTML = `
        <div class="detail-header">
            <div class="detail-avatar ${emp.profile_photo_url ? 'has-photo' : ''}">
                ${emp.profile_photo_url
                    ? `<img src="${emp.profile_photo_url}" alt="${escapeHtml(displayName)}">`
                    : `<span>${getInitialsFromName(displayName)}</span>`
                }
            </div>
            <div class="detail-name-section">
                <h2>${escapeHtml(displayName)}</h2>
                <span class="detail-code">${escapeHtml(emp.employee_code || '')}</span>
            </div>
        </div>

        <div class="detail-info-grid">
            <div class="detail-info-item">
                <label>Designation</label>
                <span>${escapeHtml(designation)}</span>
            </div>
            <div class="detail-info-item">
                <label>Department</label>
                <span>${escapeHtml(department)}</span>
            </div>
            <div class="detail-info-item">
                <label>Office</label>
                <span>${escapeHtml(office)}</span>
            </div>
            <div class="detail-info-item reports-to-section">
                <label>Reports To</label>
                ${manager ? `
                <div class="manager-card" onclick="focusOnEmployee('${manager.id}')">
                    <div class="manager-avatar ${manager.profile_photo_url ? 'has-photo' : ''}">
                        ${manager.profile_photo_url
                            ? `<img src="${manager.profile_photo_url}" alt="${escapeHtml(getDisplayName(manager))}">`
                            : `<span>${getInitialsFromName(getDisplayName(manager))}</span>`
                        }
                    </div>
                    <div class="manager-info">
                        <span class="manager-name">${escapeHtml(getDisplayName(manager))}</span>
                        <span class="manager-designation">${escapeHtml(manager.designation || manager.designation_name || '--')}</span>
                        <span class="manager-details">${escapeHtml(manager.office_name || manager.office || '--')} • ${escapeHtml(manager.employee_code || '')}</span>
                    </div>
                </div>
                ` : '<span>--</span>'}
            </div>
            <div class="detail-info-item">
                <label>Direct Reports</label>
                <span>${directReportsCount > 0 ? `${directReportsCount} employee${directReportsCount !== 1 ? 's' : ''}` : 'None'}</span>
            </div>
            ${emp.email || emp.work_email ? `
            <div class="detail-info-item">
                <label>Email</label>
                <span><a href="mailto:${emp.email || emp.work_email}">${escapeHtml(emp.email || emp.work_email)}</a></span>
            </div>
            ` : ''}
            ${emp.work_phone ? `
            <div class="detail-info-item">
                <label>Phone</label>
                <span><a href="tel:${emp.work_phone}">${escapeHtml(emp.work_phone)}</a></span>
            </div>
            ` : ''}
        </div>

        <div class="detail-actions">
            <button class="btn-secondary" onclick="setAsRoot('${id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                View as Root
            </button>
            ${directReportsCount > 0 ? `
            <button class="btn-secondary" onclick="expandNode('${id}')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"/>
                </svg>
                ${expandedNodes.has(id) ? 'Collapse' : 'Expand'} Team
            </button>
            ` : ''}
        </div>

        ${directReportsCount > 0 ? `
        <div class="detail-reports-section">
            <h4>Direct Reports (${directReportsCount})</h4>
            <div class="detail-reports-list">
                ${(emp.direct_reports || []).slice(0, 5).map(report => `
                    <div class="detail-report-item" onclick="focusOnEmployee('${report.id}')">
                        <div class="mini-avatar">
                            ${report.profile_photo_url
                                ? `<img src="${report.profile_photo_url}" alt="">`
                                : `<span>${getInitialsFromName(getDisplayName(report))}</span>`
                            }
                        </div>
                        <div class="mini-info">
                            <span class="mini-name">${escapeHtml(getDisplayName(report))}</span>
                            <span class="mini-role">${escapeHtml(report.designation || report.designation_name || '--')}</span>
                        </div>
                    </div>
                `).join('')}
                ${directReportsCount > 5 ? `
                    <div class="more-reports">+${directReportsCount - 5} more</div>
                ` : ''}
            </div>
        </div>
        ` : ''}
    `;

    panel.classList.add('visible');
}

function hideDetailsPanel() {
    const panel = document.getElementById('detailsPanel');
    panel.classList.remove('visible');
    selectedId = null;
    document.querySelectorAll('.tree-row.selected').forEach(row => {
        row.classList.remove('selected');
    });
}

function expandNode(id) {
    if (expandedNodes.has(id)) {
        collapseNodeAndDescendants(id);
    } else {
        expandedNodes.add(id);
    }
    buildVisibleData();
    renderOrgTree();
    // Re-show details to update button text
    showEmployeeDetails(id);
}

function focusOnEmployee(id) {
    // Expand path to employee
    const emp = flatOrgData.find(e => e.id === id);
    if (!emp) return;

    emp.path.forEach(pathId => expandedNodes.add(pathId));
    highlightedId = id;
    selectedId = id;

    buildVisibleData();
    renderOrgTree();
    showEmployeeDetails(id);
}

function setAsRoot(employeeId) {
    expandedNodes.clear();
    highlightedId = null;
    selectedId = null;
    hideDetailsPanel();
    loadOrgChart(employeeId);
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        const treeBody = document.getElementById('treeBody');
        if (!treeBody || document.activeElement.tagName === 'INPUT') return;

        const rows = Array.from(treeBody.querySelectorAll('.tree-row'));
        if (rows.length === 0) return;

        let currentIndex = rows.findIndex(r => r.dataset.id === selectedId);

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (currentIndex < rows.length - 1) {
                    selectNode(rows[currentIndex + 1].dataset.id);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (currentIndex > 0) {
                    selectNode(rows[currentIndex - 1].dataset.id);
                } else if (currentIndex === -1 && rows.length > 0) {
                    selectNode(rows[0].dataset.id);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (selectedId) {
                    const node = flatOrgData.find(n => n.id === selectedId);
                    if (node && node.hasChildren && !expandedNodes.has(selectedId)) {
                        toggleNode(selectedId);
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (selectedId) {
                    const node = flatOrgData.find(n => n.id === selectedId);
                    if (node) {
                        if (expandedNodes.has(selectedId)) {
                            toggleNode(selectedId);
                        } else if (node.parent_id) {
                            selectNode(node.parent_id);
                            focusOnEmployee(node.parent_id);
                        }
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedId) {
                    const node = flatOrgData.find(n => n.id === selectedId);
                    if (node && node.hasChildren) {
                        toggleNode(selectedId);
                    }
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideDetailsPanel();
                break;
        }
    });
}

function getInitialsFromName(name) {
    if (!name) return '--';
    const parts = name.trim().split(' ').filter(p => p);
    if (parts.length === 0) return '--';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return parts[0].charAt(0).toUpperCase() + parts[parts.length - 1].charAt(0).toUpperCase();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
