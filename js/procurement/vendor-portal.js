/**
 * Vendor Portal - Public Page
 * No authentication required. Accessed via token URL parameter.
 * Allows vendors to view RFQ details and submit quotes.
 */

// ==================== State ====================
let portalToken = null;
let rfqData = null;
let rfqItems = [];

// ==================== Initialization ====================

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    portalToken = params.get('token');

    if (!portalToken) {
        showError('No access token provided. Please use the link sent to your email.');
        return;
    }

    loadRFQData();
});

// ==================== Data Loading ====================

async function loadRFQData() {
    showLoading();

    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-portal/access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: portalToken })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Invalid or expired link');
        }

        const data = await response.json();
        rfqData = data.data || data;
        rfqItems = rfqData.items || [];

        renderRFQData();
        showMainContent();
    } catch (error) {
        console.error('Failed to load RFQ data:', error);
        showError(error.message || 'Failed to load RFQ details. This link may be invalid or expired.');
    }
}

// ==================== Rendering ====================

function renderRFQData() {
    if (!rfqData) return;

    // Hero card
    document.getElementById('rfqTitle').textContent = rfqData.inquiry_title || rfqData.title || 'Request for Quotation';
    document.getElementById('vendorLabel').textContent = rfqData.vendor_name ? `For ${rfqData.vendor_name}` : (rfqData.buyer_name || rfqData.organization_name || '');

    // Status badge
    const badgeEl = document.getElementById('statusBadge');
    const status = rfqData.quote_status || rfqData.status || 'open';
    if (status === 'submitted') {
        badgeEl.className = 'vp-badge vp-badge-submitted';
        badgeEl.textContent = 'Submitted';
    } else if (status === 'closed' || status === 'cancelled') {
        badgeEl.className = 'vp-badge vp-badge-closed';
        badgeEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    } else {
        badgeEl.className = 'vp-badge vp-badge-open';
        badgeEl.textContent = 'Open';
    }

    // Stat pills
    document.getElementById('rfqNumberPill').textContent = rfqData.rfq_number || rfqData.inquiry_number || 'RFQ';
    document.getElementById('rfqDeadlinePill').textContent = rfqData.due_date ? `Due: ${formatDate(rfqData.due_date)}` : 'No deadline';
    document.getElementById('rfqItemsPill').textContent = `${rfqItems.length} item${rfqItems.length !== 1 ? 's' : ''}`;

    // Notes
    if (rfqData.notes) {
        document.getElementById('rfqNotes').style.display = 'block';
        document.getElementById('rfqNotesText').textContent = rfqData.notes;
    }

    renderItems();
}

function renderItems() {
    const desktopContainer = document.getElementById('rfqItemsDesktop');
    const mobileContainer = document.getElementById('rfqItemsMobile');

    if (!rfqItems || rfqItems.length === 0) {
        const emptyHtml = '<div style="text-align: center; padding: 32px; color: var(--text-secondary, #94a3b8); font-size: 0.85rem;">No items in this RFQ</div>';
        desktopContainer.innerHTML = emptyHtml;
        mobileContainer.innerHTML = emptyHtml;
        return;
    }

    // Desktop rows
    desktopContainer.innerHTML = rfqItems.map((item, index) => `
        <div class="vp-item-row">
            <div class="vp-item-info">
                <div class="vp-item-name">${escapeHtml(item.item_name || '')}</div>
                ${item.description ? `<div class="vp-item-desc">${escapeHtml(item.description)}</div>` : ''}
            </div>
            <div class="vp-item-qty">${item.quantity || 0}</div>
            <div class="vp-item-unit">${escapeHtml(item.unit || '-')}</div>
            <div class="vp-item-price">
                <input type="number"
                    id="price_${index}"
                    data-item-id="${item.rfq_item_id || item.id}"
                    min="0"
                    step="0.01"
                    placeholder="0.00">
            </div>
        </div>
    `).join('');

    // Mobile cards
    mobileContainer.innerHTML = rfqItems.map((item, index) => `
        <div class="vp-item-card">
            <div class="vp-card-top-row">
                <div>
                    <div class="vp-item-name">${escapeHtml(item.item_name || '')}</div>
                    <div class="vp-card-meta">
                        <span class="vp-card-unit">${escapeHtml(item.unit || '-')}</span>
                        <span style="font-size: 0.73rem; color: var(--text-secondary, #94a3b8);">Qty: ${item.quantity || 0}</span>
                    </div>
                </div>
            </div>
            ${item.description ? `<div class="vp-item-desc" style="margin-bottom: 8px;">${escapeHtml(item.description)}</div>` : ''}
            <div class="vp-card-price-field">
                <label>Unit Price</label>
                <input type="number"
                    id="price_mobile_${index}"
                    data-item-id="${item.rfq_item_id || item.id}"
                    data-desktop-pair="price_${index}"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    oninput="syncPrice(this, 'price_${index}')">
            </div>
        </div>
    `).join('');

    // Sync desktop to mobile
    rfqItems.forEach((_, index) => {
        const desktopInput = document.getElementById(`price_${index}`);
        if (desktopInput) {
            desktopInput.addEventListener('input', function() {
                const mobileInput = document.getElementById(`price_mobile_${index}`);
                if (mobileInput) mobileInput.value = this.value;
            });
        }
    });
}

function syncPrice(mobileInput, desktopId) {
    const desktopInput = document.getElementById(desktopId);
    if (desktopInput) desktopInput.value = mobileInput.value;
}

// ==================== Submit Quote ====================

async function submitQuote() {
    const confirmed = await showConfirm(
        'Are you sure you want to submit your quote? You will not be able to modify it after submission.',
        'Submit Quote',
        'primary'
    );
    if (!confirmed) return;

    const submitBtn = document.getElementById('submitQuoteBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="vp-spinner" style="width: 16px; height: 16px; border-width: 2px;"></div> Submitting...';

    // Collect item prices (use desktop inputs as source of truth).
    // Only include items the vendor actually priced — blank or 0 inputs are
    // treated as "not quoted" so the comparison page can correctly badge
    // partial coverage instead of recording bogus 0-price line items.
    const itemQuotes = rfqItems
        .map((item, index) => {
            const priceInput = document.getElementById(`price_${index}`);
            const raw = priceInput?.value?.trim();
            if (!raw) return null;
            const price = parseFloat(raw);
            if (!isFinite(price) || price <= 0) return null;
            return {
                rfq_item_id: item.rfq_item_id || item.id,
                unit_price: price,
                quantity: item.quantity || 0
            };
        })
        .filter(Boolean);

    if (itemQuotes.length === 0) {
        Toast.error('Please enter at least one unit price');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Submit Quote';
        return;
    }

    const quoteData = {
        items: itemQuotes,
        delivery_days: parseInt(document.getElementById('quoteDeliveryDays').value) || null,
        payment_terms: document.getElementById('quotePaymentTerms').value.trim(),
        notes: document.getElementById('quoteNotes').value.trim()
    };

    try {
        const baseUrl = CONFIG.procurementApiBaseUrl;
        const response = await fetch(`${baseUrl}/vendor-portal/${portalToken}/submit-quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(quoteData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to submit quote');
        }

        showSuccess();
    } catch (error) {
        console.error('Failed to submit quote:', error);
        Toast.error(error.message || 'Failed to submit quote. Please try again.');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Submit Quote';
    }
}

// ==================== View State Management ====================

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
}

function showMainContent() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
}

function showError(message) {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
    document.getElementById('successState').style.display = 'none';
    document.getElementById('mainContent').style.display = 'none';
    if (message) {
        document.getElementById('errorMessage').textContent = message;
    }
}

function showSuccess() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('errorState').style.display = 'none';
    document.getElementById('successState').style.display = 'block';
    document.getElementById('mainContent').style.display = 'none';
}

// ==================== Utilities ====================

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
