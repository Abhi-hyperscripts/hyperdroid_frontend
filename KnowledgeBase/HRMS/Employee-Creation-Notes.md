# Employee Creation Documentation Notes

This file documents the employee creation workflow and screenshot references for future Employee Management how-to guide.

## Employee Creation Workflow Summary

### 4-Step Wizard Process

The Add Employee modal uses a 4-step wizard:
1. **Step 1: Personal** - User account, photo, employee code, contact, DOB, gender
2. **Step 2: Employment** - Office, department, designation, shift, manager, employment type, dates
3. **Step 3: Banking** - Account holder, bank name, account number, IFSC, branch
4. **Step 4: Documents** - PAN (number + front/back), Aadhar (number + front/back), Passport (optional)

---

## Existing Screenshots (in `images/employees/` folder)

| Filename | Description |
|----------|-------------|
| `emp-01-page-empty.png` | Employees page with no employees |
| `emp-02-add-button.png` | Add Employee button highlighted |
| `emp-03-step1-empty.png` | Step 1 (Personal) empty form |
| `emp-04-user-dropdown.png` | User account dropdown open showing available users |
| `emp-05-step1-filled.png` | Step 1 with all fields filled |
| `emp-06-step2-employment-empty.png` | Step 2 (Employment) empty form |
| `emp-07-step2-employment-filled.png` | Step 2 with all fields filled |
| `emp-08-step3-banking-empty.png` | Step 3 (Banking) empty form |
| `emp-09-step3-banking-filled.png` | Step 3 with all fields filled |
| `emp-10-step4-documents-empty.png` | Step 4 (Documents) empty form |
| `emp-11-step4-documents-filled.png` | Step 4 with numbers filled |
| `emp-12-step1-photo-uploaded.png` | Photo upload completed |
| `emp-13-step4-all-docs-uploaded.png` | All 4 document images uploaded |
| `emp-14-employee-created.png` | Success - employee appears in list |
| `emp-15-salary-modal-empty.png` | Salary assignment modal (empty) |
| `emp-16-salary-modal-filled.png` | Salary modal with structure and CTC |
| `emp-17-salary-assigned-success.png` | Success toast after salary assignment |
| `emp-18-employee-with-salary.png` | Employee list showing CTC value |

---

## Step-by-Step Instructions

### Step 1: Personal Information

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| User Account | Yes | Dropdown of users without employee profiles |
| Photo | Yes | Employee profile photo (image upload) |
| Employee Code | Yes | Unique employee ID (e.g., EMP001) |
| Work Phone | Yes | Phone number with country code |
| Date of Birth | Yes | DOB in YYYY-MM-DD format |
| Gender | No | Male/Female/Other |

**UI Elements:**
- User dropdown shows: `{email} ({name})`
- After selection, Name and Email display below
- Photo shows placeholder until uploaded
- Upload/Remove buttons appear after photo upload

### Step 2: Employment Details

**Fields:**
| Field | Required | Description | Dependencies |
|-------|----------|-------------|--------------|
| Office | Yes | Work location | Unlocks Department, Shift |
| Department | Yes | Organizational unit | Depends on Office, Unlocks Designation |
| Designation | Yes | Job title | Depends on Department |
| Shift | No | Work schedule | Depends on Office |
| Reporting Manager | No | Direct supervisor | Shows existing employees |
| Employment Type | Yes | Full Time/Part Time/Contract/Intern/Temporary | Default: Full Time |
| Date of Joining | Yes | Start date | - |
| Probation End Date | Yes | End of probation | - |

**Geofence Attendance Toggle:**
- Checkbox to enable location-based attendance
- Overrides office-level geofence setting

### Step 3: Banking Details

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| Account Holder Name | Yes | Name as per bank account |
| Bank Name | Yes | e.g., HDFC Bank, SBI, ICICI |
| Account Number | Yes | Bank account number |
| Confirm Account Number | Yes | Must match Account Number |
| IFSC Code | Yes | 11-character bank branch code |
| Branch Name | No | Branch name/location |

### Step 4: Documents

**Mandatory Documents:**
| Document | Fields | Uploads Required |
|----------|--------|------------------|
| PAN Card | PAN Number (10 chars, format: ABCDE1234F) | Front + Back images |
| Aadhar Card | Aadhar Number (12 digits) | Front + Back images |

**Optional Documents:**
| Document | Fields | Uploads Required |
|----------|--------|------------------|
| Passport | Passport Number + Expiry Date | 1 image |

**Upload UI:**
- Click upload icon to trigger file chooser
- After upload, shows filename with remove button
- All 4 mandatory uploads required before Save

---

## Salary Assignment

After creating an employee, salary must be assigned separately.

### How to Access
1. Find employee in list
2. Hover over Actions column to see button tooltips
3. Click 5th button (Salary icon - wallet/money symbol)

### Salary Modal Fields
| Field | Required | Description |
|-------|----------|-------------|
| Salary Structure | Yes | Dropdown of available structures |
| Annual CTC | Yes | Total annual compensation in ₹ |
| Effective From | Yes | Date salary takes effect (default: today) |

### Salary Breakdown Preview
After selecting structure and entering CTC:
- Shows calculated monthly breakdown
- Earnings components with amounts
- Deductions components with amounts
- Net monthly salary

---

## Test Employees Created (for Payroll Demo)

| Name | Code | Department | Designation | CTC | Tax Slab |
|------|------|------------|-------------|-----|----------|
| Praveen Babu | EMP001 | Engineering | Software Engineer | ₹6,00,000 | Medium |
| Dev Kumar | EMP002 | Engineering | Senior Software Engineer | ₹12,00,000 | Higher |
| Aradhna Pal | EMP003 | Human Resources | HR Director | ₹4,00,000 | Lower |

---

## Action Buttons (Left to Right)

From hovering over employee row actions:
1. **View** - View employee details
2. **History** - Manager change history
3. **Edit** - Edit employee information
4. **Transfer** - Transfer to different department/manager
5. **Salary** - Assign/manage salary
6. **Delete** - Deactivate employee

---

## Screenshots Still Needed for Complete Documentation

1. Employee detail view modal (all tabs)
2. Edit employee modal
3. Transfer employee modal
4. Manager history modal
5. Delete confirmation dialog
6. Employee filters demonstration
7. Search functionality
8. Bulk operations (if available)
9. Employee salary breakdown (detailed view)
10. Salary revision workflow

---

## Placeholder Image Used

For document uploads during testing, used:
`/Frontend/KnowledgeBase/HRMS/images/organization/offices-tab.png`

This should be replaced with appropriate sample document images in final documentation.

---

## Known Issues / Notes

1. **Browser crashes on Save Employee** - Happens intermittently when clicking Save Employee button. Employee usually gets created despite crash. Recover by closing and re-navigating to employees page.

2. **CTC shows ₹0 immediately after creation** - Need to refresh page to see updated CTC after salary assignment.

3. **Field validation** - "Employee code is required" error can occur even when field appears filled. Clear and re-fill the field to fix.

4. **Cascading dropdowns** - Department dropdown depends on Office selection; Designation depends on Department selection.

---

## Document Conversion Notes

When converting to HTML:
- Use Organization-Setup.html as template
- Include all field description tables
- Add before/after screenshots for each step
- Include tips boxes for common issues
- Add warning boxes for mandatory fields
- Create visual workflow diagram
