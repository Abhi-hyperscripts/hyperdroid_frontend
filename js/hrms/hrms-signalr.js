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
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Employee Created', `${name} has been added`, 'success');
    });

    hrmsHubConnection.on('EmployeeUpdated', (data) => {
        console.log('[HRMS SignalR] EmployeeUpdated:', data);
        if (typeof onEmployeeUpdated === 'function') {
            onEmployeeUpdated(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Employee Updated', `${name} profile updated`, 'info');
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
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Salary Assigned', `Salary assigned to ${name}`, 'success');
    });

    hrmsHubConnection.on('SalaryUpdated', (data) => {
        console.log('[HRMS SignalR] SalaryUpdated:', data);
        if (typeof onSalaryUpdated === 'function') {
            onSalaryUpdated(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Salary Updated', `Salary updated for ${name}`, 'info');
    });

    hrmsHubConnection.on('SalaryRevised', (data) => {
        console.log('[HRMS SignalR] SalaryRevised:', data);
        if (typeof onSalaryRevised === 'function') {
            onSalaryRevised(data);
        }
        const name = getProp(data, 'EmployeeName') || 'Employee';
        showHrmsNotification('Salary Revised', `Salary revised for ${name}`, 'info');
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
        // Show notification based on entity type
        const entityType = getProp(data, 'EntityType') || 'organization';
        const action = getProp(data, 'Action') || 'updated';
        const entityName = getProp(data, 'EntityName') || entityType;
        showHrmsNotification(`${entityType.charAt(0).toUpperCase() + entityType.slice(1)} ${action}`,
            `${entityName} has been ${action}`,
            action === 'deleted' ? 'warning' : 'info');
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
