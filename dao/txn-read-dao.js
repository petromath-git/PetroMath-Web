const db = require("../db/db-connection");
const moment = require('moment');
const TxnClosing = db.txn_closing;
const TxnCashSales = db.txn_cashsales;
const TxnReading = db.txn_reading;
const Txn2TOil = db.txn_2t_oil;
const TxnCredits = db.txn_credits;
const TxnExpenses = db.txn_expense;
const TxnDenoms = db.txn_denom;
const TxnClosingViews = db.txn_closing_views;
const Pumps = db.pump;
const Products = db.product;
const Expenses = db.expense;
const TxnAttendance = db.txn_attendance;
const TxnDeadlineViews = db.txn_deadline_views;
const TxnDigitalSales = db.txn_digital_sales;
const CashReceipts = db.credit_receipts;
const EmployeeLedger = db.employee_ledger;
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const config = require("../config/app-config");


module.exports = {




getClosingDetailsByDate: async (locationCode, fromDate, toDate) => {
    try {
        console.time('Total getClosingDetailsByDate');
        
        // OPTIMIZATION 1: Early exit check using EXISTS with DATE() function
        console.time('Exists check');
        const existsCheck = await db.sequelize.query(`
            SELECT EXISTS(
                SELECT 1 FROM t_closing 
                WHERE location_code = :locationCode 
                AND DATE(closing_date) BETWEEN :fromDate AND :toDate
            ) as has_data
        `, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
        console.timeEnd('Exists check');
        
        if (!existsCheck[0].has_data) {
            console.log('No closings found - returning empty array');
            console.timeEnd('Total getClosingDetailsByDate');
            return [];
        }

        // OPTIMIZATION 2: Get products only if we have data
        console.time('Get products');
        const pumpProducts = await db.sequelize.query(`
                SELECT DISTINCT mp.product_code 
                FROM m_pump mp
                JOIN t_reading r ON mp.pump_id = r.pump_id
                JOIN t_closing c ON r.closing_id = c.closing_id
                JOIN m_product prod ON mp.product_code = prod.product_name 
                                    AND mp.location_code = prod.location_code
                WHERE c.location_code = :locationCode 
                AND mp.product_code IS NOT NULL 
                AND mp.effective_end_date > NOW()
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                ORDER BY prod.product_id 
        `, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
        console.timeEnd('Get products');
        
        // Build dynamic product columns
        let fuelSalesColumns = [];
        let finalProductColumns = [];

        if (pumpProducts.length > 0) {
            pumpProducts.forEach(product => {
                fuelSalesColumns.push(`SUM(CASE WHEN mp.product_code = '${product.product_code}' THEN COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) ELSE 0 END) as \`${product.product_code}\``);
                fuelSalesColumns.push(`SUM(CASE WHEN mp.product_code = '${product.product_code}' THEN COALESCE(r.testing, 0) ELSE 0 END) as \`test_${product.product_code}\``);
                finalProductColumns.push(`COALESCE(fs.\`${product.product_code}\`, 0) as \`${product.product_code}\``);
                finalProductColumns.push(`COALESCE(fs.\`test_${product.product_code}\`, 0) as \`test_${product.product_code}\``);
            });
        }

        const dynamicFuelColumns = fuelSalesColumns.length > 0 ? ',\n        ' + fuelSalesColumns.join(',\n        ') : '';
        const dynamicFinalColumns = finalProductColumns.length > 0 ? ',\n    ' + finalProductColumns.join(',\n    ') : '';

        // OPTIMIZATION 3: Main query using CTEs instead of UNION
        console.time('Main query');
        const query = `
            WITH fuel_sales AS (
                SELECT 
                    c.closing_id${dynamicFuelColumns}
                FROM t_closing c
                LEFT JOIN t_reading r ON c.closing_id = r.closing_id
                LEFT JOIN m_pump mp ON r.pump_id = mp.pump_id
                WHERE c.location_code = :locationCode
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                GROUP BY c.closing_id
            ),
            oil_sales AS (
                SELECT 
                    c.closing_id,
                    COALESCE(SUM(ts.given_qty - ts.returned_qty), 0) as loose
                FROM t_closing c
                LEFT JOIN t_2toil ts ON c.closing_id = ts.closing_id
                LEFT JOIN m_product pr ON ts.product_id = pr.product_id
                WHERE c.location_code = :locationCode
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                AND pr.product_name = '2T LOOSE'
                GROUP BY c.closing_id
            )
            SELECT 
                c.closing_id,
                c.location_code,
                c.cashflow_id,
                COALESCE(p.Person_Name, 'Unknown') as person_name,
                c.closing_date,
                DATE_FORMAT(c.closing_date, '%d-%b-%Y') as closing_date_formatted,
                CASE
                    WHEN HOUR(c.closing_date) < 12 THEN 'Morning'
                    ELSE 'Evening'
                END as period,
                c.closing_status,
                COALESCE(c.notes, '') as notes,
                COALESCE(c.ex_short, 0) as ex_short,
                cf.cashflow_date,
                DATE_FORMAT(cf.cashflow_date, '%d-%b-%Y') as day_close_date,
                cf.closing_status as cashflow_status${dynamicFinalColumns},
                COALESCE(os.loose, 0) as loose
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            LEFT JOIN fuel_sales fs ON c.closing_id = fs.closing_id
            LEFT JOIN oil_sales os ON c.closing_id = os.closing_id
            LEFT JOIN t_cashflow_closing cf ON c.cashflow_id = cf.cashflow_id
            WHERE c.location_code = :locationCode
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY c.closing_date ASC, c.closing_id ASC
        `;

        const result = await db.sequelize.query(query, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT,
            timeout: 15000
        });
        
        console.timeEnd('Main query');
        console.timeEnd('Total getClosingDetailsByDate');
        console.log(`Returned ${result.length} closings`);
        
        return result;

    } catch (error) {
        console.error('Error in getClosingDetailsByDate:', error.message);
        return [];
    }
},


getPersonsClosingDetailsByDate: async (personName, locationCode, fromDate, toDate) => {
    try {
        console.time('Total getPersonsClosingDetailsByDate');
        

        console.time('Person exists check');
        const existsCheck = await db.sequelize.query(`
            SELECT EXISTS(
                SELECT 1 FROM t_closing c
                JOIN m_persons p ON c.cashier_id = p.Person_id
                WHERE c.location_code = :locationCode 
                AND p.Person_Name = :personName
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ) as has_data
        `, {
            replacements: { locationCode, personName, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
        console.timeEnd('Person exists check');
        
        if (!existsCheck[0].has_data) {
            console.log(`No closings found for person ${personName} - returning empty array`);
            console.timeEnd('Total getPersonsClosingDetailsByDate');
            return [];
        }

        // OPTIMIZATION 2: Get products only for this person's closings
        console.time('Get person products');
        const pumpProducts = await db.sequelize.query(`
            SELECT DISTINCT mp.product_code 
            FROM m_pump mp
            JOIN t_reading r ON mp.pump_id = r.pump_id
            JOIN t_closing c ON r.closing_id = c.closing_id
            JOIN m_product prod ON mp.product_code = prod.product_name 
                                AND mp.location_code = prod.location_code
            WHERE c.location_code = :locationCode 
            AND mp.product_code IS NOT NULL 
            AND mp.effective_end_date > NOW()
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY prod.product_id 
        `, {
            replacements: { locationCode, personName, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
        console.timeEnd('Get person products');
        
        // Build dynamic product columns
        let fuelSalesColumns = [];
        let finalProductColumns = [];
        
        if (pumpProducts.length > 0) {
            pumpProducts.forEach(product => {
                fuelSalesColumns.push(`SUM(CASE WHEN mp.product_code = '${product.product_code}' THEN COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) ELSE 0 END) as \`${product.product_code}\``);
                finalProductColumns.push(`COALESCE(fs.\`${product.product_code}\`, 0) as \`${product.product_code}\``);
            });
        }
        
        const dynamicFuelColumns = fuelSalesColumns.length > 0 ? ',\n        ' + fuelSalesColumns.join(',\n        ') : '';
        const dynamicFinalColumns = finalProductColumns.length > 0 ? ',\n    ' + finalProductColumns.join(',\n    ') : '';

        // OPTIMIZATION 3: Optimized query structure for person-specific data
        console.time('Person main query');
        const query = `
            WITH fuel_sales AS (
                SELECT 
                    c.closing_id${dynamicFuelColumns}
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_reading r ON c.closing_id = r.closing_id
                LEFT JOIN m_pump mp ON r.pump_id = mp.pump_id
                WHERE c.location_code = :locationCode
                AND p.Person_Name = :personName
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                GROUP BY c.closing_id
            ),
            oil_sales AS (
                SELECT 
                    c.closing_id,
                    COALESCE(SUM(CASE WHEN pr.product_name = '2T LOOSE' THEN (ts.given_qty - ts.returned_qty) ELSE 0 END), 0) as loose,
                    COALESCE(SUM(CASE WHEN pr.product_name = '2T POUCH' THEN (ts.given_qty - ts.returned_qty) ELSE 0 END), 0) as p_2t
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_2toil ts ON c.closing_id = ts.closing_id
                LEFT JOIN m_product pr ON ts.product_id = pr.product_id
                WHERE c.location_code = :locationCode
                AND p.Person_Name = :personName
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                AND pr.product_name IN ('2T LOOSE', '2T POUCH')
                GROUP BY c.closing_id
            )
            SELECT 
                c.closing_id,
                c.location_code,
                p.Person_Name as person_name,
                c.closing_date,
                DATE_FORMAT(c.closing_date, '%d-%b-%Y') as closing_date_formatted,
                CASE
                    WHEN HOUR(c.closing_date) < 12 THEN 'Morning'
                    ELSE 'Evening'
                END as period,
                c.closing_status,
                COALESCE(c.notes, '') as notes,
                COALESCE(c.ex_short, 0) as ex_short${dynamicFinalColumns},
                COALESCE(os.loose, 0) as loose,
                COALESCE(os.p_2t, 0) as p_2t
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            LEFT JOIN fuel_sales fs ON c.closing_id = fs.closing_id
            LEFT JOIN oil_sales os ON c.closing_id = os.closing_id
            WHERE c.location_code = :locationCode
            AND p.Person_Name = :personName
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY c.closing_date ASC, c.closing_id ASC
        `;

        const result = await db.sequelize.query(query, {
            replacements: { locationCode, personName, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT,
            timeout: 15000
        });
        
        console.timeEnd('Person main query');
        console.timeEnd('Total getPersonsClosingDetailsByDate');
        console.log(`Returned ${result.length} closings for person ${personName}`);
        
        return result;

    } catch (error) {
        console.error('Error in getPersonsClosingDetailsByDate:', error.message);
        return [];
    }
},

// With dayCount > 1, returns the oldest of the last `dayCount` distinct closing
// dates — i.e. the from-date that covers the last N days that had shifts.
getMostRecentClosingDate: async (locationCode, dayCount = 1) => {
    try {
        const offset = Math.max(parseInt(dayCount, 10) || 1, 1) - 1;
        const query = `
            SELECT closing_day as most_recent_date
            FROM (
                SELECT DISTINCT DATE(closing_date) as closing_day
                FROM t_closing
                WHERE location_code = :locationCode
            ) d
            ORDER BY closing_day DESC
            LIMIT 1 OFFSET ${offset}
        `;

        let result = await db.sequelize.query(query, {
            replacements: { locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });

        // Fewer than N days of history — fall back to the oldest closing day
        if ((!result || result.length === 0) && offset > 0) {
            result = await db.sequelize.query(`
                SELECT DATE(MIN(closing_date)) as most_recent_date
                FROM t_closing
                WHERE location_code = :locationCode
            `, {
                replacements: { locationCode },
                type: db.Sequelize.QueryTypes.SELECT
            });
        }

        if (result && result.length > 0 && result[0].most_recent_date) {
            return moment(result[0].most_recent_date).format('YYYY-MM-DD');
        }

        // If no closings found, return today's date as fallback
        return moment().format('YYYY-MM-DD');

    } catch (error) {
        console.error('Error in getMostRecentClosingDate:', error.message);
        // Return today's date as fallback on error
        return moment().format('YYYY-MM-DD');
    }
},
    
    // getClosingDetailsByDateFormat: (locationCode, fromDate, toDate) => {
    //     return TxnClosing.findAll({
    //         attributes: [
    //             'closer_id',
    //             [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%Y-%m-%d'), 'closing_date_fmt1'],
    //         ],
    //         where: { [Op.and]: [
    //                 { location_code: locationCode },
    //                 {
    //                     closing_date: Sequelize.where(
    //                         Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), ">=",  fromDate)
    //                 },
    //                 {
    //                     closing_date: Sequelize.where(
    //                         Sequelize.fn("date_format", Sequelize.col("closing_date"), '%Y-%m-%d'), "<=",  toDate)
    //                 }
    //             ] },
    //         order: [Sequelize.literal('closing_id')]
    //     });
    // },
    getClosingDetailsByDateFormat: async (locationCode, fromDate, toDate) => {
        const query = `
            SELECT DISTINCT
                c.closer_id,
                DATE_FORMAT(c.closing_date, '%Y-%m-%d') as closing_date_fmt1,
                c.closing_id
            FROM t_closing c
            WHERE c.location_code = :locationCode
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY c.closing_id
        `;
    
        return db.sequelize.query(query, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
    },
    
    getDraftClosingsCountBeforeDays: (locationCode, noOfDays) => {
        let start = moment().subtract(noOfDays, 'days').startOf('day');
        let date = new Date(start.valueOf());
        return TxnClosing.count({
            where: { [Op.and]: [
                    { location_code: locationCode },
                    { closing_status: 'DRAFT' },
                    { closing_date:  {
                        [Op.lt] : date
                    }}
                ] },
        });
    },

    getDeadlineWarningMessage: (locationCode) => {
        return TxnDeadlineViews.findAll({
            attributes: ['message', 'deadline_date'],
             where: { [Op.and]: [
             { location_code: locationCode },
               { display_warning: 'Y'}
             ]}
        })
    },

    getDraftClosingsCount: (locationCode, noOfDays) => {
        return TxnClosing.count({
            where: {
                [Op.and]: [
                    {location_code: locationCode},
                    {closing_status: 'DRAFT'}
                ]
            },
        });
    },
    getClosingDetails: (closingId) => {
        return TxnClosing.findByPk(closingId,
            {
                attributes: [
                    'closing_id',
                    'closer_id',
                    'cashier_id',
                    'location_code',
                    'ex_short',
                    'closing_status',
                    'notes',
                    'cash',
                    'close_reading_time',
                    [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%Y-%m-%d'), 'closing_date_fmt1'],
                    [Sequelize.fn('date_format', Sequelize.col('closing_date'), '%d-%b-%Y'), 'closing_date_fmt2'],
                ]
            });
    },
    getCashSalesByClosingId: (closingId) => {
        return TxnCashSales.findAll({
            where: {'closing_id': closingId}
        });
    },
    getReadingsByClosingId: (closingId) => {
        return TxnReading.findAll({
            where: {'closing_id': closingId}
        });
    },
    getPumpAndReadingsByClosingId: (closingId, locationCode) => {
        return Pumps.findAll({
            where: {'location_code': locationCode},
            include: [
                {
                    model: TxnReading,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    required: false
                }],
        });
    },
    get2TSalesByClosingId: (closingId, locationCode) => {
        return Products.findAll({
            where: {'location_code': locationCode,
                'product_name': {
                    [Op.or]: [config.POUCH_DESC, config.LOOSE_DESC]
                },
            },
            include: [
                {
                    model: Txn2TOil,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    required: false
                }],
        });
    },
    getCreditsByClosingId: (closingId) => {
        return TxnCredits.findAll({
            where: {'closing_id': closingId}
        });
    },
    getExpensesByClosingId: (closingId) => {
        return TxnExpenses.findAll({
            where: {'closing_id': closingId}
        });
    },
    getTxnExpensesByClosingId: (closingId, locationCode) => {
        return Expenses.findAll({
            where: {
                'location_code': locationCode
            },
            include: [
                {
                    model: TxnExpenses,
                    where: {
                        closing_id: {
                            [Op.or]: [closingId, null]
                        },
                    },
                    order: [Sequelize.literal('expense_id ASC')],
                    required: false
                }],
        });
    },
    getDenomsByClosingId: (closingId) => {
        return TxnDenoms.findAll({
            where: {'closing_id': closingId}
        });
    },
    getExcessShortage: (closingId) => {
        const closingTxn = db.sequelize.query(
            'select calculate_exshortage(' + closingId + ') as excess_shortage;'
        );
        return closingTxn;
    },

    // Line-level breakdown of CALCULATE_EXSHORTAGE for the "how was this
    // computed" popup. Every query below mirrors one component of the
    // function (db/migrations/add-employee-advance-to-exshortage.sql) —
    // same filters, same arithmetic, same NULL behaviour — only grouped so
    // the user can see the lines. If the function changes, change these too;
    // the controller cross-checks the total against the function itself.
    getExcessShortageBreakdown: async (closingId) => {
        const opts = { replacements: { closingId }, type: Sequelize.QueryTypes.SELECT };
        const pumpProductsSql = `
            SELECT DISTINCT mp2.product_code
            FROM t_reading tr
            INNER JOIN m_pump mp2 ON tr.pump_id = mp2.pump_id
            WHERE tr.closing_id = :closingId`;
        const q = (sql) => db.sequelize.query(sql, opts);

        const [header, readings, credits, lubeSales, pumpDiscounts, twoTOil, expenses,
               denominations, digitalSales, intercompany, cashReceipts, employeeLedger] = await Promise.all([
            q(`SELECT tc.closing_id, tc.location_code, tc.closing_status, tc.cash, tc.ex_short,
                      DATE_FORMAT(tc.closing_date, '%d-%b-%Y') AS closing_date,
                      p.Person_Name AS cashier_name,
                      CALCULATE_EXSHORTAGE(tc.closing_id) AS live_ex_short
               FROM t_closing tc
               LEFT JOIN m_persons p ON p.Person_id = tc.cashier_id
               WHERE tc.closing_id = :closingId`),

            q(`SELECT mp.pump_code, mp.product_code, tr.opening_reading, tr.closing_reading, tr.testing, tr.price,
                      (tr.closing_reading - tr.opening_reading - tr.testing) AS qty,
                      (tr.closing_reading - tr.opening_reading - tr.testing) * tr.price AS amount
               FROM t_reading tr
               LEFT JOIN m_pump mp ON mp.pump_id = tr.pump_id
               WHERE tr.closing_id = :closingId
               ORDER BY mp.display_order, mp.pump_code`),

            q(`SELECT cl.Company_Name AS name, mp.product_name AS product, SUM(tc.qty) AS qty, SUM(tc.price * tc.qty) AS amount
               FROM t_credits tc
               INNER JOIN m_product mp ON tc.product_id = mp.product_id
               INNER JOIN (${pumpProductsSql}) pump_products ON mp.product_name = pump_products.product_code
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = tc.creditlist_id
               WHERE tc.closing_id = :closingId
                 AND COALESCE(tc.off_meter_sale, 0) = 0
               GROUP BY cl.Company_Name, mp.product_name
               ORDER BY cl.Company_Name, mp.product_name`),

            q(`SELECT mp.product_name AS name, SUM(cs.qty) AS qty, SUM((cs.price - cs.price_discount) * cs.qty) AS amount
               FROM t_cashsales cs
               INNER JOIN m_product mp ON cs.product_id = mp.product_id
               WHERE cs.closing_id = :closingId
                 AND mp.product_name NOT IN (${pumpProductsSql})
               GROUP BY mp.product_name
               ORDER BY mp.product_name`),

            q(`SELECT mp.product_name AS name, SUM(cs.qty) AS qty, SUM(cs.price_discount * cs.qty) AS amount
               FROM t_cashsales cs
               INNER JOIN m_product mp ON cs.product_id = mp.product_id
               WHERE cs.closing_id = :closingId
                 AND mp.product_name IN (${pumpProductsSql})
               GROUP BY mp.product_name
               HAVING SUM(cs.price_discount * cs.qty) <> 0
               ORDER BY mp.product_name`),

            q(`SELECT mp.product_name AS name, t.price, t.given_qty, t.returned_qty,
                      (t.given_qty - t.returned_qty) AS qty,
                      t.price * (t.given_qty - t.returned_qty) AS amount
               FROM t_2toil t
               LEFT JOIN m_product mp ON mp.product_id = t.product_id
               WHERE t.closing_id = :closingId
               ORDER BY mp.product_name`),

            q(`SELECT me.Expense_name AS name, SUM(te.amount) AS amount
               FROM t_expense te
               LEFT JOIN m_expense me ON me.Expense_id = te.expense_id
               WHERE te.closing_id = :closingId
               GROUP BY me.Expense_name
               ORDER BY me.Expense_name`),

            q(`SELECT denomination, denomcount,
                      IF(denomination = '0', 1, denomination) * denomcount AS amount
               FROM t_denomination
               WHERE closing_id = :closingId
               ORDER BY denomination DESC`),

            q(`SELECT cl.Company_Name AS name, SUM(ds.amount) AS amount
               FROM t_digital_sales ds
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = ds.vendor_id
               WHERE ds.closing_id = :closingId
               GROUP BY cl.Company_Name
               ORDER BY cl.Company_Name`),

            q(`SELECT x.name, x.qty, x.rate, x.qty * x.rate AS amount
               FROM (
                   SELECT p.product_name AS name, tci.quantity AS qty,
                          (SELECT AVG(tr.price)
                           FROM t_reading tr
                           JOIN m_pump mp ON tr.pump_id = mp.pump_id
                           JOIN m_product mp2 ON mp.product_code = mp2.product_name
                           WHERE tr.closing_id = :closingId
                             AND mp2.product_id = tci.product_id) AS rate
                   FROM t_closing_intercompany tci
                   LEFT JOIN m_product p ON p.product_id = tci.product_id
                   WHERE tci.closing_id = :closingId
               ) x`),

            q(`SELECT cl.Company_Name AS name, SUM(r.amount) AS amount
               FROM t_receipts r
               LEFT JOIN m_credit_list cl ON cl.creditlist_id = r.creditlist_id
               WHERE r.closing_id = :closingId
                 AND r.receipt_type = 'Cash'
               GROUP BY cl.Company_Name
               ORDER BY cl.Company_Name`),

            q(`SELECT e.name, l.txn_type, SUM(l.debit_amount) AS debit_amount, SUM(l.credit_amount) AS credit_amount
               FROM t_employee_ledger l
               LEFT JOIN m_employee e ON e.employee_id = l.employee_id
               WHERE l.closing_id = :closingId
                 AND l.txn_type IN ('ADVANCE', 'PAYMENT', 'ADVANCE_RECOVERY')
               GROUP BY e.name, l.txn_type
               ORDER BY e.name, l.txn_type`)
        ]);

        return {
            header: header[0] || null,
            readings, credits, lubeSales, pumpDiscounts, twoTOil, expenses,
            denominations, digitalSales, intercompany, cashReceipts, employeeLedger
        };
    },

    getClosingSaleByMonth: (locationCode) => {
        return TxnClosingViews.findAll({
            attributes: [
                'location_code',
                [Sequelize.fn('YEAR', Sequelize.col('closing_date')), 'Year'],
                [Sequelize.fn('MONTH', Sequelize.col('closing_date')), 'Month'],
                [Sequelize.fn('sum', Sequelize.col('MS')), 'MS'],
                [Sequelize.fn('sum', Sequelize.col('XMS')), 'XMS'],
                [Sequelize.fn('sum', Sequelize.col('HSD')), 'HSD'],
            ],
            where: { location_code: locationCode  },
            group : [[Sequelize.fn('YEAR', Sequelize.col('closing_date'))],[Sequelize.fn('MONTH', Sequelize.col('closing_date'))]],
            //order: [Sequelize.literal('closing_id')]
        });
    },
    getAttendanceByClosingId: (closingId) => {
        return TxnAttendance.findAll({
            where: {'closing_id': closingId}
        });
    },
    getDigitalSalesByClosingId: (closingId) => {
    return TxnDigitalSales.findAll({
        where: {'closing_id': closingId}
    });
    },
    getReceiptsByClosingId: (closingId) => {
    return CashReceipts.findAll({
        // receipt_date_fmt is declared on the model but is not a real column on
        // t_receipts (existing queries against this model always scope attributes
        // to avoid it) - must list attributes explicitly here too.
        attributes: ['treceipt_id', 'receipt_type', 'creditlist_id', 'digital_creditlist_id',
            'amount', 'receipt_date', 'notes', 'closing_id'],
        where: {'closing_id': closingId}
    });
    },
    getEmployeeAdvancesByClosingId: (closingId) => {
    return EmployeeLedger.findAll({
        attributes: ['ledger_id', 'employee_id', 'txn_type', 'credit_amount', 'debit_amount',
            'txn_date', 'description', 'closing_id'],
        where: {'closing_id': closingId}
    });
    }
};
