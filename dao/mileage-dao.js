const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    // Get detailed mileage data for customer vehicles with distance and mileage calculations
    getMileageData: (locationCode, creditlistId, fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT 
                DATE_FORMAT(tcl.closing_date, '%Y-%m-%d') as transaction_date,
                tc.bill_no,
                mcv.vehicle_number,
                mcv.vehicle_type,
                mp.product_name,
                tc.qty as fuel_quantity,
                tc.price,
                tc.amount,
                tc.odometer_reading,
                tc.notes,
                tc.vehicle_id,
                tcl.closing_date as sort_date,
                -- Calculate distance and mileage using subquery approach
                COALESCE(
                    tc.odometer_reading - (
                        SELECT tc2.odometer_reading 
                        FROM t_credits tc2
                        JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                        WHERE tc2.vehicle_id = tc.vehicle_id
                        AND tcl2.closing_date < tcl.closing_date
                        AND tc2.odometer_reading IS NOT NULL
                        AND tc2.odometer_reading > 0
                        ORDER BY tcl2.closing_date DESC
                        LIMIT 1
                    ), 0
                ) as distance_run,
                -- Calculate mileage
                CASE 
                    WHEN (
                        SELECT tc2.odometer_reading 
                        FROM t_credits tc2
                        JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                        WHERE tc2.vehicle_id = tc.vehicle_id
                        AND tcl2.closing_date < tcl.closing_date
                        AND tc2.odometer_reading IS NOT NULL
                        AND tc2.odometer_reading > 0
                        ORDER BY tcl2.closing_date DESC
                        LIMIT 1
                    ) IS NOT NULL 
                    AND tc.qty > 0
                    THEN ROUND(
                        (tc.odometer_reading - (
                            SELECT tc2.odometer_reading 
                            FROM t_credits tc2
                            JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                            WHERE tc2.vehicle_id = tc.vehicle_id
                            AND tcl2.closing_date < tcl.closing_date
                            AND tc2.odometer_reading IS NOT NULL
                            AND tc2.odometer_reading > 0
                            ORDER BY tcl2.closing_date DESC
                            LIMIT 1
                        )) / tc.qty, 
                        2
                    )
                    ELSE 0
                END as mileage_kmpl
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
                AND tc.creditlist_id = :creditlistId
                AND tc.vehicle_id IS NOT NULL
                AND tc.odometer_reading IS NOT NULL
                AND tc.odometer_reading > 0
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            ORDER BY mcv.vehicle_number, tcl.closing_date
        `, {
            replacements: { locationCode, creditlistId, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        });
    },

    // Get vehicle-wise mileage summary
    getVehicleMileageSummary: (locationCode, creditlistId, fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT 
                tc.vehicle_id,
                mcv.vehicle_number,
                mcv.vehicle_type,
                COUNT(*) as total_transactions,
                ROUND(SUM(tc.qty), 2) as total_fuel_consumed,
                SUM(
                    COALESCE(
                        tc.odometer_reading - (
                            SELECT tc2.odometer_reading 
                            FROM t_credits tc2
                            JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                            WHERE tc2.vehicle_id = tc.vehicle_id
                            AND tcl2.closing_date < tcl.closing_date
                            AND tc2.odometer_reading IS NOT NULL
                            AND tc2.odometer_reading > 0
                            ORDER BY tcl2.closing_date DESC
                            LIMIT 1
                        ), 0
                    )
                ) as total_distance,
                MAX(tc.odometer_reading) as last_odometer_reading,
                ROUND(
                    AVG(
                        CASE 
                            WHEN (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            ) IS NOT NULL 
                            AND tc.qty > 0
                            THEN (tc.odometer_reading - (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            )) / tc.qty
                            ELSE NULL
                        END
                    ), 2
                ) as avg_mileage,
                ROUND(
                    MIN(
                        CASE 
                            WHEN (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            ) IS NOT NULL 
                            AND tc.qty > 0
                            THEN (tc.odometer_reading - (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            )) / tc.qty
                            ELSE NULL
                        END
                    ), 2
                ) as min_mileage,
                ROUND(
                    MAX(
                        CASE 
                            WHEN (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            ) IS NOT NULL 
                            AND tc.qty > 0
                            THEN (tc.odometer_reading - (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            )) / tc.qty
                            ELSE NULL
                        END
                    ), 2
                ) as max_mileage,
                MAX(tcl.closing_date) as last_transaction_date
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            WHERE tcl.location_code = :locationCode
                AND tc.creditlist_id = :creditlistId
                AND tc.vehicle_id IS NOT NULL
                AND tc.odometer_reading IS NOT NULL
                AND tc.odometer_reading > 0
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
            GROUP BY tc.vehicle_id, mcv.vehicle_number, mcv.vehicle_type
            ORDER BY mcv.vehicle_number
        `, {
            replacements: { locationCode, creditlistId, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        });
    },

    // Get fleet-level summary statistics
    getFleetSummary: (locationCode, creditlistId, fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT 
                COUNT(DISTINCT tc.vehicle_id) as total_vehicles,
                COUNT(*) as total_transactions,
                ROUND(SUM(tc.qty), 2) as total_fuel_consumed,
                SUM(
                    COALESCE(
                        tc.odometer_reading - (
                            SELECT tc2.odometer_reading 
                            FROM t_credits tc2
                            JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                            WHERE tc2.vehicle_id = tc.vehicle_id
                            AND tcl2.closing_date < tcl.closing_date
                            AND tc2.odometer_reading IS NOT NULL
                            AND tc2.odometer_reading > 0
                            ORDER BY tcl2.closing_date DESC
                            LIMIT 1
                        ), 0
                    )
                ) as total_distance,
                ROUND(SUM(tc.amount), 2) as total_fuel_cost,
                ROUND(
                    AVG(
                        CASE 
                            WHEN (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            ) IS NOT NULL 
                            AND tc.qty > 0
                            THEN (tc.odometer_reading - (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            )) / tc.qty
                            ELSE NULL
                        END
                    ), 2
                ) as fleet_avg_mileage,
                ROUND(
                    SUM(
                        COALESCE(
                            tc.odometer_reading - (
                                SELECT tc2.odometer_reading 
                                FROM t_credits tc2
                                JOIN t_closing tcl2 ON tc2.closing_id = tcl2.closing_id
                                WHERE tc2.vehicle_id = tc.vehicle_id
                                AND tcl2.closing_date < tcl.closing_date
                                AND tc2.odometer_reading IS NOT NULL
                                AND tc2.odometer_reading > 0
                                ORDER BY tcl2.closing_date DESC
                                LIMIT 1
                            ), 0
                        )
                    ) / SUM(tc.qty), 2
                ) as fleet_overall_mileage
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            WHERE tcl.location_code = :locationCode
                AND tc.creditlist_id = :creditlistId
                AND tc.vehicle_id IS NOT NULL
                AND tc.odometer_reading IS NOT NULL
                AND tc.odometer_reading > 0
                AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
        `, {
            replacements: { locationCode, creditlistId, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        });
    },

    // Get vehicles with no mileage data (for alerts)
    getVehiclesWithoutMileageData: (locationCode, creditlistId, fromDate, toDate) => {
        return db.sequelize.query(`
            SELECT DISTINCT
                mcv.vehicle_id,
                mcv.vehicle_number,
                mcv.vehicle_type,
                COUNT(tc.tcredit_id) as fuel_transactions,
                SUM(CASE WHEN tc.odometer_reading IS NULL OR tc.odometer_reading = 0 THEN 1 ELSE 0 END) as missing_odometer_count
            FROM m_creditlist_vehicles mcv
            LEFT JOIN t_credits tc ON mcv.vehicle_id = tc.vehicle_id
            LEFT JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE mcv.creditlist_id = :creditlistId
                AND (mcv.effective_end_date IS NULL OR mcv.effective_end_date >= CURDATE())
                AND (tcl.location_code = :locationCode OR tcl.location_code IS NULL)
                AND (DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate OR tcl.closing_date IS NULL)
            GROUP BY mcv.vehicle_id, mcv.vehicle_number, mcv.vehicle_type
            HAVING fuel_transactions = 0 OR missing_odometer_count > 0
            ORDER BY mcv.vehicle_number
        `, {
            replacements: { locationCode, creditlistId, fromDate, toDate },
            type: Sequelize.QueryTypes.SELECT
        });
    },

    // Get mileage trend data for charts (monthly aggregation) - Simplified version
getMileageTrendData: (locationCode, creditlistId, fromDate, toDate) => {
    return db.sequelize.query(`
        WITH base AS (
            SELECT 
                tc.vehicle_id,
                mcv.vehicle_number,
                tcl.closing_date,
                tc.qty,
                tc.odometer_reading,
                LAG(tc.odometer_reading) OVER (
                    PARTITION BY tc.vehicle_id
                    ORDER BY tcl.closing_date
                ) AS prev_odometer
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            WHERE tcl.location_code = :locationCode
              AND tc.creditlist_id = :creditlistId
              AND tc.vehicle_id IS NOT NULL
              AND tc.odometer_reading IS NOT NULL
              AND tc.odometer_reading > 0
              AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
        )
        SELECT
            DATE_FORMAT(closing_date, '%Y-%m'),
            vehicle_id,
            vehicle_number,
            ROUND(AVG(
                CASE 
                    WHEN prev_odometer IS NOT NULL AND qty > 0
                    THEN (odometer_reading - prev_odometer) / qty
                    ELSE NULL
                END
            ), 2) AS avg_monthly_mileage,
            COUNT(
                CASE 
                    WHEN prev_odometer IS NOT NULL AND qty > 0 THEN 1
                    ELSE NULL
                END
            ) AS transaction_count
        FROM base
        GROUP BY DATE_FORMAT(closing_date, '%Y-%m'), vehicle_id, vehicle_number
        HAVING avg_monthly_mileage > 0
        ORDER BY vehicle_number, DATE_FORMAT(closing_date, '%Y-%m');
    `, {
        replacements: { locationCode, creditlistId, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    });
}

};