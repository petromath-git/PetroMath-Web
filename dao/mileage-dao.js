const db = require("../db/db-connection");
const { Op } = require("sequelize");
const Sequelize = require("sequelize");
const { performance } = require("perf_hooks");

const msToSeconds = ms => (ms / 1000).toFixed(3);

module.exports = {
    // Get detailed mileage data for customer vehicles
getMileageData: (locationCode, creditlistId, fromDate, toDate) => {
    const startTime = performance.now();

    return db.sequelize.query(`
        WITH all_vehicle_data AS (
            SELECT 
                tc.vehicle_id,
                tc.bill_no,
                mcv.vehicle_number,
                mcv.vehicle_type,
                mp.product_name,
                tc.qty as fuel_quantity,
                tc.price,
                tc.amount,
                tc.odometer_reading,
                tc.notes,
                tcl.closing_date,
                LAG(tc.odometer_reading) OVER (
                    PARTITION BY tc.vehicle_id 
                    ORDER BY tcl.closing_date, tc.bill_no
                ) as prev_odometer_reading,
                ROW_NUMBER() OVER (
                    PARTITION BY tc.vehicle_id 
                    ORDER BY tcl.closing_date, tc.bill_no
                ) as transaction_sequence_number
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            LEFT JOIN m_product mp ON tc.product_id = mp.product_id
            WHERE tcl.location_code = :locationCode
              AND tc.creditlist_id = :creditlistId
              AND tc.vehicle_id IS NOT NULL
        ),
        vehicle_data AS (
            SELECT 
                vehicle_id,
                bill_no,
                vehicle_number,
                vehicle_type,
                product_name,
                fuel_quantity,
                price,
                amount,
                odometer_reading,
                notes,
                closing_date,
                prev_odometer_reading,
                transaction_sequence_number,
                DATE_FORMAT(closing_date, '%Y-%m-%d') as transaction_date
            FROM all_vehicle_data
            WHERE DATE(closing_date) BETWEEN :fromDate AND :toDate
        )
        SELECT 
            transaction_date,
            bill_no,
            vehicle_number,
            vehicle_type,
            product_name,
            fuel_quantity,
            price,
            amount,
            odometer_reading,
            notes,
            vehicle_id,
            closing_date as sort_date,
            CASE 
                WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 0
                WHEN prev_odometer_reading IS NULL THEN 0
                WHEN odometer_reading < prev_odometer_reading THEN 0
                ELSE COALESCE(odometer_reading - prev_odometer_reading, 0)
            END as distance_run,
            CASE 
                WHEN prev_odometer_reading IS NOT NULL 
                     AND fuel_quantity > 0 
                     AND odometer_reading > 0
                     AND odometer_reading >= prev_odometer_reading
                THEN ROUND((odometer_reading - prev_odometer_reading) / fuel_quantity, 2)
                ELSE 0
            END as mileage_kmpl,
            -- Add status for each transaction
            CASE 
                WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 'missing_odometer'
                WHEN transaction_sequence_number = 1 THEN 'first_entry'
                WHEN prev_odometer_reading IS NULL THEN 'no_previous_reading'
                WHEN odometer_reading < prev_odometer_reading THEN 'invalid_reading'
                ELSE 'valid_calculation'
            END as mileage_status
        FROM vehicle_data
        ORDER BY vehicle_number, closing_date
    `, {
        replacements: { locationCode, creditlistId, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    }).then(results => results)
    .catch(error => {
        const queryTime = performance.now() - startTime;
        console.error(`getMileageData failed after ${msToSeconds(queryTime)}s:`, error);
        throw error;
    });
},

    // Vehicle-wise mileage summary
getVehicleMileageSummary: (locationCode, creditlistId, fromDate, toDate) => {
    const startTime = performance.now();
    
    console.log('=== getVehicleMileageSummary DEBUG ===');
    console.log('Parameters:', { locationCode, creditlistId, fromDate, toDate });

    return db.sequelize.query(`
        WITH all_vehicle_transactions AS (
            SELECT 
                tc.vehicle_id,
                mcv.vehicle_number,
                mcv.vehicle_type,
                tc.qty as fuel_quantity,
                tc.odometer_reading,
                tc.amount,
                tcl.closing_date,
                tc.bill_no,
                LAG(tc.odometer_reading) OVER (
                    PARTITION BY tc.vehicle_id 
                    ORDER BY tcl.closing_date, tc.bill_no
                ) as prev_odometer_reading,
                -- Check if this vehicle has ANY historical data before this transaction
                COUNT(*) OVER (
                    PARTITION BY tc.vehicle_id 
                    ORDER BY tcl.closing_date, tc.bill_no 
                    ROWS UNBOUNDED PRECEDING
                ) as transaction_sequence_number
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            JOIN m_creditlist_vehicles mcv ON tc.vehicle_id = mcv.vehicle_id
            WHERE tcl.location_code = :locationCode
              AND tc.creditlist_id = :creditlistId
              AND tc.vehicle_id IS NOT NULL
        ),
        filtered_transactions AS (
            SELECT 
                vehicle_id,
                vehicle_number,
                vehicle_type,
                fuel_quantity,
                amount,
                closing_date,
                odometer_reading,
                prev_odometer_reading,
                transaction_sequence_number
            FROM all_vehicle_transactions
            WHERE DATE(closing_date) BETWEEN :fromDate AND :toDate
        ),
        mileage_calculations AS (
            SELECT 
                vehicle_id,
                vehicle_number,
                vehicle_type,
                fuel_quantity,
                amount,
                closing_date,
                odometer_reading,
                prev_odometer_reading,
                transaction_sequence_number,
                CASE 
                    WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 0
                    WHEN prev_odometer_reading IS NULL THEN 0
                    WHEN odometer_reading < prev_odometer_reading THEN 0  -- Invalid reading
                    ELSE COALESCE(odometer_reading - prev_odometer_reading, 0)
                END as distance_run,
                CASE 
                    WHEN prev_odometer_reading IS NOT NULL 
                         AND fuel_quantity > 0 
                         AND odometer_reading IS NOT NULL 
                         AND odometer_reading > 0
                         AND odometer_reading >= prev_odometer_reading  -- Valid reading
                    THEN (odometer_reading - prev_odometer_reading) / fuel_quantity
                    ELSE NULL
                END as mileage_kmpl,
                -- Detailed status for each transaction
                CASE 
                    WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 'missing_odometer'
                    WHEN transaction_sequence_number = 1 THEN 'first_entry'
                    WHEN prev_odometer_reading IS NULL THEN 'no_previous_reading'
                    WHEN odometer_reading < prev_odometer_reading THEN 'invalid_reading'
                    ELSE 'valid_calculation'
                END as transaction_status
            FROM filtered_transactions
        )
        SELECT 
            vehicle_id,
            vehicle_number,
            vehicle_type,
            COUNT(*) as total_transactions,
            COUNT(CASE WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 1 END) as missing_odometer_count,
            COUNT(CASE WHEN transaction_status = 'first_entry' THEN 1 END) as first_entry_count,
            COUNT(CASE WHEN transaction_status = 'invalid_reading' THEN 1 END) as invalid_reading_count,
            COUNT(CASE WHEN mileage_kmpl IS NOT NULL THEN 1 END) as valid_mileage_transactions,
            ROUND(SUM(fuel_quantity), 2) as total_fuel_consumed,
            SUM(distance_run) as total_distance,
            MAX(CASE WHEN odometer_reading > 0 THEN odometer_reading END) as last_odometer_reading,
            ROUND(AVG(mileage_kmpl), 2) as avg_mileage,
            ROUND(MIN(mileage_kmpl), 2) as min_mileage,
            ROUND(MAX(mileage_kmpl), 2) as max_mileage,
            MAX(closing_date) as last_transaction_date,
            -- Enhanced data quality status
            CASE 
                WHEN COUNT(CASE WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 1 END) > 0 
                THEN 'missing_odometer'
                WHEN COUNT(CASE WHEN transaction_status = 'invalid_reading' THEN 1 END) > 0
                THEN 'invalid_readings'
                WHEN COUNT(*) = COUNT(CASE WHEN transaction_status = 'first_entry' THEN 1 END)
                THEN 'all_first_entries'
                WHEN COUNT(CASE WHEN mileage_kmpl IS NOT NULL THEN 1 END) = 0 
                THEN 'no_mileage_data'
                WHEN COUNT(CASE WHEN mileage_kmpl IS NOT NULL THEN 1 END) < COUNT(*)
                THEN 'partial_mileage_data'
                ELSE 'good'
            END as data_quality_status
        FROM mileage_calculations
        GROUP BY vehicle_id, vehicle_number, vehicle_type
        ORDER BY vehicle_number
    `, {
        replacements: { locationCode, creditlistId, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    }).then(results => {        
        return results;
    })
    .catch(error => {
        const queryTime = performance.now() - startTime;
        console.error(`getVehicleMileageSummary failed after ${msToSeconds(queryTime)}s:`, error);
        throw error;
    });
},

    // Fleet-level summary
  getFleetSummary: (locationCode, creditlistId, fromDate, toDate) => {
    const startTime = performance.now();

    return db.sequelize.query(`
        WITH all_transactions AS (
            SELECT 
                tc.vehicle_id,
                tc.qty as fuel_quantity,
                tc.amount,
                tc.odometer_reading,
                LAG(tc.odometer_reading) OVER (
                    PARTITION BY tc.vehicle_id 
                    ORDER BY tcl.closing_date, tc.bill_no
                ) as prev_odometer_reading
            FROM t_credits tc
            JOIN t_closing tcl ON tc.closing_id = tcl.closing_id
            WHERE tcl.location_code = :locationCode
              AND tc.creditlist_id = :creditlistId
              AND tc.vehicle_id IS NOT NULL
              AND DATE(tcl.closing_date) BETWEEN :fromDate AND :toDate
        ),
        fleet_calculations AS (
            SELECT 
                vehicle_id,
                fuel_quantity,
                amount,
                CASE 
                    WHEN odometer_reading IS NULL OR odometer_reading = 0 THEN 0
                    WHEN prev_odometer_reading IS NULL THEN 0
                    ELSE COALESCE(odometer_reading - prev_odometer_reading, 0)
                END as distance_run,
                CASE 
                    WHEN prev_odometer_reading IS NOT NULL 
                         AND fuel_quantity > 0 
                         AND odometer_reading IS NOT NULL 
                         AND odometer_reading > 0
                    THEN (odometer_reading - prev_odometer_reading) / fuel_quantity
                    ELSE NULL
                END as mileage_kmpl
            FROM all_transactions
        )
        SELECT 
            COUNT(DISTINCT vehicle_id) as total_vehicles,
            COUNT(*) as total_transactions,
            ROUND(SUM(fuel_quantity), 2) as total_fuel_consumed,
            SUM(distance_run) as total_distance,
            ROUND(SUM(amount), 2) as total_fuel_cost,
            ROUND(AVG(CASE WHEN mileage_kmpl IS NOT NULL THEN mileage_kmpl END), 2) as fleet_avg_mileage,
            ROUND(SUM(distance_run) / NULLIF(SUM(fuel_quantity), 0), 2) as fleet_overall_mileage
        FROM fleet_calculations
    `, {
        replacements: { locationCode, creditlistId, fromDate, toDate },
        type: Sequelize.QueryTypes.SELECT
    }).then(results => results)
    .catch(error => {
        const queryTime = performance.now() - startTime;
        console.error(`getFleetSummary failed after ${msToSeconds(queryTime)}s:`, error);
        throw error;
    });
},

    // Vehicles with no mileage data (for alerts)
    getVehiclesWithoutMileageData: (locationCode, creditlistId, fromDate, toDate) => {
        const startTime = performance.now();

         // Add this logging
        console.log('=== getVehiclesWithoutMileageData DEBUG ===');
        console.log('Parameters:', { locationCode, creditlistId, fromDate, toDate });

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
        }).then(results => results)
          .catch(error => {
              const queryTime = performance.now() - startTime;
              console.error(`getVehiclesWithoutMileageData failed after ${msToSeconds(queryTime)}s:`, error);
              throw error;
          });
    },

    // Mileage trend data for charts
    getMileageTrendData: (locationCode, creditlistId, fromDate, toDate) => {
        const startTime = performance.now();

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
        }).then(results => results)
          .catch(error => {
              const queryTime = performance.now() - startTime;
              console.error(`getMileageTrendData failed after ${msToSeconds(queryTime)}s:`, error);
              throw error;
          });
    }
};
