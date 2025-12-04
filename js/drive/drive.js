// Drive page state
let currentFolderId = null;
let folderStack = []; // For breadcrumb navigation
let contextMenuTarget = null;
let currentShareId = null;
let driveHubConnection = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    if (!api.isAuthenticated()) {
        window.location.href = '/index.html';
        return;
    }

    initializeUser();
    setupEventListeners();
    setupBrowserNavigation();
    await loadDriveContents();
    initializeSignalR();
});

// Handle browser back/forward navigation
function setupBrowserNavigation() {
    // Push initial state
    const initialState = { folderId: currentFolderId };
    history.replaceState(initialState, '', window.location.href);

    // Listen for browser back/forward buttons
    window.addEventListener('popstate', async (event) => {
        if (event.state && event.state.hasOwnProperty('folderId')) {
            currentFolderId = event.state.folderId;
            folderStack = event.state.folderStack || [];
            await loadDriveContents();
        } else {
            // No state, go to root
            currentFolderId = null;
            folderStack = [];
            await loadDriveContents();
        }
    });
}

// SignalR connection for real-time updates
function initializeSignalR() {
    const token = localStorage.getItem('authToken');
    if (!token) {
        console.warn('No auth token found, SignalR connection skipped');
        return;
    }

    driveHubConnection = new signalR.HubConnectionBuilder()
        .withUrl(CONFIG.driveSignalRHubUrl, {
            accessTokenFactory: () => token
        })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.Information)
        .build();

    // Handle file uploaded event
    driveHubConnection.on('FileUploaded', (event) => {
        console.log('SignalR: FileUploaded', event);
        // Refresh if we're in the same folder or root
        if (event.folderId === currentFolderId || (!event.folderId && !currentFolderId)) {
            loadDriveContents();
        }
    });

    // Handle file deleted event
    driveHubConnection.on('FileDeleted', (event) => {
        console.log('SignalR: FileDeleted', event);
        // Refresh if we're in the same folder or root
        if (event.folderId === currentFolderId || (!event.folderId && !currentFolderId)) {
            loadDriveContents();
        }
    });

    // Handle folder created event
    driveHubConnection.on('FolderCreated', (event) => {
        console.log('SignalR: FolderCreated', event);
        // Refresh if we're in the parent folder or root
        if (event.parentFolderId === currentFolderId || (!event.parentFolderId && !currentFolderId)) {
            loadDriveContents();
        }
    });

    // Handle folder deleted event
    driveHubConnection.on('FolderDeleted', (event) => {
        console.log('SignalR: FolderDeleted', event);
        // Refresh if we're in the parent folder or root
        if (event.parentFolderId === currentFolderId || (!event.parentFolderId && !currentFolderId)) {
            loadDriveContents();
        }
    });

    // Handle folder updated event
    driveHubConnection.on('FolderUpdated', (event) => {
        console.log('SignalR: FolderUpdated', event);
        loadDriveContents();
    });

    // Handle storage updated event
    driveHubConnection.on('StorageUpdated', (event) => {
        console.log('SignalR: StorageUpdated', event);
        // Update storage display if needed
        document.getElementById('usedStorage').textContent = formatFileSize(event.totalUsed);
    });

    // Connection event handlers
    driveHubConnection.onclose((error) => {
        console.log('SignalR connection closed', error);
    });

    driveHubConnection.onreconnecting((error) => {
        console.log('SignalR reconnecting...', error);
    });

    driveHubConnection.onreconnected((connectionId) => {
        console.log('SignalR reconnected', connectionId);
    });

    // Start the connection
    driveHubConnection.start()
        .then(() => {
            console.log('SignalR connected to Drive hub');
        })
        .catch((err) => {
            console.error('SignalR connection failed:', err);
        });
}

function initializeUser() {
    const user = api.getUser();
    if (user) {
        const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U';
        document.getElementById('userAvatar').textContent = initials;
        document.getElementById('userDropdownName').textContent = `${user.firstName} ${user.lastName}`;
    }
}

function setupEventListeners() {
    // Drag and drop for file upload
    const dropzone = document.getElementById('uploadDropzone');
    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            handleFileSelect({ target: { files: e.dataTransfer.files } });
        });
    }

    // Close context menu on click outside
    document.addEventListener('click', (e) => {
        const contextMenu = document.getElementById('contextMenu');
        if (!contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });

    // Close user dropdown on click outside
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('userDropdownMenu');
        const avatar = document.getElementById('userAvatar');
        if (!dropdown.contains(e.target) && !avatar.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });
}

// Load drive contents
async function loadDriveContents() {
    showLoading(true);
    try {
        const result = await api.browseDrive(currentFolderId);

        if (result.success) {
            renderDriveContents(result.folders, result.files);
            updateStorageInfo(result.total_size);
            updateBreadcrumb(result.current_folder);
            updateUploadButtonState();
        } else {
            showError(result.message || 'Failed to load drive contents');
            // Don't clear contents on error - keep showing what we had
        }
    } catch (error) {
        console.error('Error loading drive:', error);
        showError(error.message);
        // Don't clear contents on error - keep showing what we had
    } finally {
        showLoading(false);
    }
}

// Refresh current folder contents (exposed for UI refresh button)
async function refreshDriveContents() {
    await loadDriveContents();
}

// Update upload button state based on current folder
function updateUploadButtonState() {
    const uploadBtn = document.querySelector('.drive-actions .btn-primary');
    const noticeContainer = document.getElementById('uploadNotice');

    if (currentFolderId === null) {
        // At root - disable upload, show notice
        if (uploadBtn) {
            uploadBtn.classList.add('disabled');
            uploadBtn.setAttribute('disabled', 'disabled');
            uploadBtn.title = 'Create a folder first to upload files';
        }
        if (noticeContainer) {
            noticeContainer.style.display = 'flex';
        }
    } else {
        // In a folder - enable upload, hide notice
        if (uploadBtn) {
            uploadBtn.classList.remove('disabled');
            uploadBtn.removeAttribute('disabled');
            uploadBtn.title = '';
        }
        if (noticeContainer) {
            noticeContainer.style.display = 'none';
        }
    }
}

function renderDriveContents(folders, files) {
    const container = document.getElementById('driveContents');
    const emptyState = document.getElementById('emptyState');

    container.innerHTML = '';

    if (folders.length === 0 && files.length === 0) {
        emptyState.style.display = 'flex';
        return;
    }

    emptyState.style.display = 'none';

    // Render folders first
    folders.forEach(folder => {
        container.appendChild(createFolderCard(folder));
    });

    // Then render files
    files.forEach(file => {
        container.appendChild(createFileCard(file));
    });
}

function createFolderCard(folder) {
    const card = document.createElement('div');
    card.className = 'drive-item folder';
    card.setAttribute('data-id', folder.folderId);
    card.setAttribute('data-type', 'folder');
    card.setAttribute('data-name', folder.folderName);

    card.innerHTML = `
        <div class="drive-item-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            ${folder.isShared ? '<span class="shared-badge">Shared</span>' : ''}
        </div>
        <div class="drive-item-info">
            <span class="drive-item-name" title="${folder.folderName}">${folder.folderName}</span>
            <span class="drive-item-meta">${folder.fileCount} files, ${formatBytes(folder.totalSize)}</span>
        </div>
        <div class="drive-item-actions">
            <button class="action-btn" onclick="event.stopPropagation(); openFolder('${folder.folderId}', '${escapeHtml(folder.folderName)}')" title="Open">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); shareItem('${folder.folderId}', 'folder', '${escapeHtml(folder.folderName)}')" title="Share">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); renameItem('${folder.folderId}', 'folder', '${escapeHtml(folder.folderName)}')" title="Rename">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
            <button class="action-btn action-btn-danger" onclick="event.stopPropagation(); deleteItem('${folder.folderId}', 'folder', '${escapeHtml(folder.folderName)}')" title="Delete">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `;

    card.addEventListener('dblclick', () => navigateToFolder(folder.folderId, folder.folderName));
    card.addEventListener('contextmenu', (e) => showContextMenu(e, folder, 'folder'));

    return card;
}

function createFileCard(file) {
    const card = document.createElement('div');
    card.className = 'drive-item file';
    card.setAttribute('data-id', file.fileId);
    card.setAttribute('data-type', 'file');
    card.setAttribute('data-name', file.fileName);

    const icon = getFileIcon(file.contentType, file.fileName);

    card.innerHTML = `
        <div class="drive-item-icon">
            ${icon}
            ${file.isShared ? '<span class="shared-badge">Shared</span>' : ''}
        </div>
        <div class="drive-item-info">
            <span class="drive-item-name" title="${file.fileName}">${file.fileName}</span>
            <span class="drive-item-meta">${formatBytes(file.fileSize)}</span>
        </div>
        <div class="drive-item-actions">
            <button class="action-btn" onclick="event.stopPropagation(); downloadFile('${file.fileId}')" title="Download">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); shareItem('${file.fileId}', 'file', '${escapeHtml(file.fileName)}')" title="Share">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); renameItem('${file.fileId}', 'file', '${escapeHtml(file.fileName)}')" title="Rename">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
            </button>
            <button class="action-btn action-btn-danger" onclick="event.stopPropagation(); deleteItem('${file.fileId}', 'file', '${escapeHtml(file.fileName)}')" title="Delete">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>
        </div>
    `;

    card.addEventListener('dblclick', () => downloadFile(file.fileId));
    card.addEventListener('contextmenu', (e) => showContextMenu(e, file, 'file'));

    return card;
}

function getFileIcon(contentType, fileName) {
    const ext = fileName.split('.').pop().toLowerCase();

    // Image
    if (contentType.startsWith('image/')) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
        </svg>`;
    }

    // Video
    if (contentType.startsWith('video/')) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>`;
    }

    // Audio
    if (contentType.startsWith('audio/')) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
        </svg>`;
    }

    // PDF
    if (contentType === 'application/pdf' || ext === 'pdf') {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <text x="7" y="17" font-size="6" fill="#e74c3c" stroke="none">PDF</text>
        </svg>`;
    }

    // Document
    if (['doc', 'docx', 'txt', 'rtf'].includes(ext)) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>`;
    }

    // Spreadsheet
    if (['xls', 'xlsx', 'csv'].includes(ext)) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/>
            <line x1="8" y1="17" x2="16" y2="17"/>
            <line x1="12" y1="9" x2="12" y2="21"/>
        </svg>`;
    }

    // Archive
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f39c12" stroke-width="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>`;
    }

    // Default file icon
    return `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
    </svg>`;
}

// Navigation
function navigateToFolder(folderId, folderName = null, skipHistory = false) {
    if (folderId === null) {
        // Go to root
        currentFolderId = null;
        folderStack = [];
    } else {
        // Save current folder to stack for back navigation
        if (currentFolderId !== null) {
            folderStack.push({ id: currentFolderId });
        }
        currentFolderId = folderId;
    }

    // Push state to browser history (unless navigating via popstate)
    if (!skipHistory) {
        const state = { folderId: currentFolderId, folderStack: [...folderStack] };
        history.pushState(state, '', window.location.href);
    }

    loadDriveContents();
}

function navigateBack() {
    if (folderStack.length > 0) {
        const prev = folderStack.pop();
        currentFolderId = prev.id;
    } else {
        currentFolderId = null;
    }
    loadDriveContents();
}

function updateBreadcrumb(currentFolder) {
    const breadcrumb = document.getElementById('breadcrumb');

    let html = '<span class="breadcrumb-item" onclick="navigateToFolder(null)">My Drive</span>';

    if (currentFolder) {
        html += '<span class="breadcrumb-separator">/</span>';
        html += `<span class="breadcrumb-item active">${currentFolder.folderName}</span>`;
    }

    breadcrumb.innerHTML = html;
}

// Context Menu
function showContextMenu(e, item, type) {
    e.preventDefault();

    contextMenuTarget = { ...item, type };

    const menu = document.getElementById('contextMenu');
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (e.pageY - rect.height) + 'px';
    }
}

async function contextMenuAction(action) {
    document.getElementById('contextMenu').style.display = 'none';

    if (!contextMenuTarget) return;

    const { type } = contextMenuTarget;
    const id = type === 'folder' ? contextMenuTarget.folderId : contextMenuTarget.fileId;
    const name = type === 'folder' ? contextMenuTarget.folderName : contextMenuTarget.fileName;

    switch (action) {
        case 'download':
            if (type === 'file') {
                await downloadFile(id);
            }
            break;
        case 'share':
            showShareModal(id, type, name);
            break;
        case 'rename':
            if (type === 'folder') {
                showEditFolderModal(contextMenuTarget);
            }
            break;
        case 'delete':
            if (confirm(`Are you sure you want to delete "${name}"?`)) {
                if (type === 'folder') {
                    await deleteFolder(id);
                } else {
                    await deleteFile(id);
                }
            }
            break;
    }
}

// Action button helper functions (for mobile-friendly buttons)
function openFolder(folderId, folderName) {
    navigateToFolder(folderId, folderName);
}

function shareItem(itemId, itemType, itemName) {
    showShareModal(itemId, itemType, itemName);
}

function renameItem(itemId, itemType, itemName) {
    if (itemType === 'folder') {
        // Create a folder object for the edit modal
        // Note: description will be empty since we don't have it in the card
        showEditFolderModal({ folderId: itemId, folderName: itemName, description: '' });
    } else {
        // For files, we'll show a simple rename prompt for now
        showRenameFileModal(itemId, itemName);
    }
}

function deleteItem(itemId, itemType, itemName) {
    if (confirm(`Are you sure you want to delete "${itemName}"?`)) {
        if (itemType === 'folder') {
            deleteFolder(itemId);
        } else {
            deleteFile(itemId);
        }
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// File rename modal
function showRenameFileModal(fileId, fileName) {
    document.getElementById('renameFileId').value = fileId;
    document.getElementById('renameFileName').value = fileName;
    showModal('renameFileModal');
}

async function handleRenameFile(e) {
    e.preventDefault();

    const fileId = document.getElementById('renameFileId').value;
    const newName = document.getElementById('renameFileName').value.trim();

    if (!newName) {
        showError('File name is required');
        return;
    }

    try {
        const result = await api.renameFile(fileId, newName);
        if (result.success) {
            showSuccess('File renamed successfully');
            closeModal('renameFileModal');
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to rename file');
        }
    } catch (error) {
        console.error('Error renaming file:', error);
        showError(error.message);
    }
}

// File operations
async function downloadFile(fileId) {
    try {
        const result = await api.getDownloadUrl(fileId);
        if (result.success) {
            window.open(result.url, '_blank');
        } else {
            showError(result.message || 'Failed to get download URL');
        }
    } catch (error) {
        console.error('Error downloading file:', error);
        showError(error.message);
    }
}

async function deleteFile(fileId) {
    try {
        const result = await api.deleteFile(fileId);
        if (result.success) {
            showSuccess('File deleted successfully');
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to delete file');
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        showError(error.message);
    }
}

// Folder operations
async function deleteFolder(folderId) {
    try {
        const result = await api.deleteFolder(folderId, true);
        if (result.success) {
            showSuccess(`Folder deleted (${result.files_deleted} files, ${result.folders_deleted} folders)`);
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to delete folder');
        }
    } catch (error) {
        console.error('Error deleting folder:', error);
        showError(error.message);
    }
}

// Modals
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function showCreateFolderModal() {
    document.getElementById('folderName').value = '';
    document.getElementById('folderDescription').value = '';
    showModal('createFolderModal');
}

async function handleCreateFolder(e) {
    e.preventDefault();

    const name = document.getElementById('folderName').value.trim();
    const description = document.getElementById('folderDescription').value.trim();

    if (!name) {
        showError('Folder name is required');
        return;
    }

    try {
        const result = await api.createFolder(name, description || null, currentFolderId);
        if (result.success) {
            showSuccess('Folder created successfully');
            closeModal('createFolderModal');
            await loadDriveContents();
        } else {
            showError(result.message || 'Failed to create folder');
            // Don't close modal on error - let user retry or cancel
        }
    } catch (error) {
        console.error('Error creating folder:', error);
        showError(error.message);
        // Don't close modal on error - let user retry or cancel
    }
}

function showEditFolderModal(folder) {
    document.getElementById('editFolderId').value = folder.folderId;
    document.getElementById('editFolderName').value = folder.folderName;
    document.getElementById('editFolderDescription').value = folder.description || '';
    showModal('editFolderModal');
}

async function handleUpdateFolder(e) {
    e.preventDefault();

    const folderId = document.getElementById('editFolderId').value;
    const name = document.getElementById('editFolderName').value.trim();
    const description = document.getElementById('editFolderDescription').value.trim();

    if (!name) {
        showError('Folder name is required');
        return;
    }

    try {
        const result = await api.updateFolder(folderId, name, description || null);
        if (result.success) {
            showSuccess('Folder updated successfully');
            closeModal('editFolderModal');
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to update folder');
        }
    } catch (error) {
        console.error('Error updating folder:', error);
        showError(error.message);
    }
}

// Upload
function showUploadModal() {
    // Enforce folder-first upload rule
    if (currentFolderId === null) {
        showError('Please create or open a folder before uploading files. Files cannot be uploaded to the root directory.');
        return;
    }

    document.getElementById('uploadQueue').style.display = 'none';
    document.getElementById('uploadQueueList').innerHTML = '';
    showModal('uploadModal');
}

function closeUploadModal() {
    closeModal('uploadModal');
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Check file sizes before proceeding
    const oversizedFiles = files.filter(f => f.size > MAX_FILE_SIZE);
    if (oversizedFiles.length > 0) {
        const names = oversizedFiles.map(f => `${f.name} (${formatBytes(f.size)})`).join(', ');
        showError(`The following files exceed the 5GB limit: ${names}`);
        // Filter out oversized files
        const validFiles = files.filter(f => f.size <= MAX_FILE_SIZE);
        if (validFiles.length === 0) {
            document.getElementById('fileInput').value = '';
            return;
        }
        // Continue with valid files only
        files.length = 0;
        files.push(...validFiles);
    }

    const queue = document.getElementById('uploadQueue');
    const queueList = document.getElementById('uploadQueueList');

    queue.style.display = 'block';

    for (const file of files) {
        const item = createUploadQueueItem(file);
        queueList.appendChild(item);
        await uploadFile(file, item);
    }

    // Reset file input
    document.getElementById('fileInput').value = '';

    // Auto-close modal after 3 seconds if all uploads complete
    const allComplete = Array.from(queueList.querySelectorAll('.upload-item')).every(
        item => item.classList.contains('complete') || item.classList.contains('error')
    );
    if (allComplete) {
        setTimeout(() => {
            closeUploadModal();
        }, 3000);
    }
}

function createUploadQueueItem(file) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `
        <div class="upload-item-info">
            <span class="upload-item-name">${file.name}</span>
            <span class="upload-item-size">${formatBytes(file.size)}</span>
        </div>
        <div class="upload-item-progress">
            <div class="progress-bar" style="width: 0%"></div>
        </div>
        <span class="upload-item-status">Waiting...</span>
    `;
    return item;
}

// Constants for chunked upload
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks - matches backend
const CHUNKED_UPLOAD_THRESHOLD = 50 * 1024 * 1024; // Use chunked upload for files > 50MB
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB max file size - matches backend

async function uploadFile(file, queueItem) {
    const progressBar = queueItem.querySelector('.progress-bar');
    const status = queueItem.querySelector('.upload-item-status');

    try {
        // Use chunked upload for large files to avoid timeouts
        if (file.size > CHUNKED_UPLOAD_THRESHOLD) {
            await uploadFileChunked(file, queueItem);
        } else {
            await uploadFileSimple(file, queueItem);
        }

        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#27ae60';
        status.textContent = 'Complete';
        queueItem.classList.add('complete');

        // Refresh drive contents
        loadDriveContents();

    } catch (error) {
        console.error('Upload error:', error);
        progressBar.style.backgroundColor = '#e74c3c';
        status.textContent = 'Failed: ' + error.message;
        queueItem.classList.add('error');
    }
}

// Simple upload for small files (< 50MB)
async function uploadFileSimple(file, queueItem) {
    const progressBar = queueItem.querySelector('.progress-bar');
    const status = queueItem.querySelector('.upload-item-status');

    status.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('file', file);
    if (currentFolderId) {
        formData.append('folderId', currentFolderId);
    }

    const xhr = new XMLHttpRequest();

    await new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                progressBar.style.width = progress + '%';
                status.textContent = `Uploading... ${progress}%`;
            }
        });

        xhr.addEventListener('load', () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const result = JSON.parse(xhr.responseText);
                    if (result.success) {
                        resolve(result);
                    } else {
                        reject(new Error(result.message || 'Upload failed'));
                    }
                } catch (e) {
                    reject(new Error('Invalid response from server'));
                }
            } else {
                try {
                    const error = JSON.parse(xhr.responseText);
                    reject(new Error(error.message || 'Upload failed'));
                } catch (e) {
                    reject(new Error('Upload failed with status ' + xhr.status));
                }
            }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));

        xhr.open('POST', `${CONFIG.endpoints.drive}/api/drive/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('authToken')}`);
        xhr.send(formData);
    });
}

// Chunked upload for large files (> 50MB) - handles up to 5GB without timeout
async function uploadFileChunked(file, queueItem) {
    const progressBar = queueItem.querySelector('.progress-bar');
    const status = queueItem.querySelector('.upload-item-status');

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Step 1: Initiate chunked upload
    status.textContent = 'Initiating upload...';
    const initResponse = await fetch(`${CONFIG.endpoints.drive}/api/drive/chunked/initiate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            folderId: currentFolderId,
            totalSize: file.size,
            totalChunks: totalChunks
        })
    });

    const initResult = await initResponse.json();
    if (!initResult.success) {
        throw new Error(initResult.message || 'Failed to initiate upload');
    }

    const sessionId = initResult.upload_session_id;

    // Step 2: Upload chunks one by one
    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        const start = (chunkNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const overallProgress = Math.round(((chunkNumber - 1) / totalChunks) * 100);
        status.textContent = `Uploading chunk ${chunkNumber}/${totalChunks}... ${overallProgress}%`;
        progressBar.style.width = overallProgress + '%';

        // Upload this chunk
        const chunkFormData = new FormData();
        chunkFormData.append('chunk', chunk, file.name);

        const chunkResponse = await fetch(
            `${CONFIG.endpoints.drive}/api/drive/chunked/upload/${sessionId}/${chunkNumber}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
                },
                body: chunkFormData
            }
        );

        const chunkResult = await chunkResponse.json();
        if (!chunkResult.success) {
            // Abort the upload session on failure
            await fetch(`${CONFIG.endpoints.drive}/api/drive/chunked/abort/${sessionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            throw new Error(chunkResult.message || `Failed to upload chunk ${chunkNumber}`);
        }

        // Update progress after successful chunk upload
        const newProgress = Math.round((chunkNumber / totalChunks) * 95); // Leave 5% for completion
        progressBar.style.width = newProgress + '%';
    }

    // Step 3: Complete the upload
    status.textContent = 'Finalizing upload...';
    progressBar.style.width = '95%';

    const completeResponse = await fetch(
        `${CONFIG.endpoints.drive}/api/drive/chunked/complete/${sessionId}`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        }
    );

    const completeResult = await completeResponse.json();
    if (!completeResult.success) {
        throw new Error(completeResult.message || 'Failed to complete upload');
    }

    progressBar.style.width = '100%';
    status.textContent = 'Complete';
}

// Sharing
function showShareModal(itemId, itemType, itemName) {
    document.getElementById('shareItemId').value = itemId;
    document.getElementById('shareItemType').value = itemType;
    document.getElementById('shareForm').style.display = 'block';
    document.getElementById('shareExistingLink').style.display = 'none';
    currentShareId = null;

    // Reset form
    document.getElementById('shareAccessType').value = 'download';
    document.getElementById('shareExpiry').value = '0';
    document.getElementById('sharePassword').value = '';
    document.getElementById('shareMaxDownloads').value = '0';

    showModal('shareModal');
}

async function handleCreateShare(e) {
    e.preventDefault();

    const itemId = document.getElementById('shareItemId').value;
    const itemType = document.getElementById('shareItemType').value;
    const accessType = document.getElementById('shareAccessType').value;
    const expiryHours = parseInt(document.getElementById('shareExpiry').value);
    const password = document.getElementById('sharePassword').value || null;
    const maxDownloads = parseInt(document.getElementById('shareMaxDownloads').value);

    try {
        const result = await api.createShareLink(itemId, itemType, accessType, expiryHours, password, true, maxDownloads);

        if (result.success) {
            // Show the created link
            currentShareId = result.share_id;
            document.getElementById('existingShareUrl').value = result.share_url;
            document.getElementById('shareForm').style.display = 'none';
            document.getElementById('shareExistingLink').style.display = 'block';

            showSuccess('Share link created');
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to create share link');
        }
    } catch (error) {
        console.error('Error creating share:', error);
        showError(error.message);
    }
}

function copyShareLink() {
    const url = document.getElementById('existingShareUrl').value;
    navigator.clipboard.writeText(url).then(() => {
        showSuccess('Link copied to clipboard');
    }).catch(() => {
        showError('Failed to copy link');
    });
}

async function revokeCurrentShare() {
    if (!currentShareId) return;

    if (!confirm('Are you sure you want to revoke this share link?')) return;

    try {
        const result = await api.revokeShareLink(currentShareId);
        if (result.success) {
            showSuccess('Share link revoked');
            closeModal('shareModal');
            loadDriveContents();
        } else {
            showError(result.message || 'Failed to revoke share link');
        }
    } catch (error) {
        console.error('Error revoking share:', error);
        showError(error.message);
    }
}

// Utilities
function formatBytes(bytes) {
    if (bytes === 0) return '0 bytes';
    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateStorageInfo(totalSize) {
    document.getElementById('usedStorage').textContent = formatBytes(totalSize);
}

function showLoading(show) {
    const loadingState = document.getElementById('loadingState');
    const driveContents = document.getElementById('driveContents');

    if (show) {
        loadingState.style.display = 'flex';
        // Only hide contents if there's nothing to show (first load)
        if (driveContents.children.length === 0) {
            driveContents.style.display = 'none';
        } else {
            // Keep contents visible but dimmed during refresh
            driveContents.style.opacity = '0.5';
            driveContents.style.pointerEvents = 'none';
        }
    } else {
        loadingState.style.display = 'none';
        driveContents.style.display = 'grid';
        driveContents.style.opacity = '1';
        driveContents.style.pointerEvents = 'auto';
    }
}

function showError(message) {
    alert('Error: ' + message);
}

function showSuccess(message) {
    // Simple alert for now, can be replaced with toast notification
    console.log('Success:', message);
}

function toggleUserDropdown() {
    const dropdown = document.getElementById('userDropdownMenu');
    dropdown.classList.toggle('show');
}
