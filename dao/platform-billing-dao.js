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
    // drives the monthly generation loop
    getActiveBillingPlansForGeneration: (asOfDate) => {
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
            ORDER BY bp.location_code`,
            {
                replacements: { asOfDate },
                type: QueryTypes.SELECT
            }
        );
    },

    upsertBillingPlan: (planData) => {
        return db.location_billing_plan.create(planData);
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

    // All invoices across all locations (master view), with location name
    findAllInvoices: (fromPeriod, toPeriod) => {
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
            ORDER BY pi.period_start_date DESC, l.location_name`,
            {
                replacements: { fromPeriod, toPeriod },
                type: QueryTypes.SELECT
            }
        );
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
