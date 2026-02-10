/**
 * TABLE → CARD MOBILE LABELS
 * ===========================
 * Universal utility that auto-applies data-label attributes to .data-table
 * cells by reading column headers from <thead>. Uses MutationObserver so
 * it works automatically — zero changes needed in page-specific JS files.
 *
 * Also marks the last <td> in action-heavy tables with a .tc-actions class
 * when the header contains "Actions" or similar keywords.
 *
 * Usage: Include this script on any page that uses .data-table markup.
 * Pair with table-cards.css for the mobile card layout.
 */

(function () {
    'use strict';

    const ACTION_KEYWORDS = ['actions', 'action', ''];

    /**
     * Apply data-label attributes to all <td> cells in a table's <tbody>,
     * reading labels from the corresponding <thead> <th> elements.
     */
    function applyCardLabels(table) {
        if (!table) return;
        const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        if (headers.length === 0) return;

        table.querySelectorAll('tbody tr:not(.empty-state):not(.empty-row):not(.ess-empty-state)').forEach(row => {
            const cells = row.querySelectorAll('td');
            cells.forEach((td, i) => {
                if (headers[i]) {
                    td.setAttribute('data-label', headers[i]);
                }
                // Mark last cell as actions if header says so
                if (i === cells.length - 1 && headers[i] && ACTION_KEYWORDS.includes(headers[i].toLowerCase())) {
                    td.classList.add('tc-actions');
                }
            });
        });
    }

    /**
     * Process all .data-table elements currently in the DOM.
     */
    function processAllTables() {
        document.querySelectorAll('.data-table').forEach(applyCardLabels);
    }

    /**
     * Set up a MutationObserver on a single table's <tbody> (or the table
     * itself if tbody doesn't exist yet) to re-apply labels whenever
     * rows change.
     */
    function observeTable(table) {
        if (table._tcObserver) return; // Already observed

        const callback = () => applyCardLabels(table);

        const observer = new MutationObserver(callback);

        // Observe tbody if it exists, otherwise observe the table itself
        const target = table.querySelector('tbody') || table;
        observer.observe(target, { childList: true, subtree: true });

        table._tcObserver = observer;
    }

    /**
     * Observe all current .data-table elements and watch for new ones
     * added to the DOM (e.g., reports.js builds tables dynamically).
     */
    function init() {
        // Process existing tables
        document.querySelectorAll('.data-table').forEach(table => {
            applyCardLabels(table);
            observeTable(table);
        });

        // Watch for new .data-table elements added to the DOM
        const bodyObserver = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;

                    // Check if the added node is a .data-table
                    if (node.classList && node.classList.contains('data-table')) {
                        applyCardLabels(node);
                        observeTable(node);
                    }

                    // Check descendants
                    if (node.querySelectorAll) {
                        node.querySelectorAll('.data-table').forEach(table => {
                            applyCardLabels(table);
                            observeTable(table);
                        });
                    }
                }
            }
        });

        bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose for manual use if needed
    window.applyCardLabels = applyCardLabels;
})();
