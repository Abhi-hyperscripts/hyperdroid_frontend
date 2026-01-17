/**
 * HRMS SignalR Real-time Updates
 *
 * This module manages SignalR connection to the HRMS hub for real-time updates.
 * Updates are tenant-isolated - only users in the affected tenant receive notifications.
 *
 * Usage:
 * 1. Include this file after signalr.min.js in your HTML
 * 2. Call initializeHrmsSignalR() after page load
 * 3. Define event handler functions in your page (e.g., onEmployeeUpdated, onSalaryUpdated)
 */

// Global SignalR connection for HRMS
let hrmsHubConnection = null;

// Connection state
let hrmsConnectionState = {
    isConnected: false,
    isReconnecting: false,
    lastError: null,
    reconnectAttempts: 0
};

// Track pending actions to avoid duplicate notifications for the acting user
// When a user performs an action, we add it here. When SignalR broadcasts,
// we skip the notification if it matches a pending action (but still sync data).
const hrmsPendingActions = new Map();

/**
 * Mark an action as pending (call before API request)
 * @param {string} actionType - e.g., 'SalaryRevised', 'SalaryCreated'
 * @param {string} entityId - e.g., employeeId
 * @param {number} timeoutMs - Auto-remove after this time (default 10s)
 */
function markHrmsPendingAction(actionType, entityId, timeoutMs = 10000) {
    const key = `${actionType}:${entityId}`;
    hrmsPendingActions.set(key, Date.now());
    // Auto-cleanup after timeout
    setTimeout(() => hrmsPendingActions.delete(key), timeoutMs);
}

/**
 * Check and consume a pending action (call in SignalR handler)
 * @param {string} actionType - e.g., 'SalaryRevised', 'SalaryCreated'
 * @param {string} entityId - e.g., employeeId
 * @returns {boolean} True if this was a pending action by current user
 */
function consumeHrmsPendingAction(actionType, entityId) {
    const key = `${actionType}:${entityId}`;
    if (hrmsPendingActions.has(key)) {
        hrmsPendingActions.delete(key);
        return true; // This user performed this action, skip notification
    }
    return false; // Another user performed this action, show notification
}

/**
 * Initialize SignalR connection to HRMS hub
 * @returns {Promise<boolean>} True if connected successfully
 */
async function initializeHrmsSignalR() {
    const token = getAuthToken();
    if (!token) {
        console.warn('[HRMS SignalR] No auth token found. Skipping connection.');
        return false;
    }

    // Don't reconnect if already connected
    if (hrmsHubConnection && hrmsConnectionState.isConnected) {
        console.log('[HRMS SignalR] Already connected.');
        return true;
    }

    try {
        // Build connection with automatic reconnect
        hrmsHubConnection = new signalR.HubConnectionBuilder()
            .withUrl(CONFIG.hrmsSignalRHubUrl, {
                accessTokenFactory: () => getAuthToken()
            })
            .withAutomaticReconnect([0, 2000, 5000, 10000, 30000, 60000]) // Retry intervals
            .configureLogging(signalR.LogLevel.Information)
            .build();

        // Register connection state event handlers
        registerConnectionHandlers();

        // Register HRMS event handlers
        registerHrmsEventHandlers();

        // Start the connection
        await hrmsHubConnection.start();
        hrmsConnectionState.isConnected = true;
        hrmsConnectionState.reconnectAttempts = 0;
        console.log('[HRMS SignalR] Connected successfully');

        return true;
    } catch (err) {
        console.error('[HRMS SignalR] Connection failed:', err);
        hrmsConnectionState.lastError = err;
        hrmsConnectionState.isConnected = false;
        return false;
    }
}

/**
 * Register connection state event handlers
 */
function registerConnectionHandlers() {
    // Connection closed
    hrmsHubConnection.onclose((error) => {
        hrmsConnectionState.isConnected = false;
        hrmsConnectionState.isReconnecting = false;
        if (error) {
            console.error('[HRMS SignalR] Connection closed with error:', error);
            hrmsConnectionState.lastError = error;
        } else {
            console.log('[HRMS SignalR] Connection closed');
        }
    });

    // Reconnecting
    hrmsHubConnection.onreconnecting((error) => {
        hrmsConnectionState.isConnected = false;
        hrmsConnectionState.isReconnecting = true;
        hrmsConnectionState.reconnectAttempts++;
        console.log('[HRMS SignalR] Reconnecting...', error ? error.message : '');
    });

    // Reconnected
    hrmsHubConnection.onreconnected((connectionId) => {
        hrmsConnectionState.isConnected = true;
        hrmsConnectionState.isReconnecting = false;
        hrmsConnectionState.reconnectAttempts = 0;
        console.log('[HRMS SignalR] Reconnected with ID:', connectionId);

        // Show a toast notification on reconnect
        if (typeof showToast === 'function') {
            showToast('Connection restored', 'success');
        }
    });
}

/**
 * Helper to get property value supporting both PascalCase and camelCase
 * @param {object} obj - The object to get property from
 * @param {string} pascalKey - PascalCase key name (e.g., 'EmployeeName')
 * @returns {any} The property value or undefined
 */
function getProp(obj, pascalKey) {
    if (!obj) return undefined;
    // Try PascalCase first
    if (obj[pascalKey] !== undefined) return obj[pascalKey];
    // Try camelCase
    const camelKey = pascalKey.charAt(0).toLowerCase() + pascalKey.slice(1);
    return obj[camelKey];
}

/**
 * Register HRMS event handlers
 * These call page-specific handler functions if they exist
 */
function registerHrmsEventHandlers() {
    // ==================== Employee Events ====================
    hrmsHubConnection.on('EmployeeCreated', (data) => {
        console.log('[HRMS SignalR] EmployeeCreated:', data);
        if (typeof onEmployeeCreated === 'function') {
            onEmployeeCreated(data);
        }
        // Don't show toast here - the creator already sees a toast from saveEmployee()
        // This handler is for refreshing data when other users create employees
    });

    hrmsHubConnection.on('EmployeeUpdated', (data) => {
        console.log('[HRMS SignalR] EmployeeUpdated:', data);
        if (typeof onEmployeeUpdated === 'function') {
            onEmployeeUpdated(data);
        }
        // Don't show toast here - the updater already sees a toast from saveEmployee()
        // This handler is for refreshing data when other users update employees
    });

    hrmsHubConnection.on('EmployeeTerminated', (data) => {
        console.log('[HRMS SignalR] EmployeeTerminated:', data);
        if (typeof onEmployeeTerminated === 'function') {
            onEmployeeTerminated(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Employee Terminated', `${name} has left`, 'warning');
    });

    // ==================== Salary Events ====================
    hrmsHubConnection.on('SalaryCreated', (data) => {
        console.log('[HRMS SignalR] SalaryCreated:', data);
        if (typeof onSalaryCreated === 'function') {
            onSalaryCreated(data);
        }
        // Show refresh prompt only if this action was performed by another user
        const employeeId = getProp(data, 'EmployeeId');
        if (!consumeHrmsPendingAction('SalaryCreated', employeeId)) {
            const name = getProp(data, 'EmployeeName') || 'Employee';
            showRefreshPrompt(`Salary assigned to ${name}. Refresh to see changes?`, () => {
                // Refresh the employee salaries view if the function exists
                if (typeof loadEmployeeSalaries === 'function') loadEmployeeSalaries();
                if (typeof loadSalaryStructures === 'function') loadSalaryStructures();
            }, 'success');
        }
    });

    hrmsHubConnection.on('SalaryUpdated', (data) => {
        console.log('[HRMS SignalR] SalaryUpdated:', data);
        if (typeof onSalaryUpdated === 'function') {
            onSalaryUpdated(data);
        }
        // Show refresh prompt only if this action was performed by another user
        const employeeId = getProp(data, 'EmployeeId');
        if (!consumeHrmsPendingAction('SalaryUpdated', employeeId)) {
            const name = getProp(data, 'EmployeeName') || 'Employee';
            showRefreshPrompt(`Salary updated for ${name}. Refresh to see changes?`, () => {
                if (typeof loadEmployeeSalaries === 'function') loadEmployeeSalaries();
                if (typeof loadSalaryStructures === 'function') loadSalaryStructures();
            }, 'info');
        }
    });

    hrmsHubConnection.on('SalaryRevised', (data) => {
        console.log('[HRMS SignalR] SalaryRevised:', data);
        if (typeof onSalaryRevised === 'function') {
            onSalaryRevised(data);
        }
        // Show refresh prompt only if this action was performed by another user
        const employeeId = getProp(data, 'EmployeeId');
        if (!consumeHrmsPendingAction('SalaryRevised', employeeId)) {
            const name = getProp(data, 'EmployeeName') || 'Employee';
            showRefreshPrompt(`Salary revised for ${name}. Refresh to see changes?`, () => {
                if (typeof loadEmployeeSalaries === 'function') loadEmployeeSalaries();
                if (typeof loadSalaryStructures === 'function') loadSalaryStructures();
            }, 'info');
        }
    });

    // ==================== Attendance Events ====================
    hrmsHubConnection.on('AttendanceClockIn', (data) => {
        console.log('[HRMS SignalR] AttendanceClockIn:', data);
        if (typeof onAttendanceClockIn === 'function') {
            onAttendanceClockIn(data);
        }
    });

    hrmsHubConnection.on('AttendanceClockOut', (data) => {
        console.log('[HRMS SignalR] AttendanceClockOut:', data);
        if (typeof onAttendanceClockOut === 'function') {
            onAttendanceClockOut(data);
        }
    });

    hrmsHubConnection.on('AttendanceRegularized', (data) => {
        console.log('[HRMS SignalR] AttendanceRegularized:', data);
        if (typeof onAttendanceRegularized === 'function') {
            onAttendanceRegularized(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Attendance Regularized', `Attendance regularized for ${name}`, 'info');
    });

    // ==================== Leave Events ====================
    hrmsHubConnection.on('LeaveRequestCreated', (data) => {
        console.log('[HRMS SignalR] LeaveRequestCreated:', data);
        if (typeof onLeaveRequestCreated === 'function') {
            onLeaveRequestCreated(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        const days = getProp(data, 'Days') || '';
        const leaveType = getProp(data, 'LeaveType') || 'leave';
        showHrmsNotification('Leave Request', `${name} applied for ${days} day(s) ${leaveType}`, 'info');
    });

    hrmsHubConnection.on('LeaveRequestApproved', (data) => {
        console.log('[HRMS SignalR] LeaveRequestApproved:', data);
        if (typeof onLeaveRequestApproved === 'function') {
            onLeaveRequestApproved(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Leave Approved', `${name}'s leave approved`, 'success');
    });

    hrmsHubConnection.on('LeaveRequestRejected', (data) => {
        console.log('[HRMS SignalR] LeaveRequestRejected:', data);
        if (typeof onLeaveRequestRejected === 'function') {
            onLeaveRequestRejected(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Leave Rejected', `${name}'s leave rejected`, 'error');
    });

    hrmsHubConnection.on('LeaveRequestCancelled', (data) => {
        console.log('[HRMS SignalR] LeaveRequestCancelled:', data);
        if (typeof onLeaveRequestCancelled === 'function') {
            onLeaveRequestCancelled(data);
        }
    });

    // ==================== Payroll Events ====================
    hrmsHubConnection.on('PayrollRunCreated', (data) => {
        console.log('[HRMS SignalR] PayrollRunCreated:', data);
        if (typeof onPayrollRunCreated === 'function') {
            onPayrollRunCreated(data);
        }
        const month = getProp(data, 'Month') || '';
        const year = getProp(data, 'Year') || '';
        showHrmsNotification('Payroll Run Created', `Payroll run for ${month}/${year} created`, 'info');
    });

    hrmsHubConnection.on('PayrollRunProcessed', (data) => {
        console.log('[HRMS SignalR] PayrollRunProcessed:', data);
        if (typeof onPayrollRunProcessed === 'function') {
            onPayrollRunProcessed(data);
        }
        const employeeCount = getProp(data, 'EmployeeCount') || 0;
        showHrmsNotification('Payroll Processed', `${employeeCount} payslips generated`, 'success');
    });

    hrmsHubConnection.on('PayrollRunApproved', (data) => {
        console.log('[HRMS SignalR] PayrollRunApproved:', data);
        if (typeof onPayrollRunApproved === 'function') {
            onPayrollRunApproved(data);
        }
        const month = getProp(data, 'Month') || '';
        const year = getProp(data, 'Year') || '';
        showHrmsNotification('Payroll Approved', `Payroll for ${month}/${year} approved`, 'success');
    });

    hrmsHubConnection.on('PayslipGenerated', (data) => {
        console.log('[HRMS SignalR] PayslipGenerated:', data);
        if (typeof onPayslipGenerated === 'function') {
            onPayslipGenerated(data);
        }
    });

    // ==================== Loan Events ====================
    hrmsHubConnection.on('LoanRequestCreated', (data) => {
        console.log('[HRMS SignalR] LoanRequestCreated:', data);
        if (typeof onLoanRequestCreated === 'function') {
            onLoanRequestCreated(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        const loanType = getProp(data, 'LoanType') || 'a';
        showHrmsNotification('Loan Request', `${name} requested ${loanType} loan`, 'info');
    });

    hrmsHubConnection.on('LoanApproved', (data) => {
        console.log('[HRMS SignalR] LoanApproved:', data);
        if (typeof onLoanApproved === 'function') {
            onLoanApproved(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Loan Approved', `${name}'s loan approved`, 'success');
    });

    hrmsHubConnection.on('LoanRejected', (data) => {
        console.log('[HRMS SignalR] LoanRejected:', data);
        if (typeof onLoanRejected === 'function') {
            onLoanRejected(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Loan Rejected', `${name}'s loan rejected`, 'error');
    });

    // ==================== Organization Events ====================
    hrmsHubConnection.on('OfficeCreated', (data) => {
        console.log('[HRMS SignalR] OfficeCreated:', data);
        if (typeof onOfficeCreated === 'function') {
            onOfficeCreated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'office' });
        }
    });

    hrmsHubConnection.on('OfficeUpdated', (data) => {
        console.log('[HRMS SignalR] OfficeUpdated:', data);
        if (typeof onOfficeUpdated === 'function') {
            onOfficeUpdated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'office' });
        }
    });

    hrmsHubConnection.on('DepartmentCreated', (data) => {
        console.log('[HRMS SignalR] DepartmentCreated:', data);
        if (typeof onDepartmentCreated === 'function') {
            onDepartmentCreated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'department' });
        }
    });

    hrmsHubConnection.on('DepartmentUpdated', (data) => {
        console.log('[HRMS SignalR] DepartmentUpdated:', data);
        if (typeof onDepartmentUpdated === 'function') {
            onDepartmentUpdated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'department' });
        }
    });

    hrmsHubConnection.on('DesignationCreated', (data) => {
        console.log('[HRMS SignalR] DesignationCreated:', data);
        if (typeof onDesignationCreated === 'function') {
            onDesignationCreated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'designation' });
        }
    });

    hrmsHubConnection.on('DesignationUpdated', (data) => {
        console.log('[HRMS SignalR] DesignationUpdated:', data);
        if (typeof onDesignationUpdated === 'function') {
            onDesignationUpdated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'designation' });
        }
    });

    hrmsHubConnection.on('ShiftCreated', (data) => {
        console.log('[HRMS SignalR] ShiftCreated:', data);
        if (typeof onShiftCreated === 'function') {
            onShiftCreated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'shift' });
        }
    });

    hrmsHubConnection.on('ShiftUpdated', (data) => {
        console.log('[HRMS SignalR] ShiftUpdated:', data);
        if (typeof onShiftUpdated === 'function') {
            onShiftUpdated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'shift' });
        }
    });

    hrmsHubConnection.on('HolidayCreated', (data) => {
        console.log('[HRMS SignalR] HolidayCreated:', data);
        if (typeof onHolidayCreated === 'function') {
            onHolidayCreated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'holiday' });
        }
    });

    hrmsHubConnection.on('HolidayUpdated', (data) => {
        console.log('[HRMS SignalR] HolidayUpdated:', data);
        if (typeof onHolidayUpdated === 'function') {
            onHolidayUpdated(data);
        }
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated({ ...data, EntityType: 'holiday' });
        }
    });

    // Generic OrganizationUpdated event (sent by backend for all org changes)
    hrmsHubConnection.on('OrganizationUpdated', (data) => {
        console.log('[HRMS SignalR] OrganizationUpdated:', data);
        if (typeof onOrganizationUpdated === 'function') {
            onOrganizationUpdated(data);
        }
        // Don't show toast here - the page that initiated the action already shows a toast
        // This handler is for refreshing data when other users make changes
    });

    // ==================== Adjustment Events ====================
    hrmsHubConnection.on('AdjustmentCreated', (data) => {
        console.log('[HRMS SignalR] AdjustmentCreated:', data);
        if (typeof onAdjustmentCreated === 'function') {
            onAdjustmentCreated(data);
        }
    });

    hrmsHubConnection.on('AdjustmentApproved', (data) => {
        console.log('[HRMS SignalR] AdjustmentApproved:', data);
        if (typeof onAdjustmentApproved === 'function') {
            onAdjustmentApproved(data);
        }
    });

    // ==================== Salary Structure Events ====================
    hrmsHubConnection.on('SalaryStructureEmployeeCountChanged', (data) => {
        console.log('[HRMS SignalR] SalaryStructureEmployeeCountChanged:', data);
        if (typeof onSalaryStructureEmployeeCountChanged === 'function') {
            onSalaryStructureEmployeeCountChanged(data);
        }
        // Auto-refresh salary structures list if on payroll page
        if (typeof loadSalaryStructures === 'function') {
            loadSalaryStructures();
        }
    });

    hrmsHubConnection.on('SalaryStructureCreated', (data) => {
        console.log('[HRMS SignalR] SalaryStructureCreated:', data);
        if (typeof onSalaryStructureCreated === 'function') {
            onSalaryStructureCreated(data);
        }
        if (typeof loadSalaryStructures === 'function') {
            loadSalaryStructures();
        }
    });

    hrmsHubConnection.on('SalaryStructureDeleted', (data) => {
        console.log('[HRMS SignalR] SalaryStructureDeleted:', data);
        if (typeof onSalaryStructureDeleted === 'function') {
            onSalaryStructureDeleted(data);
        }
        if (typeof loadSalaryStructures === 'function') {
            loadSalaryStructures();
        }
        const name = getProp(data, 'StructureName') || 'Salary structure';
        showHrmsNotification('Structure Deleted', `${name} has been deleted`, 'warning');
    });

    // ==================== Generic Data Refresh ====================
    hrmsHubConnection.on('DataRefresh', (data) => {
        console.log('[HRMS SignalR] DataRefresh:', data);
        if (typeof onDataRefresh === 'function') {
            onDataRefresh(data);
        }
        // Auto-refresh based on data type
        handleDataRefresh(data);
    });
}

/**
 * Handle generic data refresh events
 * @param {object} data - Refresh event data with DataType and Reason
 */
function handleDataRefresh(data) {
    const dataType = getProp(data, 'DataType') || '';
    switch (dataType) {
        case 'employees':
            if (typeof loadEmployees === 'function') loadEmployees();
            break;
        case 'salaries':
            if (typeof loadSalaries === 'function') loadSalaries();
            if (typeof loadEmployeeSalaries === 'function') loadEmployeeSalaries();
            break;
        case 'attendance':
            if (typeof loadAttendance === 'function') loadAttendance();
            if (typeof loadAttendanceRecords === 'function') loadAttendanceRecords();
            break;
        case 'leaves':
            if (typeof loadLeaveRequests === 'function') loadLeaveRequests();
            if (typeof loadLeaveBalances === 'function') loadLeaveBalances();
            break;
        case 'payroll':
            if (typeof loadPayrollRuns === 'function') loadPayrollRuns();
            if (typeof loadPayslips === 'function') loadPayslips();
            break;
        case 'organization':
            if (typeof loadOffices === 'function') loadOffices();
            if (typeof loadDepartments === 'function') loadDepartments();
            if (typeof loadDesignations === 'function') loadDesignations();
            if (typeof loadShifts === 'function') loadShifts();
            break;
    }
}

/**
 * Show notification for HRMS events
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {string} type - Notification type: success, info, warning, error
 */
function showHrmsNotification(title, message, type = 'info') {
    // Use showToast if available (defined in page)
    if (typeof showToast === 'function') {
        showToast(message, type);
    }
    // Fallback: console log
    else {
        console.log(`[HRMS ${type.toUpperCase()}] ${title}: ${message}`);
    }
}

/**
 * Show a refresh prompt toast for other users when data changes
 * Uses Toast.action() which shows Yes/No buttons
 * @param {string} message - Message describing what changed
 * @param {Function} refreshCallback - Function to call if user clicks Yes
 * @param {string} type - Toast type: info, warning, success, error
 */
async function showRefreshPrompt(message, refreshCallback, type = 'info') {
    // Use Toast.action if available
    if (typeof Toast !== 'undefined' && typeof Toast.action === 'function') {
        const shouldRefresh = await Toast.action(message, {
            type: type,
            title: 'Data Changed',
            yesText: 'Refresh',
            noText: 'Dismiss'
        });

        if (shouldRefresh && typeof refreshCallback === 'function') {
            refreshCallback();
        }
    }
    // Fallback to simple toast notification
    else {
        showHrmsNotification('Data Changed', message, type);
    }
}

/**
 * Disconnect from HRMS SignalR hub
 */
async function disconnectHrmsSignalR() {
    if (hrmsHubConnection) {
        try {
            await hrmsHubConnection.stop();
            hrmsConnectionState.isConnected = false;
            console.log('[HRMS SignalR] Disconnected');
        } catch (err) {
            console.error('[HRMS SignalR] Disconnect error:', err);
        }
    }
}

/**
 * Get current connection state
 * @returns {object} Connection state object
 */
function getHrmsConnectionState() {
    return { ...hrmsConnectionState };
}

/**
 * Reconnect to HRMS SignalR hub
 * @returns {Promise<boolean>} True if reconnected successfully
 */
async function reconnectHrmsSignalR() {
    await disconnectHrmsSignalR();
    return await initializeHrmsSignalR();
}

// Auto-initialize on page load if token exists
document.addEventListener('DOMContentLoaded', () => {
    // Delay initialization slightly to ensure other scripts are loaded
    setTimeout(() => {
        if (getAuthToken()) {
            initializeHrmsSignalR();
        }
    }, 500);
});

// Handle page visibility changes (reconnect when page becomes visible)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (getAuthToken() && !hrmsConnectionState.isConnected && !hrmsConnectionState.isReconnecting) {
            console.log('[HRMS SignalR] Page visible, checking connection...');
            initializeHrmsSignalR();
        }
    }
});
