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
            WHERE c.location_code = :locationCode 
            AND mp.product_code IS NOT NULL 
            AND mp.effective_end_date > NOW()
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY mp.product_code
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
                fuelSalesColumns.push(`SUM(CASE WHEN mp.product_code = '${product.product_code}' THEN COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) ELSE 0 END) as '${product.product_code}'`);
                finalProductColumns.push(`COALESCE(fs.${product.product_code}, 0) as ${product.product_code}`);
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
                COALESCE(p.Person_Name, 'Unknown') as person_name,
                c.closing_date,
                DATE_FORMAT(c.closing_date, '%d-%b-%Y') as closing_date_formatted,
                CASE
                    WHEN HOUR(c.closing_date) < 12 THEN 'Morning'
                    ELSE 'Evening'
                END as period,
                c.closing_status,
                COALESCE(c.notes, '') as notes,
                COALESCE(c.ex_short, 0) as ex_short${dynamicFinalColumns},
                COALESCE(os.loose, 0) as loose
            FROM t_closing c
            LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
            LEFT JOIN fuel_sales fs ON c.closing_id = fs.closing_id
            LEFT JOIN oil_sales os ON c.closing_id = os.closing_id
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
            JOIN m_persons p ON c.cashier_id = p.Person_id
            WHERE c.location_code = :locationCode 
            AND p.Person_Name = :personName
            AND mp.product_code IS NOT NULL 
            AND mp.effective_end_date > NOW()
            AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY mp.product_code
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
                fuelSalesColumns.push(`SUM(CASE WHEN mp.product_code = '${product.product_code}' THEN COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) ELSE 0 END) as '${product.product_code}'`);
                finalProductColumns.push(`COALESCE(fs.${product.product_code}, 0) as ${product.product_code}`);
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
};
