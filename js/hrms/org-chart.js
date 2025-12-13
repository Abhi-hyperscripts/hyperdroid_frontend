/**
 * HRMS Organization Chart Page
 */

let orgData = null;
let flatOrgData = []; // Flattened version for search
let expandedNodes = new Set();
let searchTimeout = null;
let highlightedId = null;

document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    if (typeof Navigation !== 'undefined') Navigation.init();
    await loadOrgChart();
});

async function loadOrgChart(rootEmployeeId = null) {
    const container = document.getElementById('orgTree');

    try {
        orgData = await api.getOrgChart(rootEmployeeId);
        // Flatten the hierarchical data for search functionality
        flatOrgData = flattenOrgData(orgData);
        renderOrgChart();
    } catch (error) {
        console.error('Error loading org chart:', error);
        container.innerHTML = '<div class="ess-error-state"><p>Failed to load organization chart</p></div>';
    }
}

function renderOrgChart() {
    const container = document.getElementById('orgTree');

    if (!orgData || orgData.length === 0) {
        container.innerHTML = `
            <div class="ess-empty-state">
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

    // API returns hierarchical data with direct_reports, use it directly
    const tree = normalizeTree(orgData);
    container.innerHTML = renderTree(tree);
}

// Normalize the API response to use 'children' instead of 'direct_reports'
function normalizeTree(nodes) {
    if (!nodes || !Array.isArray(nodes)) return [];
    return nodes.map(node => ({
        ...node,
        children: normalizeTree(node.direct_reports || [])
    }));
}

// Flatten hierarchical data for search functionality
function flattenOrgData(nodes, parentId = null) {
    if (!nodes || !Array.isArray(nodes)) return [];
    let result = [];
    nodes.forEach(node => {
        result.push({ ...node, parent_id: parentId });
        if (node.direct_reports && node.direct_reports.length > 0) {
            result = result.concat(flattenOrgData(node.direct_reports, node.id));
        }
    });
    return result;
}

function renderTree(nodes, level = 0) {
    if (!nodes || nodes.length === 0) return '';

    return nodes.map(node => {
        const hasChildren = node.children && node.children.length > 0;
        const isExpanded = expandedNodes.has(node.id);
        const isHighlighted = node.id === highlightedId;
        // Handle both flat and hierarchical API responses - fall back to employee_code if name is empty
        const displayName = node.name || `${node.first_name || ''} ${node.last_name || ''}`.trim() || node.employee_code || 'Unknown';
        const designation = node.designation || node.designation_name || '--';

        return `
            <div class="org-node" data-id="${node.id}">
                <div class="org-card ${isHighlighted ? 'highlighted' : ''}" onclick="showEmployeeDetails('${node.id}')">
                    <div class="org-card-avatar">
                        ${node.profile_photo_url
                            ? `<img src="${node.profile_photo_url}" alt="${displayName}">`
                            : getInitialsFromName(displayName)
                        }
                    </div>
                    <h4>${escapeHtml(displayName)}</h4>
                    <p>${escapeHtml(designation)}</p>
                    ${hasChildren ? `
                        <button class="org-toggle" onclick="event.stopPropagation(); toggleNode('${node.id}')">
                            ${isExpanded ? '−' : '+'} ${node.children.length}
                        </button>
                    ` : ''}
                </div>
                ${hasChildren && isExpanded ? `
                    <div class="org-children">
                        ${renderTree(node.children, level + 1)}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function toggleNode(id) {
    if (expandedNodes.has(id)) {
        expandedNodes.delete(id);
    } else {
        expandedNodes.add(id);
    }
    renderOrgChart();
}

function expandAll() {
    if (!flatOrgData || flatOrgData.length === 0) return;
    flatOrgData.forEach(emp => expandedNodes.add(emp.id));
    renderOrgChart();
}

function collapseAll() {
    expandedNodes.clear();
    renderOrgChart();
}

function resetChart() {
    highlightedId = null;
    document.getElementById('searchInput').value = '';
    loadOrgChart();
}

function debounceSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchEmployee(), 300);
}

function searchEmployee() {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!query || !flatOrgData || flatOrgData.length === 0) {
        highlightedId = null;
        renderOrgChart();
        return;
    }

    // Search in flattened data
    const found = flatOrgData.find(emp => {
        const name = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code || '';
        return name.toLowerCase().includes(query) ||
            (emp.employee_code || '').toLowerCase().includes(query);
    });

    if (found) {
        highlightedId = found.id;

        // Expand path to found employee
        expandPathToEmployee(found.id);
        renderOrgChart();

        // Scroll to the node
        setTimeout(() => {
            const node = document.querySelector(`[data-id="${found.id}"] .org-card`);
            if (node) {
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 100);
    }
}

function expandPathToEmployee(employeeId) {
    if (!flatOrgData || flatOrgData.length === 0) return;

    const emp = flatOrgData.find(e => e.id === employeeId);
    if (!emp) return;

    // Expand all ancestors using parent_id from flattened data
    let currentId = emp.parent_id;
    while (currentId) {
        expandedNodes.add(currentId);
        const parent = flatOrgData.find(e => e.id === currentId);
        currentId = parent ? parent.parent_id : null;
    }
}

function showEmployeeDetails(id) {
    const emp = flatOrgData.find(e => e.id === id);
    if (!emp) return;

    // Count direct reports from the hierarchical data
    const directReportsCount = (emp.direct_reports || []).length;
    // Handle both API field names - fall back to employee_code if name is empty
    const displayName = emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || emp.employee_code || 'Unknown';
    const designation = emp.designation || emp.designation_name || '--';
    const department = emp.department || emp.department_name || '--';

    // Find manager name from flattened data
    let managerName = '';
    if (emp.parent_id) {
        const manager = flatOrgData.find(e => e.id === emp.parent_id);
        if (manager) {
            managerName = manager.name || `${manager.first_name || ''} ${manager.last_name || ''}`.trim() || manager.employee_code || '';
        }
    }

    const container = document.getElementById('employeeDetails');
    container.innerHTML = `
        <div class="employee-detail-header">
            <div class="employee-detail-avatar">
                ${emp.profile_photo_url
                    ? `<img src="${emp.profile_photo_url}" alt="${displayName}">`
                    : `<span>${getInitialsFromName(displayName)}</span>`
                }
            </div>
            <div class="employee-detail-info">
                <h2>${escapeHtml(displayName)}</h2>
                <p class="employee-code">${emp.employee_code || ''}</p>
            </div>
        </div>
        <div class="employee-detail-body">
            <div class="detail-row">
                <span class="detail-label">Designation</span>
                <span class="detail-value">${escapeHtml(designation)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Department</span>
                <span class="detail-value">${escapeHtml(department)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Office</span>
                <span class="detail-value">${escapeHtml(emp.office_name || emp.office || '--')}</span>
            </div>
            ${managerName ? `
            <div class="detail-row">
                <span class="detail-label">Reports To</span>
                <span class="detail-value">${escapeHtml(managerName)}</span>
            </div>` : ''}
            ${directReportsCount > 0 ? `
            <div class="detail-row">
                <span class="detail-label">Direct Reports</span>
                <span class="detail-value">${directReportsCount} employee${directReportsCount !== 1 ? 's' : ''}</span>
            </div>` : ''}
        </div>
        <div class="employee-detail-actions">
            <button class="btn-secondary" onclick="setAsRoot('${id}')">View as Root</button>
        </div>
    `;

    document.getElementById('employeeModal').style.display = 'flex';
}

function setAsRoot(employeeId) {
    closeModal();
    expandedNodes.clear();
    loadOrgChart(employeeId);
}

function closeModal() {
    document.getElementById('employeeModal').style.display = 'none';
}

function getInitials(firstName, lastName) {
    const first = firstName ? firstName.charAt(0).toUpperCase() : '';
    const last = lastName ? lastName.charAt(0).toUpperCase() : '';
    return first + last || '--';
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
