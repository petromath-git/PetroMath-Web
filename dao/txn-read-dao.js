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
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const config = require("../config/app-config");


module.exports = {


getClosingDetailsByDate: async (locationCode, fromDate, toDate) => {
    try {
        // Get available products for this location
        const pumpProducts = await db.sequelize.query(`
            SELECT DISTINCT product_code 
            FROM m_pump 
            WHERE location_code = :locationCode 
            AND product_code IS NOT NULL 
            AND effective_end_date > NOW()
            ORDER BY product_code
        `, {
            replacements: { locationCode: locationCode },
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        // Build dynamic columns
        let productColumns = [];
        pumpProducts.forEach(product => {
            productColumns.push(`SUM(CASE WHEN product_code = '${product.product_code}' THEN sale ELSE 0 END) as '${product.product_code}'`);
        });
        
        const baseColumns = `
            closing_id,
            location_code,
            person_name,
            closing_date,
            closing_date_formatted,
            period,
            closing_status,
            notes
        `;
        
        const dynamicProductColumns = productColumns.length > 0 ? ', ' + productColumns.join(', ') : '';
        
        
        const twoTColumns = `
            , COALESCE(SUM(CASE WHEN product_name = '2T LOOSE' THEN qty ELSE 0 END), 0) as loose
        `;

        // Check if we have any data
        const basicTest = await db.sequelize.query(`
            SELECT COUNT(*) as count FROM t_closing 
            WHERE location_code = :locationCode 
            AND DATE(closing_date) BETWEEN :fromDate AND :toDate
        `, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });
        
        if (basicTest[0].count == 0) {
            return [];
        }

        
        const query = `
            SELECT 
                ${baseColumns},
                CASE 
                        WHEN closing_status = 'CLOSED' THEN ex_short
                        ELSE calculate_exshortage(closing_id)
                    END as ex_short
                ${dynamicProductColumns}
                ${twoTColumns}
            FROM (
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
                    c.notes,
                    c.ex_short,
                    mp.product_code,
                    COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) as sale,
                    NULL as product_name,
                    NULL as qty
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_reading r ON c.closing_id = r.closing_id
                LEFT JOIN m_pump mp ON r.pump_id = mp.pump_id
                WHERE c.location_code = :locationCode
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                
                UNION ALL
                
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
                    c.notes,
                    c.ex_short,
                    NULL as product_code,
                    NULL as sale,
                    pr.product_name,
                    COALESCE((ts.given_qty - ts.returned_qty), 0) as qty
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_2toil ts ON c.closing_id = ts.closing_id
                LEFT JOIN m_product pr ON ts.product_id = pr.product_id
                WHERE c.location_code = :locationCode
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                AND pr.product_name = '2T LOOSE'  -- UPDATED: Only 2T LOOSE
            ) combined_data
            GROUP BY closing_id, location_code, person_name, closing_date, closing_date_formatted, period, closing_status, notes
            ORDER BY closing_date ASC, closing_id ASC
        `;

        const result = await db.sequelize.query(query, {
            replacements: { locationCode, fromDate, toDate },
            type: db.Sequelize.QueryTypes.SELECT
        });

        return result;

    } catch (error) {
        console.error('Error in getClosingDetailsByDate:', error.message);
        return [];
    }
},

// Updated getPersonsClosingDetailsByDate for non-admin users
getPersonsClosingDetailsByDate: (personName, locationCode, fromDate, toDate) => {
    // Similar approach but filtered by person name
    return db.sequelize.query(`
        SELECT DISTINCT product_code 
        FROM m_pump 
        WHERE location_code = :locationCode 
        AND product_code IS NOT NULL 
        AND effective_end_date > NOW()
        ORDER BY product_code
    `, {
        replacements: { locationCode: locationCode },
        type: db.Sequelize.QueryTypes.SELECT
    }).then(pumpProducts => {
        
        // Build dynamic column selection for products
        let productColumns = [];
        pumpProducts.forEach(product => {
            productColumns.push(`SUM(CASE WHEN product_code = '${product.product_code}' THEN sale ELSE 0 END) as '${product.product_code}'`);
        });
        
        const baseColumns = `
            closing_id,
            location_code,
            person_name,
            closing_date,
            closing_date_formatted,
            period,
            closing_status,
            ex_short,
            notes
        `;
        
        const dynamicProductColumns = productColumns.length > 0 ? ', ' + productColumns.join(', ') : '';
        
        const twoTColumns = `
            , COALESCE(SUM(CASE WHEN product_name = '2T LOOSE' THEN qty ELSE 0 END), 0) as loose
            , COALESCE(SUM(CASE WHEN product_name = '2T POUCH' THEN qty ELSE 0 END), 0) as p_2t
        `;

        const query = `
            SELECT 
                ${baseColumns}
                ${dynamicProductColumns}
                ${twoTColumns}
            FROM (
                SELECT 
                    c.closing_id,
                    c.location_code,
                    p.Person_Name as person_name,
                    c.closing_date,
                    DATE_FORMAT(c.closing_date, '%d/%m/%Y %H:%i') as closing_date_formatted,
                    CASE 
                        WHEN HOUR(c.closing_date) < 12 THEN 'Morning'
                        ELSE 'Evening'
                    END as period,
                    c.closing_status,
                    CASE 
                        WHEN closing_status = 'CLOSED' THEN ex_short
                        ELSE calculate_exshortage(closing_id)
                    END as ex_short,
                    c.notes,
                    mp.product_code,
                    COALESCE((r.closing_reading - r.opening_reading - r.testing), 0) as sale,
                    NULL as product_name,
                    NULL as qty
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_reading r ON c.closing_id = r.closing_id
                LEFT JOIN m_pump mp ON r.pump_id = mp.pump_id
                WHERE c.location_code = :locationCode
                AND p.Person_Name = :personName
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                
                UNION ALL
                
                SELECT 
                    c.closing_id,
                    c.location_code,
                    p.Person_Name as person_name,
                    c.closing_date,
                    DATE_FORMAT(c.closing_date, '%d/%m/%Y %H:%i') as closing_date_formatted,
                    CASE 
                        WHEN HOUR(c.closing_date) < 12 THEN 'Morning'
                        ELSE 'Evening'
                    END as period,
                    c.closing_status,
                    CASE 
                        WHEN closing_status = 'CLOSED' THEN ex_short
                        ELSE calculate_exshortage(closing_id)
                    END as ex_short,
                    c.notes,
                    NULL as product_code,
                    NULL as sale,
                    pr.product_name,
                    COALESCE((ts.given_qty - ts.returned_qty), 0) as qty
                FROM t_closing c
                LEFT JOIN m_persons p ON c.cashier_id = p.Person_id
                LEFT JOIN t_2toil ts ON c.closing_id = ts.closing_id
                LEFT JOIN m_product pr ON ts.product_id = pr.product_id
                WHERE c.location_code = :locationCode
                AND p.Person_Name = :personName
                AND DATE(c.closing_date) BETWEEN :fromDate AND :toDate
                AND pr.product_name IN ('2T LOOSE', '2T POUCH')
            ) combined_data
            GROUP BY closing_id, location_code, person_name, closing_date, closing_date_formatted, period, closing_status, ex_short, notes
            ORDER BY closing_date DESC
        `;

        return db.sequelize.query(query, {
            replacements: { 
                locationCode: locationCode, 
                personName: personName,
                fromDate: fromDate, 
                toDate: toDate 
            },
            type: db.Sequelize.QueryTypes.SELECT
        });
    });
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
};
