const EmployeeDao     = require('../dao/employee-dao');
const LookupDao       = require('../dao/lookup-dao');
const DocumentStoreDao = require('../dao/document-store-dao');
const { getLocationConfigValue } = require('../utils/location-config');
const dateFormat      = require('dateformat');
const db              = require('../db/db-connection');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
    return d ? dateFormat(d, 'yyyy-mm-dd') : null;
}

function buildRunningBalance(entries) {
    let running = 0;
    return entries.map(e => {
        running += parseFloat(e.credit_amount || 0) - parseFloat(e.debit_amount || 0);
        return {
            ...e,
            txn_date:        fmtDate(e.txn_date),
            creation_date:   fmtDate(e.creation_date),
            credit_amount:   parseFloat(e.credit_amount || 0).toFixed(2),
            debit_amount:    parseFloat(e.debit_amount  || 0).toFixed(2),
            running_balance: running.toFixed(2)
        };
    });
}

// ─── List page ────────────────────────────────────────────────────────────────

module.exports.getListPage = async (req, res) => {
    try {
        const locationCode    = req.user.location_code;
        const includeInactive = req.query.show_inactive === '1';

        const [employees, designations, autoSalary, users] = await Promise.all([
            EmployeeDao.findAll(locationCode, includeInactive),
            LookupDao.getDesignations(locationCode),
            getLocationConfigValue(locationCode, 'EMPLOYEE_AUTO_SALARY', 'N'),
            db.sequelize.query(
                `SELECT Person_id, Person_Name, User_Name FROM m_persons
                 WHERE location_code = :locationCode AND effective_end_date > CURDATE()
                 ORDER BY Person_Name`,
                { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
            )
        ]);

        const mapped = employees.map(e => ({
            ...e,
            joined_date:   fmtDate(e.joined_date),
            left_date:     fmtDate(e.left_date),
            salary_from:   fmtDate(e.salary_from),
            salary_amount: e.salary_amount ? parseFloat(e.salary_amount).toFixed(2) : null,
            balance:       parseFloat(e.balance || 0).toFixed(2),
            balance_sign:  parseFloat(e.balance || 0) >= 0 ? 'credit' : 'debit'
        }));

        res.render('employee/employee-list', {
            title:        'Employees',
            user:         req.user,
            employees:    mapped,
            designations,
            users,
            autoSalary:   autoSalary === 'Y',
            showInactive: includeInactive,
            canAdd:       req.user.isAdmin,
            canEdit:      req.user.isAdmin,
            canDisable:   req.user.isAdmin,
            canLedger:    req.user.isAdmin,
            canGenSalary: req.user.isAdmin
        });
    } catch (err) {
        console.error('employee getListPage error:', err);
        req.flash('error', 'Failed to load employee list');
        res.redirect('/');
    }
};

// ─── Detail / Ledger page ─────────────────────────────────────────────────────

module.exports.getDetailPage = async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id);
        const [employee, rawLedger, salaryHistory, banks] = await Promise.all([
            EmployeeDao.findById(employeeId),
            EmployeeDao.getLedger(employeeId),
            EmployeeDao.getSalaryHistory(employeeId),
            db.sequelize.query(
                `SELECT bank_id, bank_name, account_nickname FROM m_bank
                 WHERE location_code = :locationCode AND active_flag = 'Y'
                 ORDER BY bank_name`,
                { replacements: { locationCode: req.user.location_code }, type: db.Sequelize.QueryTypes.SELECT }
            )
        ]);

        if (!employee) {
            req.flash('error', 'Employee not found');
            return res.redirect('/employees');
        }

        const ledger  = buildRunningBalance(rawLedger);
        const balance = ledger.length > 0
            ? parseFloat(ledger[ledger.length - 1].running_balance)
            : 0;

        const salaryHistoryMapped = salaryHistory.map(s => ({
            salary_id:      s.salary_id,
            salary_amount:  parseFloat(s.salary_amount).toFixed(2),
            salary_type:    s.salary_type,
            effective_from: fmtDate(s.effective_from),
            effective_to:   fmtDate(s.effective_to),
            notes:          s.notes
        }));

        res.render('employee/employee-detail', {
            title:    `${employee.name} (${employee.employee_code})`,
            user:     req.user,
            employee: {
                ...employee,
                joined_date:   fmtDate(employee.joined_date),
                left_date:     fmtDate(employee.left_date),
                salary_amount: employee.salary_amount ? parseFloat(employee.salary_amount).toFixed(2) : null,
                salary_from:   fmtDate(employee.salary_from),
                balance:       balance.toFixed(2),
                balance_sign:  balance >= 0 ? 'credit' : 'debit'
            },
            ledger,
            salaryHistory: salaryHistoryMapped,
            banks,
            canLedger:  req.user.isAdmin,
            canEdit:    req.user.isAdmin
        });
    } catch (err) {
        console.error('employee getDetailPage error:', err);
        req.flash('error', 'Failed to load employee details');
        res.redirect('/employees');
    }
};

// ─── Create employee ──────────────────────────────────────────────────────────

module.exports.createEmployee = async (req, res) => {
    try {
        await EmployeeDao.create({
            location_code:  req.user.location_code,
            name:           req.body.name,
            nickname:       req.body.nickname,
            mobile:         req.body.mobile,
            designation:    req.body.designation,
            salary_amount:  req.body.salary_amount,
            salary_type:    req.body.salary_type || 'MONTHLY',
            joined_date:    req.body.joined_date || null,
            person_id:      req.body.person_id   || null,
            notes:          req.body.notes,
            created_by:     req.user.User_Name
        });
        req.flash('success', 'Employee added successfully');
    } catch (err) {
        console.error('employee createEmployee error:', err);
        req.flash('error', 'Failed to add employee');
    }
    res.redirect('/employees');
};

// ─── Update employee (profile only — no salary fields) ────────────────────────

module.exports.updateEmployee = async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id);
        await EmployeeDao.update(employeeId, {
            name:        req.body.name,
            nickname:    req.body.nickname,
            mobile:      req.body.mobile,
            designation: req.body.designation,
            joined_date: req.body.joined_date || null,
            left_date:   req.body.left_date   || null,
            person_id:   req.body.person_id   || null,
            notes:       req.body.notes,
            updated_by:  req.user.User_Name
        });
        res.json({ success: true, message: 'Employee updated' });
    } catch (err) {
        console.error('employee updateEmployee error:', err);
        res.status(500).json({ success: false, message: 'Failed to update employee' });
    }
};

// ─── Add salary revision ──────────────────────────────────────────────────────

module.exports.addSalaryRevision = async (req, res) => {
    try {
        const employeeId   = parseInt(req.params.id);
        const salaryAmount = parseFloat(req.body.salary_amount);
        const effectiveFrom = req.body.effective_from;

        if (!salaryAmount || salaryAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Salary amount must be greater than zero' });
        }
        if (!effectiveFrom) {
            return res.status(400).json({ success: false, message: 'Effective from date is required' });
        }

        // Validate employee belongs to this location
        const employee = await EmployeeDao.findById(employeeId);
        if (!employee || employee.location_code !== req.user.location_code) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        await EmployeeDao.addSalaryRevision(
            employeeId,
            req.user.location_code,
            salaryAmount,
            req.body.salary_type || 'MONTHLY',
            effectiveFrom,
            req.body.notes,
            req.user.User_Name
        );
        res.json({ success: true, message: 'Salary revision saved' });
    } catch (err) {
        console.error('addSalaryRevision error:', err);
        res.status(500).json({ success: false, message: 'Failed to save salary revision' });
    }
};

// ─── Deactivate / Reactivate ──────────────────────────────────────────────────

module.exports.deactivateEmployee = async (req, res) => {
    try {
        await EmployeeDao.deactivate(parseInt(req.params.id), req.user.User_Name);
        res.json({ success: true, message: 'Employee deactivated' });
    } catch (err) {
        console.error('employee deactivate error:', err);
        res.status(500).json({ success: false, message: 'Failed to deactivate' });
    }
};

module.exports.reactivateEmployee = async (req, res) => {
    try {
        await EmployeeDao.reactivate(parseInt(req.params.id), req.user.User_Name);
        res.json({ success: true, message: 'Employee reactivated' });
    } catch (err) {
        console.error('employee reactivate error:', err);
        res.status(500).json({ success: false, message: 'Failed to reactivate' });
    }
};

// ─── Add ledger entry ─────────────────────────────────────────────────────────

module.exports.addLedgerEntry = async (req, res) => {
    try {
        const employeeId = parseInt(req.body.employee_id);

        const employee = await EmployeeDao.findById(employeeId);
        if (!employee || employee.location_code !== req.user.location_code) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const validTypes = ['SALARY_CREDIT', 'ADVANCE', 'PAYMENT', 'BANK_PAYMENT', 'ADVANCE_RECOVERY', 'DEDUCTION', 'ADJUSTMENT_CR', 'ADJUSTMENT_DR'];
        if (!validTypes.includes(req.body.txn_type)) {
            return res.status(400).json({ success: false, message: 'Invalid transaction type' });
        }

        if (req.body.txn_type === 'BANK_PAYMENT' && !req.body.bank_id) {
            return res.status(400).json({ success: false, message: 'Bank is required for bank payments' });
        }

        const amount = parseFloat(req.body.amount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        }

        await EmployeeDao.addLedgerEntry({
            employee_id:   employeeId,
            location_code: req.user.location_code,
            txn_date:      req.body.txn_date,
            txn_type:      req.body.txn_type,
            amount,
            description:   req.body.description,
            reference_id:  req.body.reference_id || null,
            salary_period: req.body.salary_period || null,
            bank_id:       req.body.bank_id       || null,
            created_by:    req.user.User_Name
        });

        res.json({ success: true, message: 'Entry added' });
    } catch (err) {
        console.error('addLedgerEntry error:', err);
        res.status(500).json({ success: false, message: 'Failed to add entry' });
    }
};

// ─── Delete ledger entry ──────────────────────────────────────────────────────

module.exports.deleteLedgerEntry = async (req, res) => {
    try {
        const ledgerId   = parseInt(req.params.ledger_id);
        const employeeId = parseInt(req.params.id);

        const entry = await EmployeeDao.findLedgerEntry(ledgerId, employeeId);
        if (!entry) {
            return res.status(404).json({ success: false, message: 'Entry not found' });
        }

        const cashflowEligible = ['ADVANCE', 'PAYMENT', 'ADVANCE_RECOVERY'].includes(entry.txn_type);
        if (cashflowEligible) {
            if (entry.cashflow_date) {
                return res.status(400).json({ success: false, message: 'This entry has been closed in a cashflow and cannot be deleted.' });
            }
            if (entry.pending_cashflow_id) {
                return res.status(400).json({ success: false, message: 'This entry is currently claimed by an open cashflow. Delete or regenerate the cashflow first.' });
            }
        }

        const allowedDays = parseInt(
            await getLocationConfigValue(req.user.location_code, 'EMPLOYEE_LEDGER_DELETE_DAYS', '1')
        );
        const ageInDays = Math.floor((Date.now() - new Date(entry.creation_date).getTime()) / 86400000);
        if (ageInDays > allowedDays) {
            return res.status(400).json({ success: false, message: `Entries can only be deleted within ${allowedDays} day(s) of creation.` });
        }

        await EmployeeDao.deleteLedgerEntry(ledgerId, employeeId, req.user.User_Name);
        res.json({ success: true, message: 'Entry deleted' });
    } catch (err) {
        console.error('deleteLedgerEntry error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete entry' });
    }
};

// ─── Generate salary for period ───────────────────────────────────────────────

module.exports.generateSalary = async (req, res) => {
    try {
        const { salary_period, txn_date } = req.body;
        if (!salary_period) {
            return res.status(400).json({ success: false, message: 'salary_period is required' });
        }
        const result = await EmployeeDao.generateSalaryForPeriod(
            req.user.location_code,
            salary_period,
            txn_date || new Date().toISOString().slice(0, 10),
            req.user.User_Name
        );
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('generateSalary error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate salary' });
    }
};

// ─── Report page ──────────────────────────────────────────────────────────────

module.exports.getReportPage = async (req, res) => {
    try {
        const locationCode = req.user.location_code;
        const employees    = await EmployeeDao.findAll(locationCode, false);

        const today    = new Date();
        const fromDate = new Date(today.getFullYear(), today.getMonth(), 1)
                            .toISOString().slice(0, 10);
        const toDate   = today.toISOString().slice(0, 10);

        res.render('employee/employee-report', {
            title:     'Employee Report',
            user:      req.user,
            employees: employees.map(e => ({ employee_id: e.employee_id, name: e.name, employee_code: e.employee_code })),
            fromDate,
            toDate
        });
    } catch (err) {
        console.error('employee getReportPage error:', err);
        req.flash('error', 'Failed to load report');
        res.redirect('/employees');
    }
};

// ─── Report API: employee statement ───────────────────────────────────────────

module.exports.getStatementData = async (req, res) => {
    try {
        const employeeId = parseInt(req.query.employee_id);
        const fromDate   = req.query.from;
        const toDate     = req.query.to;

        if (!employeeId || !fromDate || !toDate) {
            return res.status(400).json({ success: false, message: 'employee_id, from and to are required' });
        }

        const employee = await EmployeeDao.findById(employeeId);
        if (!employee || employee.location_code !== req.user.location_code) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const rawEntries = await EmployeeDao.getStatement(employeeId, fromDate, toDate);

        let running = 0;
        const entries = rawEntries.map(e => {
            running += parseFloat(e.credit_amount || 0) - parseFloat(e.debit_amount || 0);
            return {
                ...e,
                txn_date:        fmtDate(e.txn_date),
                credit_amount:   parseFloat(e.credit_amount || 0).toFixed(2),
                debit_amount:    parseFloat(e.debit_amount  || 0).toFixed(2),
                running_balance: running.toFixed(2)
            };
        });

        res.json({ success: true, employee: employee.name, entries, closing_balance: running.toFixed(2) });
    } catch (err) {
        console.error('getStatementData error:', err);
        res.status(500).json({ success: false, message: 'Failed to load statement' });
    }
};

// ─── Report API: spending summary ─────────────────────────────────────────────

module.exports.getSummaryData = async (req, res) => {
    try {
        const fromDate = req.query.from;
        const toDate   = req.query.to;

        if (!fromDate || !toDate) {
            return res.status(400).json({ success: false, message: 'from and to are required' });
        }

        const rows = await EmployeeDao.getSpendingSummary(req.user.location_code, fromDate, toDate);

        const summary = rows.map(r => ({
            ...r,
            salary_credited: parseFloat(r.salary_credited || 0).toFixed(2),
            cash_paid:       parseFloat(r.cash_paid       || 0).toFixed(2),
            bank_paid:       parseFloat(r.bank_paid       || 0).toFixed(2),
            recovered:       parseFloat(r.recovered       || 0).toFixed(2),
            deductions:      parseFloat(r.deductions      || 0).toFixed(2),
            net_balance:     parseFloat(r.net_balance     || 0).toFixed(2)
        }));

        res.json({ success: true, summary });
    } catch (err) {
        console.error('getSummaryData error:', err);
        res.status(500).json({ success: false, message: 'Failed to load summary' });
    }
};

// ─── Photo upload ─────────────────────────────────────────────────────────────

module.exports.uploadPhoto = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const employeeId = parseInt(req.params.id);
        const employee   = await EmployeeDao.findById(employeeId);

        if (!employee || employee.location_code !== req.user.location_code) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Enforce configurable size limit (DOC_MAX_UPLOAD_MB, default 2)
        const maxMb    = parseFloat(await getLocationConfigValue(req.user.location_code, 'DOC_MAX_UPLOAD_MB', '2'));
        const maxBytes = maxMb * 1024 * 1024;
        if (req.file.size > maxBytes) {
            return res.status(400).json({ success: false, message: `Image must be ${maxMb} MB or smaller` });
        }

        // Delete old photo doc if one exists
        if (employee.photo_doc_id) {
            await DocumentStoreDao.deleteById(employee.photo_doc_id);
        }

        // Store new BLOB in document store
        const doc = await DocumentStoreDao.create({
            entity_type:   'EMPLOYEE',
            entity_id:     employeeId,
            doc_category:  'PROFILE_PHOTO',
            file_name:     req.file.originalname,
            mime_type:     req.file.mimetype,
            file_size:     req.file.size,
            file_data:     req.file.buffer,
            location_code: req.user.location_code,
            created_by:    req.user.User_Name
        });

        await EmployeeDao.updatePhotoDocId(employeeId, doc.doc_id, req.user.User_Name);
        res.json({ success: true, photo_doc_id: doc.doc_id, photo_url: `/documents/${doc.doc_id}` });
    } catch (err) {
        console.error('uploadPhoto error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload photo' });
    }
};

// ─── Photo remove ─────────────────────────────────────────────────────────────

module.exports.removePhoto = async (req, res) => {
    try {
        const employeeId = parseInt(req.params.id);
        const employee   = await EmployeeDao.findById(employeeId);

        if (!employee || employee.location_code !== req.user.location_code) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        if (employee.photo_doc_id) {
            await DocumentStoreDao.deleteById(employee.photo_doc_id);
        }

        await EmployeeDao.removePhoto(employeeId, req.user.User_Name);
        res.json({ success: true });
    } catch (err) {
        console.error('removePhoto error:', err);
        res.status(500).json({ success: false, message: 'Failed to remove photo' });
    }
};
