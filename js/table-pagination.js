/**
 * TablePagination - A reusable pagination utility for tables
 *
 * Usage:
 *   const pagination = new TablePagination({
 *     containerSelector: '#myTablePagination',
 *     data: myDataArray,
 *     rowsPerPage: 25,
 *     rowsPerPageOptions: [10, 25, 50, 100],
 *     onPageChange: (paginatedData, pageInfo) => {
 *       renderTable(paginatedData);
 *     }
 *   });
 *
 *   // Update data when filters change:
 *   pagination.setData(newFilteredData);
 *
 *   // Reset to first page:
 *   pagination.goToPage(1);
 */

class TablePagination {
    constructor(options = {}) {
        this.container = typeof options.containerSelector === 'string'
            ? document.querySelector(options.containerSelector)
            : options.containerSelector;

        if (!this.container) {
            console.warn('TablePagination: Container not found');
            return;
        }

        this.data = options.data || [];
        this.rowsPerPage = options.rowsPerPage || 25;
        this.rowsPerPageOptions = options.rowsPerPageOptions || [10, 25, 50, 100];
        this.currentPage = 1;
        this.onPageChange = options.onPageChange || (() => {});
        this.showInfo = options.showInfo !== false;
        this.showRowsPerPage = options.showRowsPerPage !== false;
        this.maxVisiblePages = options.maxVisiblePages || 5;
        this.labels = {
            showing: options.labels?.showing || 'Showing',
            of: options.labels?.of || 'of',
            records: options.labels?.records || 'records',
            rowsPerPage: options.labels?.rowsPerPage || 'Rows per page:',
            noRecords: options.labels?.noRecords || 'No records found',
            ...options.labels
        };

        this.render();
        this.triggerPageChange();
    }

    get totalPages() {
        return Math.ceil(this.data.length / this.rowsPerPage);
    }

    get startIndex() {
        return (this.currentPage - 1) * this.rowsPerPage;
    }

    get endIndex() {
        return Math.min(this.startIndex + this.rowsPerPage, this.data.length);
    }

    get paginatedData() {
        return this.data.slice(this.startIndex, this.endIndex);
    }

    get pageInfo() {
        return {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            totalRecords: this.data.length,
            startIndex: this.startIndex,
            endIndex: this.endIndex,
            rowsPerPage: this.rowsPerPage,
            displayStart: this.data.length > 0 ? this.startIndex + 1 : 0,
            displayEnd: this.endIndex
        };
    }

    render() {
        this.container.innerHTML = `
            <div class="table-pagination">
                <div class="pagination-left">
                    ${this.showInfo ? '<div class="pagination-info"></div>' : ''}
                </div>
                <div class="pagination-center">
                    <div class="pagination-controls">
                        <button class="pagination-btn pagination-prev" title="Previous page">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="15 18 9 12 15 6"></polyline>
                            </svg>
                        </button>
                        <div class="pagination-pages"></div>
                        <button class="pagination-btn pagination-next" title="Next page">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="9 18 15 12 9 6"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="pagination-right">
                    ${this.showRowsPerPage ? `
                        <div class="pagination-rows-per-page">
                            <span class="pagination-label">${this.labels.rowsPerPage}</span>
                            <select class="pagination-select">
                                ${this.rowsPerPageOptions.map(opt =>
                                    `<option value="${opt}"${opt === this.rowsPerPage ? ' selected' : ''}>${opt}</option>`
                                ).join('')}
                            </select>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        const prevBtn = this.container.querySelector('.pagination-prev');
        const nextBtn = this.container.querySelector('.pagination-next');
        const select = this.container.querySelector('.pagination-select');
        const pagesContainer = this.container.querySelector('.pagination-pages');

        prevBtn?.addEventListener('click', () => this.prevPage());
        nextBtn?.addEventListener('click', () => this.nextPage());

        select?.addEventListener('change', (e) => {
            this.rowsPerPage = parseInt(e.target.value, 10);
            this.currentPage = 1;
            this.updateUI();
            this.triggerPageChange();
        });

        pagesContainer?.addEventListener('click', (e) => {
            const pageBtn = e.target.closest('.pagination-page');
            if (pageBtn && !pageBtn.classList.contains('pagination-ellipsis')) {
                const page = parseInt(pageBtn.dataset.page, 10);
                if (!isNaN(page)) {
                    this.goToPage(page);
                }
            }
        });
    }

    updateUI() {
        // Update info text
        const infoEl = this.container.querySelector('.pagination-info');
        if (infoEl) {
            if (this.data.length === 0) {
                infoEl.textContent = this.labels.noRecords;
            } else {
                infoEl.textContent = `${this.labels.showing} ${this.pageInfo.displayStart}-${this.pageInfo.displayEnd} ${this.labels.of} ${this.data.length} ${this.labels.records}`;
            }
        }

        // Update page buttons
        const pagesContainer = this.container.querySelector('.pagination-pages');
        if (pagesContainer) {
            pagesContainer.innerHTML = this.generatePageButtons();
        }

        // Update prev/next button states
        const prevBtn = this.container.querySelector('.pagination-prev');
        const nextBtn = this.container.querySelector('.pagination-next');

        if (prevBtn) {
            prevBtn.disabled = this.currentPage <= 1;
            prevBtn.classList.toggle('disabled', this.currentPage <= 1);
        }
        if (nextBtn) {
            nextBtn.disabled = this.currentPage >= this.totalPages;
            nextBtn.classList.toggle('disabled', this.currentPage >= this.totalPages);
        }

        // Show/hide pagination if only one page
        const paginationEl = this.container.querySelector('.table-pagination');
        if (paginationEl) {
            paginationEl.classList.toggle('pagination-hidden', this.totalPages <= 1 && this.data.length <= this.rowsPerPageOptions[0]);
        }
    }

    generatePageButtons() {
        const total = this.totalPages;
        const current = this.currentPage;
        const maxVisible = this.maxVisiblePages;

        if (total <= maxVisible + 2) {
            // Show all pages
            return Array.from({ length: total }, (_, i) => this.createPageButton(i + 1)).join('');
        }

        const pages = [];

        // Always show first page
        pages.push(this.createPageButton(1));

        // Calculate range around current page
        let startPage = Math.max(2, current - Math.floor(maxVisible / 2));
        let endPage = Math.min(total - 1, startPage + maxVisible - 1);

        // Adjust if near the end
        if (endPage === total - 1) {
            startPage = Math.max(2, endPage - maxVisible + 1);
        }

        // Add ellipsis before if needed
        if (startPage > 2) {
            pages.push('<span class="pagination-page pagination-ellipsis">...</span>');
        }

        // Add middle pages
        for (let i = startPage; i <= endPage; i++) {
            pages.push(this.createPageButton(i));
        }

        // Add ellipsis after if needed
        if (endPage < total - 1) {
            pages.push('<span class="pagination-page pagination-ellipsis">...</span>');
        }

        // Always show last page
        if (total > 1) {
            pages.push(this.createPageButton(total));
        }

        return pages.join('');
    }

    createPageButton(page) {
        const isActive = page === this.currentPage;
        return `<button class="pagination-page${isActive ? ' active' : ''}" data-page="${page}">${page}</button>`;
    }

    triggerPageChange() {
        this.onPageChange(this.paginatedData, this.pageInfo);
    }

    goToPage(page) {
        const newPage = Math.max(1, Math.min(page, this.totalPages));
        if (newPage !== this.currentPage) {
            this.currentPage = newPage;
            this.updateUI();
            this.triggerPageChange();
        }
    }

    nextPage() {
        this.goToPage(this.currentPage + 1);
    }

    prevPage() {
        this.goToPage(this.currentPage - 1);
    }

    setData(data, resetPage = true) {
        this.data = data || [];
        if (resetPage) {
            this.currentPage = 1;
        } else {
            // Ensure current page is still valid
            this.currentPage = Math.min(this.currentPage, Math.max(1, this.totalPages));
        }
        this.updateUI();
        this.triggerPageChange();
    }

    setRowsPerPage(rowsPerPage) {
        this.rowsPerPage = rowsPerPage;
        this.currentPage = 1;

        // Update select if exists
        const select = this.container.querySelector('.pagination-select');
        if (select) {
            select.value = rowsPerPage;
        }

        this.updateUI();
        this.triggerPageChange();
    }

    refresh() {
        this.updateUI();
        this.triggerPageChange();
    }

    destroy() {
        this.container.innerHTML = '';
    }
}

// Store for pagination instances
const paginationInstances = new Map();

/**
 * Helper function to create or get a pagination instance
 */
function createTablePagination(id, options) {
    // Destroy existing instance if any
    if (paginationInstances.has(id)) {
        paginationInstances.get(id).destroy();
    }

    const instance = new TablePagination(options);
    paginationInstances.set(id, instance);
    return instance;
}

/**
 * Get an existing pagination instance
 */
function getTablePagination(id) {
    return paginationInstances.get(id);
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TablePagination, createTablePagination, getTablePagination };
}

// Make available globally
window.TablePagination = TablePagination;
window.createTablePagination = createTablePagination;
window.getTablePagination = getTablePagination;
