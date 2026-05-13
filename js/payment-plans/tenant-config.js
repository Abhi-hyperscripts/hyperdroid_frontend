// PaymentPlans — Tenant Configuration tab
// Vocabulary editor, defaults (currency, timezone, channels), payment gateway.
(function () {
    'use strict';

    window.loadTenantConfigTab = async function (container) {
        if (!container) container = document.getElementById('tab-tenant-config');
        if (container.dataset.rendered === '1') return;
        container.dataset.rendered = '1';
        container.innerHTML = `
            <details class="pp-helper" open>
                <summary>What is this?</summary>
                <p>This page lets your tenant <strong>relabel</strong> the system to match your domain
                    (Student / Cohort / Counsellor instead of the generic Payer / Group / Owner) and set
                    the defaults for new payment plans.</p>
                <ul>
                    <li><strong>Vocabulary</strong> — words shown across the app.</li>
                    <li><strong>Defaults</strong> — currency, timezone and channels used when creating new plans.</li>
                    <li><strong>Payment gateway</strong> — pick which gateway processes online payments. Manual = no online payments, you record offline.</li>
                </ul>
            </details>
            <div class="pp-section">
                <div class="pp-section-header">
                    <div>
                        <h2 class="pp-section-title">Tenant Configuration</h2>
                        <p class="pp-section-subtitle">Per-tenant labels &amp; defaults</p>
                    </div>
                    <div class="pp-btn-group">
                        <button class="btn btn-secondary" id="ppTCReset">Reset</button>
                        <button class="btn btn-primary" id="ppTCSave">Save</button>
                    </div>
                </div>
                <form id="ppTCForm">
                    <h3 style="font-size:14px;margin-top:0;margin-bottom:12px;">Vocabulary</h3>
                    <div class="pp-form-row">
                        <label>Payer (singular)</label>
                        <div>
                            <input name="vocab.payer" placeholder="e.g. Student, Customer, Member">
                            <div class="pp-hint">What you call the entity that owes money.</div>
                        </div>
                    </div>
                    <div class="pp-form-row">
                        <label>Payer (plural)</label>
                        <div><input name="vocab.payer_plural" placeholder="e.g. Students"></div>
                    </div>
                    <div class="pp-form-row">
                        <label>Group (singular)</label>
                        <div>
                            <input name="vocab.group" placeholder="e.g. Cohort, Tier, Project">
                            <div class="pp-hint">A logical bucket of payers (cohort / tier / project / account).</div>
                        </div>
                    </div>
                    <div class="pp-form-row">
                        <label>Group (plural)</label>
                        <div><input name="vocab.group_plural" placeholder="e.g. Cohorts"></div>
                    </div>
                    <div class="pp-form-row">
                        <label>Owner</label>
                        <div>
                            <input name="vocab.owner" placeholder="e.g. Counsellor, RM, Sales Exec">
                            <div class="pp-hint">The person responsible for a payer's collections.</div>
                        </div>
                    </div>
                    <div class="pp-form-row">
                        <label>Plan</label>
                        <div><input name="vocab.plan" placeholder="e.g. Payment Plan"></div>
                    </div>
                    <div class="pp-form-row">
                        <label>Installment</label>
                        <div><input name="vocab.installment" placeholder="e.g. Installment"></div>
                    </div>

                    <h3 style="font-size:14px;margin-top:24px;margin-bottom:12px;">Defaults</h3>
                    <div class="pp-form-row">
                        <label>Default currency</label>
                        <div><input name="default_currency" placeholder="INR" maxlength="3"></div>
                    </div>
                    <div class="pp-form-row">
                        <label>Default timezone</label>
                        <div><input name="default_timezone" placeholder="Asia/Kolkata"></div>
                    </div>
                    <div class="pp-form-row">
                        <label>Default channels</label>
                        <div>
                            <div style="display:flex;gap:16px;flex-wrap:wrap;">
                                <label style="font-weight:400;"><input type="checkbox" name="ch.email"> Email</label>
                                <label style="font-weight:400;"><input type="checkbox" name="ch.whatsapp"> WhatsApp</label>
                                <label style="font-weight:400;"><input type="checkbox" name="ch.sms"> SMS</label>
                            </div>
                            <div class="pp-hint">Channels new plans use unless overridden.</div>
                        </div>
                    </div>
                    <div class="pp-form-row">
                        <label>Payment gateway</label>
                        <div>
                            <select name="payment_gateway">
                                <option value="">Manual (no online payments)</option>
                                <option value="razorpay">Razorpay</option>
                                <option value="cashfree">Cashfree</option>
                                <option value="stripe">Stripe</option>
                            </select>
                            <div class="pp-hint">You can switch later; credentials are managed under Mailboxes / API keys.</div>
                        </div>
                    </div>
                </form>
            </div>
        `;

        const form = container.querySelector('#ppTCForm');
        const config = await window.PP.loadConfig();
        fillForm(form, config);

        container.querySelector('#ppTCSave').addEventListener('click', async () => {
            const body = readForm(form);
            try {
                const r = await api.request('/payment-plans/tenant-config', {
                    method: 'PUT', body: JSON.stringify(body)
                });
                window.PP.config = r;
                window.PP.vocabulary = r.vocabulary || {};
                toast.success?.('Saved');
            } catch (e) {
                toast.error?.(e.message || 'Failed to save');
            }
        });
        container.querySelector('#ppTCReset').addEventListener('click', () => fillForm(form, config));
    };

    function fillForm(form, cfg) {
        const v = cfg.vocabulary || {};
        form.elements['vocab.payer'].value = v.payer || '';
        form.elements['vocab.payer_plural'].value = v.payer_plural || '';
        form.elements['vocab.group'].value = v.group || '';
        form.elements['vocab.group_plural'].value = v.group_plural || '';
        form.elements['vocab.owner'].value = v.owner || '';
        form.elements['vocab.plan'].value = v.plan || '';
        form.elements['vocab.installment'].value = v.installment || '';
        form.elements['default_currency'].value = cfg.default_currency || 'INR';
        form.elements['default_timezone'].value = cfg.default_timezone || 'Asia/Kolkata';
        form.elements['payment_gateway'].value = cfg.payment_gateway || '';
        const ch = cfg.default_channels || [];
        form.elements['ch.email'].checked = ch.includes('email');
        form.elements['ch.whatsapp'].checked = ch.includes('whatsapp');
        form.elements['ch.sms'].checked = ch.includes('sms');
    }

    function readForm(form) {
        const channels = [];
        if (form.elements['ch.email'].checked) channels.push('email');
        if (form.elements['ch.whatsapp'].checked) channels.push('whatsapp');
        if (form.elements['ch.sms'].checked) channels.push('sms');
        return {
            tenant_id: window.PP.tenantId,
            vocabulary: {
                payer: form.elements['vocab.payer'].value || 'Customer',
                payer_plural: form.elements['vocab.payer_plural'].value || 'Customers',
                group: form.elements['vocab.group'].value || 'Group',
                group_plural: form.elements['vocab.group_plural'].value || 'Groups',
                owner: form.elements['vocab.owner'].value || 'Owner',
                plan: form.elements['vocab.plan'].value || 'Payment Plan',
                installment: form.elements['vocab.installment'].value || 'Installment'
            },
            default_channels: channels.length ? channels : ['email'],
            payment_gateway: form.elements['payment_gateway'].value || null,
            default_currency: (form.elements['default_currency'].value || 'INR').toUpperCase().slice(0, 3),
            default_timezone: form.elements['default_timezone'].value || 'Asia/Kolkata'
        };
    }
})();
