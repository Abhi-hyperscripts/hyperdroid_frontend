// HRMS Dashboard JavaScript
function escapeHtml(t) { if (t == null) return ''; return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

let currentEmployee = null;
let isClockedIn = false;
let isSetupComplete = false;
let isComplianceComplete = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadNavigation();

    if (!api.isAuthenticated()) {
        window.location.href = '../login.html';
        return;
    }

    // Initialize RBAC
    hrmsRoles.init();

    // Auto-redirect basic users (HRMS_USER only) to Self-Service portal
    if (hrmsRoles.isBasicUser()) {
        window.location.href = 'self-service.html';
        return;
    }

    // Apply RBAC visibility
    applyDashboardRBAC();

    // Show admin link only for SUPERADMIN
    const adminLink = document.getElementById('hrmsAdminLink');
    if (adminLink && hrmsRoles.isSuperAdmin()) {
        adminLink.style.display = 'inline-flex';
    }

    // Start clock
    updateClock();
    setInterval(updateClock, 1000);

    // Header subtitle: today's date + org name
    const subtitle = document.getElementById('pulseSubtitle');
    if (subtitle) {
        const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
        const orgInfo = (typeof getOrganizationInfo === 'function') ? getOrganizationInfo() : null;
        const orgName = orgInfo && (orgInfo.organizationName || orgInfo.tenantName);
        subtitle.textContent = dateStr + (orgName ? ' · ' + orgName : '');
    }

    // Check organization setup status first
    await checkSetupStatus();

    // Load dashboard data
    await loadDashboard();
});

/**
 * Apply RBAC visibility to dashboard elements
 */
function applyDashboardRBAC() {
    // Setup warning banner - only show to HR admins
    hrmsRoles.setElementVisibility('setupWarningBanner', hrmsRoles.isHRAdmin());

    // Stats grid - show org stats only to HR users and above
    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        // For basic users, hide org-level stats (they can still see the grid but values will be '-')
        if (hrmsRoles.isBasicUser()) {
            statsGrid.style.display = 'none';
        }
    }

    // Quick action cards visibility based on role
    // Statutory Compliance - only HR admins (not managers)
    hrmsRoles.setElementVisibility('cardCompliance', hrmsRoles.isHRAdmin());

    // Organization - only HR users
    hrmsRoles.setElementVisibility('cardOrganization', hrmsRoles.canAccessOrganization());

    // Employees - HR users and managers
    hrmsRoles.setElementVisibility('cardEmployees', hrmsRoles.canAccessEmployees());

    // Payroll admin section - HR users only (basic users can still see own payslips via self-service)
    const payrollCard = document.getElementById('cardPayroll');
    if (payrollCard) {
        if (!hrmsRoles.canViewAllPayroll() && !hrmsRoles.isManager()) {
            // For basic users, change onclick to go to self-service payslips
            payrollCard.onclick = function() { navigateTo('self-service.html#payslips'); };
        }
    }

    // Reports - HR users and managers only
    hrmsRoles.setElementVisibility('cardReports', hrmsRoles.canAccessReports());

    // Recruitment - any HR role or SUPERADMIN. Basic HRMS_USER and HRMS_MANAGER
    // (line managers, not HR managers) don't see the tile.
    hrmsRoles.setElementVisibility('cardRecruitment',
        hrmsRoles.hasAnyRole(['HRMS_HR_USER', 'HRMS_HR_MANAGER', 'HRMS_HR_ADMIN', 'SUPERADMIN']));

    // Attendance - all users can view (own or team)
    // But change behavior based on role
    const attendanceCard = document.getElementById('cardAttendance');
    if (attendanceCard && hrmsRoles.isBasicUser()) {
        // For basic users, go to self-service attendance
        attendanceCard.onclick = function() { navigateTo('self-service.html#attendance'); };
    }

    // Leave - all users can access (own or team)
    const leaveCard = document.getElementById('cardLeave');
    if (leaveCard && hrmsRoles.isBasicUser()) {
        // For basic users, go to self-service leave
        leaveCard.onclick = function() { navigateTo('self-service.html#leave'); };
    }

    // Rail items mirror the card gating
    hrmsRoles.setElementVisibility('railCompliance', hrmsRoles.isHRAdmin());
    hrmsRoles.setElementVisibility('railOrganization', hrmsRoles.canAccessOrganization());
    hrmsRoles.setElementVisibility('railEmployees', hrmsRoles.canAccessEmployees());
    hrmsRoles.setElementVisibility('railReports', hrmsRoles.canAccessReports());
    hrmsRoles.setElementVisibility('railRecruitment',
        hrmsRoles.hasAnyRole(['HRMS_HR_USER', 'HRMS_HR_MANAGER', 'HRMS_HR_ADMIN', 'SUPERADMIN']));
    const railPayroll = document.getElementById('railPayroll');
    if (railPayroll && !hrmsRoles.canViewAllPayroll() && !hrmsRoles.isManager()) {
        railPayroll.onclick = function() { navigateTo('self-service.html#payslips'); };
    }

    console.log('Dashboard RBAC applied:', hrmsRoles.getDebugInfo());
}

async function checkSetupStatus() {
    try {
        const status = await api.request('/hrms/dashboard/setup-status');
        isSetupComplete = status.is_setup_complete;
        isComplianceComplete = status.is_compliance_complete;

        // Check if we have at least basic organization setup (office, department, designation, shift)
        // Payroll should be accessible even if salary structures aren't set up yet
        hasBasicSetup = status.has_office && status.has_department &&
                        status.has_designation && status.has_shift;

        const banner = document.getElementById('setupWarningBanner');
        const message = document.getElementById('setupWarningMessage');
        const missingList = document.getElementById('setupMissingItems');

        // STEP 1: Check Compliance First (MUST be complete before organization setup)
        if (!isComplianceComplete) {
            // Show compliance warning banner
            if (banner) {
                banner.style.display = 'flex';
                banner.classList.add('compliance-warning');
            }

            if (message) {
                message.textContent = status.compliance_message || 'Please complete the Compliance section first before setting up the organization.';
            }

            if (missingList && status.compliance_missing_items && status.compliance_missing_items.length > 0) {
                missingList.innerHTML = status.compliance_missing_items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
            }

            // Disable ALL cards except Compliance until compliance is done
            const cardsToDisable = ['cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardPayroll', 'cardReports'];
            cardsToDisable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.add('disabled');
                }
            });

            // Enable Compliance card - it should always be accessible
            const complianceCard = document.getElementById('cardCompliance');
            if (complianceCard) {
                complianceCard.classList.remove('disabled');
                complianceCard.classList.add('highlight-action');
            }

            // Update the "Complete Setup" button to go to compliance page
            const setupButton = document.getElementById('setupActionButton');
            if (setupButton) {
                setupButton.setAttribute('onclick', "navigateTo('compliance.html')");
            }

            return; // Don't check organization setup if compliance is not complete
        }

        // STEP 2: Check Organization Setup (only if compliance is complete)
        if (!isSetupComplete) {
            // Show organization setup warning banner
            if (banner) {
                banner.style.display = 'flex';
                banner.classList.remove('compliance-warning');
            }

            if (message && status.setup_message) {
                message.textContent = status.setup_message;
            }

            if (missingList && status.missing_items && status.missing_items.length > 0) {
                missingList.innerHTML = status.missing_items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
            }

            // Enable Compliance card (it's complete)
            const complianceCard = document.getElementById('cardCompliance');
            if (complianceCard) {
                complianceCard.classList.remove('disabled');
                complianceCard.classList.remove('highlight-action');
            }

            // Enable Organization card - this is what needs to be done next
            const organizationCard = document.getElementById('cardOrganization');
            if (organizationCard) {
                organizationCard.classList.remove('disabled');
                organizationCard.classList.add('highlight-action');
            }

            // Disable cards that require full setup
            const cardsToDisable = ['cardEmployees', 'cardAttendance', 'cardLeave', 'cardReports'];
            cardsToDisable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.add('disabled');
                }
            });

            // Payroll should be accessible when basic organization is set up
            const payrollCard = document.getElementById('cardPayroll');
            if (payrollCard) {
                if (hasBasicSetup) {
                    payrollCard.classList.remove('disabled');
                } else {
                    payrollCard.classList.add('disabled');
                }
            }
        } else {
            // STEP 3: Everything is complete!
            // Hide warning banner if visible
            if (banner) {
                banner.style.display = 'none';
            }

            // Enable all cards and remove highlight
            const cardsToEnable = ['cardCompliance', 'cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardPayroll', 'cardReports'];
            cardsToEnable.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.classList.remove('disabled');
                    card.classList.remove('highlight-action');
                }
            });
        }
    } catch (error) {
        console.error('Error checking setup status:', error);
        // If error, assume setup is NOT complete - disable cards that require setup
        isSetupComplete = false;
        isComplianceComplete = false;
        hasBasicSetup = false;

        // Disable cards that require setup (except compliance which should always work)
        const cardsToDisable = ['cardOrganization', 'cardEmployees', 'cardAttendance', 'cardLeave', 'cardReports', 'cardPayroll'];
        cardsToDisable.forEach(cardId => {
            const card = document.getElementById(cardId);
            if (card) {
                card.classList.add('disabled');
            }
        });

        // Show warning banner
        const banner = document.getElementById('setupWarningBanner');
        if (banner) {
            banner.style.display = 'flex';
        }
        const message = document.getElementById('setupWarningMessage');
        if (message) {
            message.textContent = 'Please complete Compliance and Organization setup before accessing other features.';
        }
    }
}

// Track if basic setup is complete (for Payroll access)
let hasBasicSetup = false;

function navigateIfSetupComplete(page) {
    // Compliance is always accessible
    if (page === 'compliance.html') {
        navigateTo(page);
        return;
    }

    // Check compliance first
    if (!isComplianceComplete) {
        showToast('Please complete Compliance setup first', 'error');
        // Redirect to compliance page
        navigateTo('compliance.html');
        return;
    }

    // Allow organization navigation once compliance is done
    if (page === 'organization.html') {
        navigateTo(page);
        return;
    }

    // Allow payroll navigation if basic setup is done (office, department, designation, shift)
    if (page === 'payroll.html' && hasBasicSetup) {
        navigateTo(page);
        return;
    }

    // Recruitment is standalone — postings/applications/copilot have no
    // dependency on offices/departments/designations/employees being set up,
    // so a brand-new tenant can start sourcing candidates immediately.
    if (page === 'recruitment.html') {
        navigateTo(page);
        return;
    }

    if (!isSetupComplete) {
        showToast('Please complete organization setup first', 'error');
        return;
    }
    navigateTo(page);
}

function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const timeEl = document.getElementById('currentTime');
    const dateEl = document.getElementById('currentDate');
    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
}

async function loadDashboard() {
    try {
        // Check if user has an employee profile (including admins who are also employees)
        let hasEmployeeProfile = false;
        try {
            const profileResult = await api.request('/hrms/self-service/my-profile');
            if (profileResult && profileResult.id) {
                hasEmployeeProfile = true;
                currentEmployee = profileResult;
            }
        } catch (e) {
            // User doesn't have an employee profile - that's okay for admin users
            console.log('User has no employee profile (admin user)');
        }

        // Show clock section for ANY user with an employee profile
        const clockSection = document.getElementById('clockSection');
        if (clockSection && (hasEmployeeProfile || hrmsRoles.isBasicUser())) {
            clockSection.style.display = 'block';
            await loadEmployeeAttendance();
        }

        // Load stats based on role
        // HR users and managers can see org-level stats
        if (hrmsRoles.isHRUser() || hrmsRoles.isManager()) {
            await loadAdminStats();
        } else {
            // Employees without team visibility get no org pulse
            const hero = document.getElementById('pulseHero');
            if (hero) hero.style.display = 'none';
            await loadEmployeeStats();
        }

        // Load common sections only if DOM elements exist
        const leaveRequestsEl = document.getElementById('recentLeaveRequests');
        if (leaveRequestsEl) {
            await loadRecentLeaveRequests();
        }

        const holidaysEl = document.getElementById('upcomingHolidays');
        if (holidaysEl) {
            await loadUpcomingEvents();
        }

    } catch (error) {
        console.error('Error loading dashboard:', error);
        showToast('Error loading dashboard data', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// People Pulse — one loader fills the hero (donut / attention / out today),
// the stat chips, and the payroll chip. HR roles see org-wide data; managers
// see their team (the backend scopes /attendance/team and pending-approvals).
// ═══════════════════════════════════════════════════════════════════════════
const asList = r => Array.isArray(r) ? r : (r?.data || []);
const isoDay = d => d.toISOString().split('T')[0];

async function loadAdminStats() {
    const isHR = hrmsRoles.isHRUser();
    const today = isoDay(new Date());

    const safe = p => p.then(asList).catch(() => null); // null = endpoint unavailable for this role

    const [employees, departments, offices, pendingLeave, pendingReg, attendance, leaveToday, payrollRuns] =
        await Promise.all([
            isHR ? safe(api.request('/hrms/employees?includeInactive=false'))
                 : safe(api.request('/hrms/employees/direct-reports')),
            safe(api.request('/hrms/departments')),
            safe(api.request('/hrms/offices')),
            safe(api.request('/hrms/leave/pending-approvals' + (isHR ? '?all=true' : ''))),
            safe(api.request('/hrms/attendance/regularization/pending' + (isHR ? '?all=true' : ''))),
            safe(api.request(`/hrms/attendance/team?date=${today}`)),
            isHR ? safe(api.request(`/hrms/leave-types/requests?startDate=${today}&endDate=${today}&status=approved`))
                 : safe(api.request(`/hrms/leave/team-calendar?startDate=${today}&endDate=${today}`))
                       .then(l => l ? l.filter(r => r.status === 'approved') : null),
            isHR ? safe(api.request('/hrms/payroll-processing/runs')) : Promise.resolve(null)
        ]);

    // ── stat chips
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('totalEmployees', employees ? employees.length : '-');
    set('totalDepartments', departments ? departments.length : '-');
    set('totalOffices', offices ? offices.length : '-');
    const pendingCount = (pendingLeave?.length || 0) + (pendingReg?.length || 0);
    set('pendingApprovals', (pendingLeave === null && pendingReg === null) ? '-' : pendingCount);

    // ── donut + legend
    const attList = attendance || [];
    const present = attList.filter(a => a.check_in_time).length;
    const onLeave = leaveToday ? leaveToday.length : 0;
    const total = employees ? employees.length : attList.length;
    const notIn = Math.max(0, total - present - onLeave);
    set('presentToday', present);
    set('onLeave', onLeave);
    set('notInYet', notIn);
    set('attRatio', total > 0 ? `${present}/${total}` : '–');
    set('attAsOf', 'as of ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }));
    renderAttDonut(present, onLeave, notIn);

    // avg check-in
    const times = attList.filter(a => a.check_in_time)
        .map(a => { const d = new Date(a.check_in_time); return d.getHours() * 60 + d.getMinutes(); });
    if (times.length) {
        const avg = Math.round(times.reduce((s, m) => s + m, 0) / times.length);
        set('avgCheckin', String(Math.floor(avg / 60)).padStart(2, '0') + ':' + String(avg % 60).padStart(2, '0'));
    } else {
        set('avgCheckin', '–');
    }

    renderAttention(pendingLeave || [], pendingReg || [], payrollRuns);
    renderOutToday(leaveToday || []);
    if (isHR && employees) renderMoments(employees);
    renderPayrollChip(payrollRuns);
    loadWeekBars(total);
}

function renderAttDonut(present, onLeave, notIn) {
    const svg = document.getElementById('attDonut');
    if (!svg) return;
    const total = present + onLeave + notIn;
    const C = 2 * Math.PI * 52; // r=52
    const seg = (count, color, offset) =>
        `<circle cx="64" cy="64" r="52" fill="none" stroke="${color}" stroke-width="13" ` +
        `stroke-dasharray="${(total ? count / total : 0) * C} ${C}" stroke-dashoffset="${-offset}" ` +
        (count > 0 ? 'stroke-linecap="round"' : '') + '/>';
    let html = `<circle cx="64" cy="64" r="52" fill="none" stroke="var(--gray-300)" stroke-width="13" opacity=".3"/>`;
    if (total > 0) {
        let off = 0;
        html += seg(present, 'var(--color-success)', off); off += (present / total) * C;
        html += seg(onLeave, 'var(--color-warning)', off); off += (onLeave / total) * C;
    }
    svg.innerHTML = html;
}

async function loadWeekBars(totalEmployees) {
    const bars = document.getElementById('weekBars');
    const labels = document.getElementById('weekLabels');
    if (!bars || !labels || !totalEmployees) return;

    // Monday..Sunday of the current week
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(monday); d.setDate(monday.getDate() + i); return d;
    });

    const counts = await Promise.all(days.map(d => {
        if (d > now) return Promise.resolve(null); // future day
        return api.request(`/hrms/attendance/team?date=${isoDay(d)}`)
            .then(r => asList(r).filter(a => a.check_in_time).length)
            .catch(() => null);
    }));

    bars.innerHTML = counts.map(c => {
        if (c === null) return '<div class="bar" style="background:var(--bg-secondary)"></div>';
        const pct = Math.min(100, Math.round((c / totalEmployees) * 100));
        return `<div class="bar" title="${c} of ${totalEmployees} present"><i style="height:${pct}%"></i></div>`;
    }).join('');
    labels.innerHTML = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span>${d}</span>`).join('');
}

function initialsOf(name) {
    return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function renderAttention(pendingLeave, pendingReg, payrollRuns) {
    const list = document.getElementById('attnList');
    const count = document.getElementById('attnCount');
    if (!list) return;

    const items = [];

    pendingLeave.forEach(lr => {
        const from = new Date(lr.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const to = new Date(lr.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const days = lr.total_days ? `${lr.total_days} day${lr.total_days > 1 ? 's' : ''}` : '';
        items.push({
            tag: 'leave', tagLabel: 'LEAVE', who: initialsOf(lr.employee_name),
            t1: `${lr.employee_name || 'Employee'} · ${lr.leave_type_name || 'Leave'}`,
            t2: `${from}${to !== from ? '–' + to : ''}${days ? ' · ' + days : ''}${lr.reason ? ' · ' + lr.reason : ''}`,
            acts: `<button class="pulse-mini yes" onclick="event.stopPropagation();actOnLeave('${lr.id}', true, this)">Approve</button>
                   <button class="pulse-mini" onclick="event.stopPropagation();showRejectForm(this, 'leave', '${lr.id}')">Reject</button>`
        });
    });

    pendingReg.forEach(rr => {
        const day = rr.date ? new Date(rr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
        items.push({
            tag: 'attend', tagLabel: 'ATTEND', who: initialsOf(rr.employee_name),
            t1: `${rr.employee_name || 'Employee'} · Regularization`,
            t2: `${day}${rr.reason ? ' · ' + rr.reason : ''}`,
            acts: `<button class="pulse-mini yes" onclick="event.stopPropagation();actOnReg('${rr.id}', true, this)">Approve</button>
                   <button class="pulse-mini" onclick="event.stopPropagation();showRejectForm(this, 'reg', '${rr.id}')">Reject</button>`
        });
    });

    // Payroll: surface the newest non-approved run as a task
    if (Array.isArray(payrollRuns)) {
        const open = payrollRuns.filter(r => r.status && r.status !== 'approved' && r.status !== 'paid')
            .sort((a, b) => (b.payroll_year - a.payroll_year) || (b.payroll_month - a.payroll_month))[0];
        if (open) {
            const monthName = new Date(open.payroll_year, open.payroll_month - 1, 1)
                .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            items.push({
                tag: 'payroll', tagLabel: 'PAYROLL', who: '₹',
                t1: `${monthName} payroll run`,
                t2: `${open.total_employees || 0} employees · status ${open.status}`,
                acts: `<button class="pulse-mini" onclick="event.stopPropagation();navigateIfSetupComplete('payroll.html')">Review run</button>`
            });
        }
    }

    if (count) count.textContent = items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : '';
    if (!items.length) {
        list.innerHTML = '<div class="pulse-empty">All clear — nothing waiting on you.</div>';
        return;
    }

    list.innerHTML = items.map(i =>
        `<div class="pulse-task">
            <div class="trow">
                <div class="who">${escapeHtml(i.who)}</div>
                <div class="meta"><div class="t1">${escapeHtml(i.t1)}</div><div class="t2">${escapeHtml(i.t2)}</div></div>
                <span class="pulse-tag ${i.tag}">${i.tagLabel}</span>
            </div>
            <div class="pulse-acts">${i.acts}</div>
        </div>`).join('');
}

async function actOnLeave(id, approve, btn, reason) {
    if (btn) btn.disabled = true;
    try {
        await api.request('/hrms/leave/approve', {
            method: 'POST',
            body: JSON.stringify({ leave_request_id: id, approve: approve, rejection_reason: reason || null })
        });
        showToast(approve ? 'Leave approved' : 'Leave rejected', 'success');
        await loadAdminStats();
    } catch (e) {
        showToast(e?.message || 'Could not update the leave request', 'error');
        if (btn) btn.disabled = false;
    }
}

async function actOnReg(id, approve, btn, reason) {
    if (btn) btn.disabled = true;
    try {
        await api.request(`/hrms/attendance/regularization/${id}/approve`, {
            method: 'POST',
            body: JSON.stringify({ approve: approve, rejection_reason: reason || null })
        });
        showToast(approve ? 'Regularization approved' : 'Regularization rejected', 'success');
        await loadAdminStats();
    } catch (e) {
        showToast(e?.message || 'Could not update the regularization', 'error');
        if (btn) btn.disabled = false;
    }
}

// Swap the task's action row for an inline reason field (no native prompt)
function showRejectForm(btn, kind, id) {
    const acts = btn.closest('.pulse-acts');
    if (!acts) return;
    acts.outerHTML =
        `<div class="pulse-reject-form">
            <input type="text" placeholder="Reason (optional)" maxlength="200"
                   onkeydown="if(event.key==='Enter'){confirmReject(this,'${kind}','${id}')}">
            <button class="pulse-mini" onclick="confirmReject(this,'${kind}','${id}')">Confirm reject</button>
            <button class="pulse-mini" onclick="loadAdminStats()">Cancel</button>
        </div>`;
}

function confirmReject(el, kind, id) {
    const form = el.closest('.pulse-reject-form');
    const reason = form ? (form.querySelector('input')?.value || '') : '';
    if (kind === 'leave') actOnLeave(id, false, null, reason);
    else actOnReg(id, false, null, reason);
}

function renderOutToday(leaveToday) {
    const el = document.getElementById('outToday');
    if (!el) return;
    if (!leaveToday.length) {
        el.innerHTML = '<div class="pulse-empty">Everyone is expected in today.</div>';
        return;
    }
    el.innerHTML = leaveToday.map(lr => {
        const back = new Date(lr.end_date);
        back.setDate(back.getDate() + 1);
        const backStr = back.toLocaleDateString('en-IN', { weekday: 'short' });
        return `<div class="pulse-person">
            <div class="who">${escapeHtml(initialsOf(lr.employee_name))}</div>
            <div><div class="nm">${escapeHtml(lr.employee_name || 'Employee')}</div>
                 <div class="why">${escapeHtml(lr.leave_type_name || 'Leave')}</div></div>
            <span class="until">back ${backStr}</span>
        </div>`;
    }).join('');
}

function renderMoments(employees) {
    const el = document.getElementById('momentsList');
    if (!el) return;
    const now = new Date();
    const within7 = (d) => {
        if (!d) return null;
        const dt = new Date(d);
        const next = new Date(now.getFullYear(), dt.getMonth(), dt.getDate());
        if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(next.getFullYear() + 1);
        const diff = Math.round((next - now) / 86400000);
        return diff >= 0 && diff <= 7 ? next : null;
    };
    const dayName = d => d.toLocaleDateString('en-IN', { weekday: 'long' });

    const moments = [];
    employees.forEach(emp => {
        const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
        const bday = within7(emp.date_of_birth);
        if (bday) {
            const age = bday.getFullYear() - new Date(emp.date_of_birth).getFullYear();
            moments.push({ em: '🎂', text: `${name} turns ${age} on ${dayName(bday)}` });
        }
        const anniv = within7(emp.hire_date);
        if (anniv) {
            const yrs = anniv.getFullYear() - new Date(emp.hire_date).getFullYear();
            if (yrs > 0) moments.push({ em: '🎉', text: `${name} completes ${yrs} year${yrs > 1 ? 's' : ''} on ${dayName(anniv)}` });
        }
    });

    el.innerHTML = moments.length
        ? moments.map(m => `<div class="pulse-moment"><span class="em">${m.em}</span> ${escapeHtml(m.text)}</div>`).join('')
        : '<div class="pulse-empty">No birthdays or anniversaries.</div>';
}

function renderPayrollChip(payrollRuns) {
    const chip = document.getElementById('payrollChip');
    if (!chip || !Array.isArray(payrollRuns) || !payrollRuns.length) return;
    const done = payrollRuns.filter(r => r.status === 'approved' || r.status === 'paid')
        .sort((a, b) => (b.payroll_year - a.payroll_year) || (b.payroll_month - a.payroll_month))[0];
    if (!done || done.total_net == null) return;
    const n = done.total_net;
    const fmt = n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + 'Cr'
              : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + 'L'
              : '₹' + Math.round(n).toLocaleString('en-IN');
    document.getElementById('payrollChipVal').textContent = fmt;
    const monthName = new Date(done.payroll_year, done.payroll_month - 1, 1)
        .toLocaleDateString('en-IN', { month: 'short' });
    document.getElementById('payrollChipLabel').textContent = `net payroll · ${monthName}`;
    chip.style.display = '';
}

async function loadEmployeeStats() {
    try {
        // Load current employee's dashboard data
        const dashboardData = await api.request('/hrms/self-service/dashboard');
        if (dashboardData) {
            currentEmployee = dashboardData.employee;
        }

        // Update stats for employee view
        document.getElementById('totalEmployees').textContent = '-';
        document.getElementById('presentToday').textContent = '-';
        document.getElementById('onLeave').textContent = '-';
        document.getElementById('totalDepartments').textContent = '-';
        document.getElementById('totalOffices').textContent = '-';
        document.getElementById('pendingApprovals').textContent = '-';

    } catch (error) {
        console.error('Error loading employee stats:', error);
    }
}

async function loadEmployeeAttendance() {
    try {
        const today = await api.request('/hrms/attendance/today');
        // API returns { has_checked_in, has_checked_out, record: { check_in_time, ... } }
        if (today && today.has_checked_in && today.record) {
            isClockedIn = !today.has_checked_out;
            updateClockUI(today.record);
        }
    } catch (error) {
        console.error('Error loading attendance:', error);
    }
}

function updateClockUI(attendance) {
    const clockBtn = document.getElementById('clockBtn');
    const clockInfo = document.getElementById('clockInfo');

    if (attendance && attendance.check_in_time) {
        const checkIn = new Date(attendance.check_in_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        if (attendance.check_out_time) {
            const checkOut = new Date(attendance.check_out_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            clockInfo.textContent = `Checked in: ${checkIn} | Checked out: ${checkOut}`;
            clockBtn.textContent = 'Completed';
            clockBtn.disabled = true;
            clockBtn.classList.remove('clock-in');
            clockBtn.classList.add('clock-out');
        } else {
            clockInfo.textContent = `Checked in at ${checkIn}`;
            clockBtn.textContent = 'Clock Out';
            clockBtn.classList.remove('clock-in');
            clockBtn.classList.add('clock-out');
            isClockedIn = true;
        }
    } else {
        clockInfo.textContent = 'Not checked in yet';
        clockBtn.textContent = 'Clock In';
        clockBtn.classList.remove('clock-out');
        clockBtn.classList.add('clock-in');
        isClockedIn = false;
    }
}

async function handleClock() {
    try {
        if (isClockedIn) {
            const result = await api.request('/hrms/attendance/clock-out', {
                method: 'POST',
                body: JSON.stringify({})
            });
            showToast('Clocked out successfully', 'success');
            updateClockUI(result);
        } else {
            const result = await api.request('/hrms/attendance/clock-in', {
                method: 'POST',
                body: JSON.stringify({})
            });
            showToast('Clocked in successfully', 'success');
            updateClockUI(result);
        }
    } catch (error) {
        showToast(error.message || 'Clock operation failed', 'error');
    }
}

async function loadRecentLeaveRequests() {
    const tbody = document.getElementById('recentLeaveRequests');
    if (!tbody) return; // Element removed from page

    try {
        // For HR users/manager, show pending approvals
        // For basic employee, show their own requests
        let requests = [];

        if (hrmsRoles.canApproveLeave()) {
            const response = await api.request('/hrms/leave/pending-approvals');
            requests = Array.isArray(response) ? response : (response?.data || []);
        } else {
            const response = await api.request('/hrms/leave/requests');
            requests = Array.isArray(response) ? response : (response?.data || []);
        }

        if (!requests || requests.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <p class="text-muted" style="font-size: 0.85rem;">No leave requests found</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Show only recent 5
        const recentRequests = requests.slice(0, 5);

        tbody.innerHTML = recentRequests.map(req => `
            <tr>
                <td>
                    <div class="employee-info">
                        <div class="employee-avatar">${escapeHtml(getInitials(req.employee_name || 'User'))}</div>
                        <div>
                            <div class="employee-name">${escapeHtml(req.employee_name || 'Employee')}</div>
                        </div>
                    </div>
                </td>
                <td>${escapeHtml(req.leave_type_name || '-')}</td>
                <td>${formatDate(req.start_date)}</td>
                <td>${formatDate(req.end_date)}</td>
                <td>${escapeHtml(String(req.number_of_days || '-'))}</td>
                <td><span class="status-badge ${escapeHtml(req.status || 'pending')}">${escapeHtml(capitalizeFirst(req.status || 'pending'))}</span></td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Error loading leave requests:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <p class="text-muted" style="font-size: 0.85rem;">Unable to load leave requests</p>
                </td>
            </tr>
        `;
    }
}

async function loadUpcomingEvents() {
    const holidaysContainer = document.getElementById('upcomingHolidays');
    const birthdaysContainer = document.getElementById('upcomingBirthdays');

    // Elements removed from page
    if (!holidaysContainer && !birthdaysContainer) return;

    if (holidaysContainer) {
        try {
            // Load upcoming holidays for current year
            let holidayUrl = `/hrms/holidays?year=${new Date().getFullYear()}`;
            if (currentEmployee?.office_id) {
                holidayUrl += `&officeId=${currentEmployee.office_id}`;
            }
            const holidays = await api.request(holidayUrl);
            let holidayList = Array.isArray(holidays) ? holidays : (holidays?.data || []);
            // Deduplicate if no office filter
            if (!currentEmployee?.office_id && holidayList.length) {
                const seen = new Set();
                holidayList = holidayList.filter(h => {
                    const key = `${h.holiday_name}_${h.holiday_date}`;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            }

            // Filter for upcoming holidays only
            const today = new Date();
            const upcomingHolidays = holidayList
                .filter(h => new Date(h.holiday_date) >= today)
                .sort((a, b) => new Date(a.holiday_date) - new Date(b.holiday_date))
                .slice(0, 5);

            if (upcomingHolidays.length > 0) {
                holidaysContainer.innerHTML = upcomingHolidays.map(h => `
                    <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color-light);">
                        <span style="font-size: 0.85rem;">${escapeHtml(h.holiday_name)}</span>
                        <span class="text-muted" style="font-size: 0.8rem;">${formatDate(h.holiday_date)}</span>
                    </div>
                `).join('');
            } else {
                holidaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">No upcoming holidays</p>';
            }
        } catch (error) {
            holidaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Unable to load holidays</p>';
        }
    }

    // Birthdays feature - show placeholder for now (requires backend API)
    if (birthdaysContainer) {
        birthdaysContainer.innerHTML = '<p class="text-muted" style="font-size: 0.85rem;">Feature coming soon</p>';
    }
}

function refreshDashboard() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('loading');
    loadDashboard().finally(() => {
        btn.classList.remove('loading');
    });
}

function navigateTo(page) {
    window.location.href = page;
}

// Utility functions
function getInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function capitalizeFirst(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// Local showToast removed - using unified toast.js instead

// ============================================
// SignalR Real-Time Event Handlers
// ============================================

/**
 * Called when an employee is updated (from hrms-signalr.js)
 */
function onEmployeeUpdated(data) {
    console.log('[Dashboard] Employee updated:', data);
    // Refresh dashboard stats
    loadDashboard();
}

/**
 * Called when a new employee is created (from hrms-signalr.js)
 */
function onEmployeeCreated(data) {
    console.log('[Dashboard] Employee created:', data);
    // Don't show toast here - the creator already sees a toast from saveEmployee()
    // This handler is for refreshing dashboard stats when other users create employees
    loadDashboard();
}

/**
 * Called when attendance is updated (from hrms-signalr.js)
 */
function onAttendanceUpdated(data) {
    console.log('[Dashboard] Attendance updated:', data);
    // Refresh dashboard to update attendance stats
    loadDashboard();
}

/**
 * Called when a leave request is updated (from hrms-signalr.js)
 */
function onLeaveRequestUpdated(data) {
    console.log('[Dashboard] Leave request updated:', data);
    // Refresh dashboard to update leave stats
    loadDashboard();
}

/**
 * Called when organization structure is updated (from hrms-signalr.js)
 */
function onOrganizationUpdated(data) {
    console.log('[Dashboard] Organization updated:', data);
    // Refresh dashboard to update org stats
    loadDashboard();
}
