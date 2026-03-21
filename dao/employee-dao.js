const db = require("../db/db-connection");
const Employee       = db.employee;
const EmployeeSalary = db.employee_salary;
const EmployeeLedger = db.employee_ledger;
const { Op } = require("sequelize");

// ─── Employee Code Generation ─────────────────────────────────────────────────

async function getNextEmployeeCode(locationCode) {
    const result = await db.sequelize.query(
        `SELECT employee_code FROM m_employee
         WHERE location_code = :locationCode
         ORDER BY employee_id DESC LIMIT 1`,
        { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
    );
    if (result.length === 0) return 'EMP-001';
    const last  = result[0].employee_code;
    const match = last.match(/EMP-(\d+)/);
    const next  = match ? parseInt(match[1]) + 1 : 1;
    return 'EMP-' + String(next).padStart(3, '0');
}

// ─── Employee List & Detail ───────────────────────────────────────────────────

module.exports = {

    getNextEmployeeCode,

    findAll: async (locationCode, includeInactive = false) => {
        const activeFilter = includeInactive ? '' : `AND e.is_active = 'Y'`;
        return db.sequelize.query(
            `SELECT
                e.employee_id,
                e.employee_code,
                e.name,
                e.nickname,
                e.mobile,
                e.designation,
                e.joined_date,
                e.left_date,
                e.is_active,
                e.person_id,
                p.Person_Name AS linked_user_name,
                -- current salary (latest active row)
                s.salary_amount,
                s.salary_type,
                s.effective_from AS salary_from,
                -- running ledger balance
                COALESCE(SUM(l.credit_amount), 0) - COALESCE(SUM(l.debit_amount), 0) AS balance
             FROM m_employee e
             LEFT JOIN m_persons p ON p.Person_id = e.person_id
             LEFT JOIN m_employee_salary s
               ON s.employee_id = e.employee_id
               AND s.effective_from = (
                   SELECT MAX(s2.effective_from)
                   FROM m_employee_salary s2
                   WHERE s2.employee_id = e.employee_id
                     AND s2.effective_from <= CURDATE()
               )
             LEFT JOIN t_employee_ledger l ON l.employee_id = e.employee_id
             WHERE e.location_code = :locationCode ${activeFilter}
             GROUP BY e.employee_id, s.salary_id
             ORDER BY e.is_active DESC, e.name ASC`,
            { replacements: { locationCode }, type: db.Sequelize.QueryTypes.SELECT }
        );
    },

    findById: async (employeeId) => {
        const rows = await db.sequelize.query(
            `SELECT
                e.*,
                p.Person_Name AS linked_user_name,
                s.salary_amount,
                s.salary_type,
                s.effective_from AS salary_from,
                COALESCE(SUM(l.credit_amount), 0) - COALESCE(SUM(l.debit_amount), 0) AS balance
             FROM m_employee e
             LEFT JOIN m_persons p ON p.Person_id = e.person_id
             LEFT JOIN m_employee_salary s
               ON s.employee_id = e.employee_id
               AND s.effective_from = (
                   SELECT MAX(s2.effective_from)
                   FROM m_employee_salary s2
                   WHERE s2.employee_id = e.employee_id
                     AND s2.effective_from <= CURDATE()
               )
             LEFT JOIN t_employee_ledger l ON l.employee_id = e.employee_id
             WHERE e.employee_id = :employeeId
             GROUP BY e.employee_id, s.salary_id`,
            { replacements: { employeeId }, type: db.Sequelize.QueryTypes.SELECT }
        );
        return rows[0] || null;
    },

    // ─── Salary History ───────────────────────────────────────────────────────

    getSalaryHistory: async (employeeId) => {
        return EmployeeSalary.findAll({
            where: { employee_id: employeeId },
            order: [['effective_from', 'DESC']]
        });
    },

    /**
     * Add a new salary revision.
     * Stamps effective_to on the previous active salary row so history is clean.
     */
    addSalaryRevision: async (employeeId, locationCode, salaryAmount, salaryType, effectiveFrom, notes, createdBy) => {
        // Close the current active salary one day before the new one starts
        await EmployeeSalary.update(
            { effective_to: new Date(new Date(effectiveFrom).getTime() - 86400000) },
            {
                where: {
                    employee_id:  employeeId,
                    effective_to: null
                }
            }
        );
        return EmployeeSalary.create({
            employee_id:    employeeId,
            location_code:  locationCode,
            salary_amount:  salaryAmount,
            salary_type:    salaryType || 'MONTHLY',
            effective_from: effectiveFrom,
            effective_to:   null,
            notes:          notes || null,
            created_by:     createdBy,
            creation_date:  new Date()
        });
    },

    // ─── Photo ────────────────────────────────────────────────────────────────

    updatePhotoDocId: async (employeeId, photoDocId, updatedBy) => {
        return Employee.update({
            photo_doc_id:  photoDocId,
            updated_by:    updatedBy,
            updation_date: new Date()
        }, { where: { employee_id: employeeId } });
    },

    removePhoto: async (employeeId, updatedBy) => {
        return Employee.update({
            photo_doc_id:  null,
            updated_by:    updatedBy,
            updation_date: new Date()
        }, { where: { employee_id: employeeId } });
    },

    // ─── Employee CRUD ────────────────────────────────────────────────────────

    create: async (data) => {
        const code = await getNextEmployeeCode(data.location_code);
        const emp  = await Employee.create({
            employee_code: code,
            location_code: data.location_code,
            name:          data.name.trim(),
            nickname:      data.nickname   ? data.nickname.trim() : null,
            mobile:        data.mobile     ? data.mobile.trim()   : null,
            designation:   data.designation || null,
            joined_date:   data.joined_date || null,
            left_date:     null,
            is_active:     'Y',
            person_id:     data.person_id  || null,
            notes:         data.notes      || null,
            created_by:    data.created_by,
            updated_by:    data.created_by,
            creation_date: new Date(),
            updation_date: new Date()
        });

        // If salary provided, create first salary record
        if (data.salary_amount && parseFloat(data.salary_amount) > 0) {
            await EmployeeSalary.create({
                employee_id:    emp.employee_id,
                location_code:  data.location_code,
                salary_amount:  parseFloat(data.salary_amount),
                salary_type:    data.salary_type || 'MONTHLY',
                effective_from: data.joined_date || new Date().toISOString().slice(0, 10),
                effective_to:   null,
                notes:          'Initial salary',
                created_by:     data.created_by,
                creation_date:  new Date()
            });
        }

        return emp;
    },

    update: async (employeeId, data) => {
        return Employee.update({
            name:          data.name.trim(),
            nickname:      data.nickname   ? data.nickname.trim() : null,
            mobile:        data.mobile     ? data.mobile.trim()   : null,
            designation:   data.designation || null,
            joined_date:   data.joined_date || null,
            left_date:     data.left_date   || null,
            person_id:     data.person_id   || null,
            notes:         data.notes       || null,
            updated_by:    data.updated_by,
            updation_date: new Date()
        }, { where: { employee_id: employeeId } });
    },

    deactivate: async (employeeId, updatedBy) => {
        return Employee.update({
            is_active:     'N',
            left_date:     new Date(),
            updated_by:    updatedBy,
            updation_date: new Date()
        }, { where: { employee_id: employeeId } });
    },

    reactivate: async (employeeId, updatedBy) => {
        return Employee.update({
            is_active:     'Y',
            left_date:     null,
            updated_by:    updatedBy,
            updation_date: new Date()
        }, { where: { employee_id: employeeId } });
    },

    // ─── Ledger ───────────────────────────────────────────────────────────────

    getLedger: async (employeeId) => {
        return db.sequelize.query(
            `SELECT
                ledger_id,
                txn_date,
                txn_type,
                credit_amount,
                debit_amount,
                description,
                reference_id,
                salary_period,
                created_by,
                creation_date
             FROM t_employee_ledger
             WHERE employee_id = :employeeId
             ORDER BY txn_date ASC, ledger_id ASC`,
            { replacements: { employeeId }, type: db.Sequelize.QueryTypes.SELECT }
        );
    },

    addLedgerEntry: async (data) => {
        const isCredit = ['SALARY_CREDIT', 'ADJUSTMENT_CR'].includes(data.txn_type);
        return EmployeeLedger.create({
            employee_id:   data.employee_id,
            location_code: data.location_code,
            txn_date:      data.txn_date,
            txn_type:      data.txn_type,
            credit_amount: isCredit ? parseFloat(data.amount) : 0,
            debit_amount:  isCredit ? 0 : parseFloat(data.amount),
            description:   data.description   || null,
            reference_id:  data.reference_id  || null,
            salary_period: data.txn_type === 'SALARY_CREDIT' ? (data.salary_period || null) : null,
            created_by:    data.created_by,
            creation_date: new Date()
        });
    },

    /**
     * Prevent duplicate salary generation for the same employee + period.
     */
    salaryPeriodAlreadyGenerated: async (employeeId, salaryPeriod) => {
        const count = await EmployeeLedger.count({
            where: { employee_id: employeeId, txn_type: 'SALARY_CREDIT', salary_period: salaryPeriod }
        });
        return count > 0;
    },

    /**
     * Generate SALARY_CREDIT entries for all active employees in a location.
     * Uses each employee's current salary from m_employee_salary.
     * Skips employees without a salary record or who already have an entry for this period.
     */
    generateSalaryForPeriod: async (locationCode, salaryPeriod, txnDate, createdBy) => {
        const employees = await db.sequelize.query(
            `SELECT e.employee_id, e.employee_code, e.name, s.salary_amount, s.salary_type
             FROM m_employee e
             INNER JOIN m_employee_salary s
               ON s.employee_id = e.employee_id
               AND s.effective_from = (
                   SELECT MAX(s2.effective_from)
                   FROM m_employee_salary s2
                   WHERE s2.employee_id = e.employee_id
                     AND s2.effective_from <= :txnDate
               )
             WHERE e.location_code = :locationCode
               AND e.is_active = 'Y'`,
            { replacements: { locationCode, txnDate }, type: db.Sequelize.QueryTypes.SELECT }
        );

        let generated = 0, skipped = 0;
        const detail = [];

        for (const emp of employees) {
            const already = await module.exports.salaryPeriodAlreadyGenerated(emp.employee_id, salaryPeriod);
            if (already) {
                skipped++;
                detail.push({ name: emp.name, code: emp.employee_code, amount: emp.salary_amount, status: 'SKIPPED' });
                continue;
            }
            await EmployeeLedger.create({
                employee_id:   emp.employee_id,
                location_code: locationCode,
                txn_date:      txnDate,
                txn_type:      'SALARY_CREDIT',
                credit_amount: parseFloat(emp.salary_amount),
                debit_amount:  0,
                description:   `Salary for ${salaryPeriod}`,
                salary_period: salaryPeriod,
                created_by:    createdBy,
                creation_date: new Date()
            });
            generated++;
            detail.push({ name: emp.name, code: emp.employee_code, amount: emp.salary_amount, status: 'GENERATED' });
        }

        return { generated, skipped, total: employees.length, detail };
    },

    deleteLedgerEntry: async (ledgerId, employeeId) => {
        return EmployeeLedger.destroy({
            where: { ledger_id: ledgerId, employee_id: employeeId }
        });
    }
};
