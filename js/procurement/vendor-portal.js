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

    document.getElementById('rfqNumber').textContent = rfqData.rfq_number || rfqData.inquiry_number || '-';
    document.getElementById('rfqInquiry').textContent = rfqData.inquiry_title || rfqData.title || '-';
    document.getElementById('rfqDueDate').textContent = formatDate(rfqData.due_date);
    document.getElementById('rfqBuyer').textContent = rfqData.buyer_name || rfqData.organization_name || '-';

    if (rfqData.notes) {
        document.getElementById('rfqNotes').style.display = 'block';
        document.getElementById('rfqNotesText').textContent = rfqData.notes;
    }

    renderItems();
}

function renderItems() {
    const tbody = document.getElementById('rfqItemsBody');

    if (!rfqItems || rfqItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 24px;">No items in this RFQ</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rfqItems.map((item, index) => `
        <tr>
            <td style="font-weight: 500;">${escapeHtml(item.item_name || '')}</td>
            <td>${item.quantity || 0}</td>
            <td>${escapeHtml(item.unit || '-')}</td>
            <td style="color: var(--text-secondary); font-size: 13px;">${escapeHtml(item.description || '-')}</td>
            <td>
                <input type="number"
                    id="price_${index}"
                    data-item-id="${item.id}"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    style="max-width: 120px;">
            </td>
        </tr>
    `).join('');
}

// ==================== Submit Quote ====================

async function submitQuote() {
    const submitBtn = document.getElementById('submitQuoteBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    // Collect item prices
    const itemQuotes = rfqItems.map((item, index) => {
        const priceInput = document.getElementById(`price_${index}`);
        return {
            item_id: item.id,
            unit_price: parseFloat(priceInput?.value) || 0
        };
    });

    // Validate at least one price is entered
    const hasAnyPrice = itemQuotes.some(q => q.unit_price > 0);
    if (!hasAnyPrice) {
        showToastMessage('Please enter at least one unit price', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Quote';
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
        showToastMessage(error.message || 'Failed to submit quote. Please try again.', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Quote';
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

/**
 * Simple toast notification for the vendor portal (no dependency on Toast.js)
 */
function showToastMessage(message, type) {
    // Remove any existing toast
    const existing = document.querySelector('.vp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'vp-toast';
    const bgColor = type === 'error' ? 'var(--color-error)' : 'var(--color-success)';
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: var(--text-inverse);
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: opacity 0.3s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
