// dao/platform-billing-dao.js
const db = require("../db/db-connection");
const { Op, QueryTypes } = require("sequelize");

const PlatformBillingDao = {

    // ─── Billing plans ─────────────────────────────────────────────────────

    // Active billing plan for a location as of a given date (YYYY-MM-DD)
    getActiveBillingPlan: (locationCode, asOfDate) => {
        return db.location_billing_plan.findOne({
            where: {
                location_code: locationCode,
                effective_start_date: { [Op.lte]: asOfDate },
                effective_end_date: { [Op.gte]: asOfDate }
            },
            order: [['effective_start_date', 'DESC']]
        });
    },

    // All active billing plans as of a date, joined to active locations —
    // drives the monthly generation loop. Pass locationCode to restrict to
    // a single location (e.g. for a first test run or a manual backfill).
    getActiveBillingPlansForGeneration: (asOfDate, locationCode) => {
        return db.sequelize.query(
            `SELECT
                bp.billing_plan_id, bp.location_code, bp.plan_duration_months,
                bp.plan_rate, bp.discount_type, bp.discount_value, bp.trial_end_date,
                l.location_name
            FROM m_location_billing_plan bp
            JOIN m_location l ON l.location_code = bp.location_code
            WHERE :asOfDate BETWEEN bp.effective_start_date AND bp.effective_end_date
              AND l.start_date <= :asOfDate
              AND l.effective_end_date > :asOfDate
              AND (:locationCode IS NULL OR bp.location_code = :locationCode)
            ORDER BY bp.location_code`,
            {
                replacements: { asOfDate, locationCode: locationCode || null },
                type: QueryTypes.SELECT
            }
        );
    },

    upsertBillingPlan: (planData) => {
        return db.location_billing_plan.create(planData);
    },

    // Current billing plan (any effective_end_date >= today) for every location that has one
    findAllCurrentBillingPlans: () => {
        return db.sequelize.query(
            `SELECT bp.billing_plan_id, bp.location_code, l.location_name, bp.plan_duration_months,
                    bp.plan_rate, bp.discount_type, bp.discount_value, bp.trial_end_date,
                    bp.effective_start_date, bp.remarks
             FROM m_location_billing_plan bp
             JOIN m_location l ON l.location_code = bp.location_code
             WHERE bp.effective_end_date = '9999-12-31'
             ORDER BY l.location_name`,
            { type: QueryTypes.SELECT }
        );
    },

    // Close out the current open-ended plan for a location (effective_end_date -> day before newStartDate)
    closeBillingPlan: (locationCode, dayBeforeNewStart) => {
        return db.location_billing_plan.update(
            { effective_end_date: dayBeforeNewStart },
            { where: { location_code: locationCode, effective_end_date: '9999-12-31' } }
        );
    },

    // ─── Invoices ──────────────────────────────────────────────────────────

    // Any non-cancelled invoice whose period already covers this date
    // (used to skip locations already billed for the period, e.g. annual plans)
    findCoveringInvoice: (locationCode, date) => {
        return db.platform_invoice.findOne({
            where: {
                location_code: locationCode,
                status: { [Op.ne]: 'CANCELLED' },
                period_start_date: { [Op.lte]: date },
                period_end_date: { [Op.gte]: date }
            }
        });
    },

    createInvoice: (invoiceData, items) => {
        return db.sequelize.transaction(async (t) => {
            const invoice = await db.platform_invoice.create(invoiceData, { transaction: t });
            const rows = items.map((it, idx) => ({
                invoice_id: invoice.invoice_id,
                description: it.description,
                amount: it.amount,
                sort_order: idx + 1
            }));
            await db.platform_invoice_items.bulkCreate(rows, { transaction: t });
            return invoice;
        });
    },

    // Invoice + line items + billed-to location details, for the printable PDF
    findInvoiceForPrint: async (invoiceId) => {
        const rows = await db.sequelize.query(
            `SELECT pi.invoice_id, pi.location_code, pi.invoice_number, pi.period_start_date, pi.period_end_date,
                    pi.gross_amount, pi.discount_amount, pi.net_amount, pi.due_date, pi.status, pi.generated_date,
                    l.location_name, l.address, l.gst_number, l.phone
             FROM t_platform_invoice pi
             JOIN m_location l ON l.location_code = pi.location_code
             WHERE pi.invoice_id = :invoiceId`,
            { replacements: { invoiceId }, type: QueryTypes.SELECT }
        );
        if (!rows.length) return null;
        const invoice = rows[0];
        invoice.items = await db.platform_invoice_items.findAll({
            where: { invoice_id: invoiceId },
            order: [['sort_order', 'ASC']]
        });
        return invoice;
    },

    findInvoiceById: (invoiceId) => {
        return db.platform_invoice.findOne({
            where: { invoice_id: invoiceId },
            include: [
                { model: db.platform_invoice_items, as: 'items' },
                { model: db.platform_payment_allocation, as: 'allocations' }
            ]
        });
    },

    // Invoices for one location (location's own "My Invoices" view)
    findInvoicesForLocation: (locationCode) => {
        return db.platform_invoice.findAll({
            where: { location_code: locationCode },
            include: [{ model: db.platform_invoice_items, as: 'items' }],
            order: [['period_start_date', 'DESC']]
        });
    },

    // All invoices across all locations (master view), with location name.
    // Pass locationCode to restrict to one location.
    findAllInvoices: (fromPeriod, toPeriod, locationCode) => {
        return db.sequelize.query(
            `SELECT
                pi.invoice_id, pi.location_code, l.location_name, pi.invoice_number,
                pi.period_start_date, pi.period_end_date, pi.gross_amount,
                pi.discount_amount, pi.net_amount, pi.due_date, pi.status,
                pi.generated_date,
                COALESCE((
                    SELECT SUM(ppa.allocated_amount)
                    FROM t_platform_payment_allocation ppa
                    WHERE ppa.invoice_id = pi.invoice_id
                ), 0) AS paid_amount
            FROM t_platform_invoice pi
            JOIN m_location l ON l.location_code = pi.location_code
            WHERE pi.period_start_date BETWEEN :fromPeriod AND :toPeriod
              AND (:locationCode IS NULL OR pi.location_code = :locationCode)
            ORDER BY pi.period_start_date DESC, l.location_name`,
            {
                replacements: { fromPeriod, toPeriod, locationCode: locationCode || null },
                type: QueryTypes.SELECT
            }
        );
    },

    // Chronological ledger for one location: invoices (owed) + payments (paid), running balance computed by caller
    getLedgerForLocation: (locationCode) => {
        return db.sequelize.query(
            `SELECT 'INVOICE' AS entry_type, invoice_id AS entry_id, period_start_date AS entry_date,
                    invoice_number AS reference, net_amount AS amount, status
             FROM t_platform_invoice WHERE location_code = :locationCode
             UNION ALL
             SELECT 'PAYMENT' AS entry_type, payment_id AS entry_id, payment_date AS entry_date,
                    CONCAT(payment_mode, COALESCE(CONCAT(' - ', reference_number), '')) AS reference,
                    amount, status
             FROM t_platform_payment WHERE location_code = :locationCode
             ORDER BY entry_date, entry_type DESC`,
            { replacements: { locationCode }, type: QueryTypes.SELECT }
        );
    },

    addInvoiceAdjustment: (invoiceId, description, amount, userId) => {
        return db.sequelize.transaction(async (t) => {
            const invoice = await db.platform_invoice.findOne({ where: { invoice_id: invoiceId }, transaction: t });
            if (!invoice) throw new Error('Invoice not found');

            const nextSort = await db.platform_invoice_items.count({ where: { invoice_id: invoiceId }, transaction: t }) + 1;
            await db.platform_invoice_items.create({
                invoice_id: invoiceId, description: `Adjustment: ${description}`, amount, sort_order: nextSort
            }, { transaction: t });

            const newNet = Math.max(0, Number(invoice.net_amount) + Number(amount));
            await db.platform_invoice.update({
                net_amount: newNet,
                discount_amount: amount < 0 ? Number(invoice.discount_amount) + Math.abs(amount) : invoice.discount_amount,
                updated_by: userId, updation_date: new Date()
            }, { where: { invoice_id: invoiceId }, transaction: t });

            return newNet;
        });
    },

    // Outstanding (unpaid/partial) invoices for a location — for bulk payment allocation
    findOutstandingInvoicesForLocation: (locationCode) => {
        return db.platform_invoice.findAll({
            where: {
                location_code: locationCode,
                status: { [Op.in]: ['UNPAID', 'PARTIAL'] }
            },
            order: [['period_start_date', 'ASC']]
        });
    },

    updateInvoiceStatus: (invoiceId, status, userId) => {
        return db.platform_invoice.update(
            { status, updated_by: userId, updation_date: new Date() },
            { where: { invoice_id: invoiceId } }
        );
    },

    // ─── Payments ──────────────────────────────────────────────────────────

    createPayment: (paymentData, allocations) => {
        return db.sequelize.transaction(async (t) => {
            const payment = await db.platform_payment.create(paymentData, { transaction: t });
            const rows = allocations.map(a => ({
                payment_id: payment.payment_id,
                invoice_id: a.invoice_id,
                allocated_amount: a.allocated_amount,
                created_by: paymentData.created_by,
                creation_date: new Date()
            }));
            await db.platform_payment_allocation.bulkCreate(rows, { transaction: t });
            return payment;
        });
    },

    // All payments across all locations (master view). Pass locationCode to restrict to one.
    findAllPayments: (fromDate, toDate, locationCode) => {
        return db.sequelize.query(
            `SELECT pp.payment_id, pp.location_code, l.location_name, pp.payment_date, pp.amount,
                    pp.payment_mode, pp.reference_number, pp.status, pp.remarks,
                    GROUP_CONCAT(pi.invoice_number SEPARATOR ', ') AS invoice_numbers
             FROM t_platform_payment pp
             JOIN m_location l ON l.location_code = pp.location_code
             LEFT JOIN t_platform_payment_allocation ppa ON ppa.payment_id = pp.payment_id
             LEFT JOIN t_platform_invoice pi ON pi.invoice_id = ppa.invoice_id
             WHERE pp.payment_date BETWEEN :fromDate AND :toDate
               AND (:locationCode IS NULL OR pp.location_code = :locationCode)
             GROUP BY pp.payment_id
             ORDER BY pp.payment_date DESC`,
            {
                replacements: { fromDate, toDate, locationCode: locationCode || null },
                type: QueryTypes.SELECT
            }
        );
    },

    findPaymentsForLocation: (locationCode) => {
        return db.platform_payment.findAll({
            where: { location_code: locationCode },
            include: [{ model: db.platform_payment_allocation, as: 'allocations' }],
            order: [['payment_date', 'DESC']]
        });
    },

    // Total already allocated to an invoice (across all payments)
    getAllocatedAmount: (invoiceId) => {
        return db.platform_payment_allocation.sum('allocated_amount', {
            where: { invoice_id: invoiceId }
        });
    }
};

module.exports = PlatformBillingDao;
