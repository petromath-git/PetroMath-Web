const MileageDao = require("../dao/mileage-dao");
const dateFormat = require('dateformat');
const moment = require('moment');
const { performance } = require('perf_hooks');

const msToSeconds = ms => (ms / 1000).toFixed(3);

module.exports = {
    // Main dashboard page for customers
    getMileageDashboard: async (req, res, next) => {
        try {
            const locationCode = req.user.location_code;
            const creditlistId = req.user.creditlist_id;
            
            // Default to last 3 months if no dates provided
            const today = new Date();
            const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            const lastDayOfCurrentMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);


            
            const fromDate = req.query.fromDate || dateFormat(threeMonthsAgo, "yyyy-mm-dd");
            const toDate = req.query.toDate || dateFormat(lastDayOfCurrentMonth, "yyyy-mm-dd");

            // Time DB queries
            const dbStartTime = performance.now();

            const fleetSummary = await MileageDao.getFleetSummary(locationCode, creditlistId, fromDate, toDate);
            const vehicleSummaries = await MileageDao.getVehicleMileageSummary(locationCode, creditlistId, fromDate, toDate);
            const detailedData = await MileageDao.getMileageData(locationCode, creditlistId, fromDate, toDate);
            const trendData = await MileageDao.getMileageTrendData(locationCode, creditlistId, fromDate, toDate);
            const vehiclesWithoutData = await MileageDao.getVehiclesWithoutMileageData(locationCode, creditlistId, fromDate, toDate);

            const totalDbTime = performance.now() - dbStartTime;
            console.log(`   TOTAL DB TIME:        ${msToSeconds(totalDbTime)}s`);

            // Process data
            const dashboardData = processMileageDataForDashboard({
                fleetSummary: fleetSummary[0] || {},
                vehicleSummaries,
                detailedData,
                trendData,
                vehiclesWithoutData
            });

            // Format dates for display
            const formattedFromDate = moment(fromDate).format('DD/MM/YYYY');
            const formattedToDate = moment(toDate).format('DD/MM/YYYY');

            res.render('mileage-dashboard', {
                title: 'Vehicle Mileage Dashboard',
                user: req.user,
                fromDate,
                toDate,
                formattedFromDate,
                formattedToDate,
                ...dashboardData,
                messages: req.flash()
            });

        } catch (error) {
            console.error('Error in getMileageDashboard:', error);
            req.flash('error', 'Failed to load mileage dashboard: ' + error.message);
            res.redirect('/reports-indiv-customer');
        }
    },

    // API endpoint for AJAX requests to refresh dashboard data
   getMileageDataAPI: async (req, res) => {
    try {
        const locationCode = req.user.location_code;
        const creditlistId = req.user.creditlist_id;
        const fromDate = req.query.fromDate || req.body.fromDate;
        const toDate = req.query.toDate || req.body.toDate;

        if (!fromDate || !toDate) {
            return res.status(400).json({
                success: false,
                error: 'fromDate and toDate parameters are required'
            });
        }

        // Fetch all required data
        const [
            fleetSummary,
            vehicleSummaries,
            detailedData,
            trendData,
            vehiclesWithoutData
        ] = await Promise.all([
            MileageDao.getFleetSummary(locationCode, creditlistId, fromDate, toDate),
            MileageDao.getVehicleMileageSummary(locationCode, creditlistId, fromDate, toDate),
            MileageDao.getMileageData(locationCode, creditlistId, fromDate, toDate),
            MileageDao.getMileageTrendData(locationCode, creditlistId, fromDate, toDate),
            MileageDao.getVehiclesWithoutMileageData(locationCode, creditlistId, fromDate, toDate)
        ]);

       
        // Process and return data
        const processedData = processMileageDataForDashboard({
            fleetSummary: fleetSummary[0] || {},
            vehicleSummaries,
            detailedData,
            trendData,
            vehiclesWithoutData
        });

        
        res.json({
            success: true,
            data: processedData
        });

    } catch (error) {
        console.error('Error in getMileageDataAPI:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch mileage data: ' + error.message
        });
    }
},

    // Get mileage data for a specific vehicle (for detailed view)
    getVehicleMileageDetails: async (req, res) => {
        try {
            const locationCode = req.user.location_code;
            const creditlistId = req.user.creditlist_id;
            const vehicleId = req.params.vehicleId;
            const fromDate = req.query.fromDate;
            const toDate = req.query.toDate;

            if (!vehicleId) {
                return res.status(400).json({
                    success: false,
                    error: 'vehicleId parameter is required'
                });
            }

            // Get detailed data for specific vehicle
            const detailedData = await MileageDao.getMileageData(locationCode, creditlistId, fromDate, toDate);
            const vehicleData = detailedData.filter(item => item.vehicle_id == vehicleId);

            if (vehicleData.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No data found for this vehicle in the specified date range'
                });
            }

            res.json({
                success: true,
                data: {
                    vehicle_number: vehicleData[0].vehicle_number,
                    vehicle_type: vehicleData[0].vehicle_type,
                    transactions: vehicleData.map(item => ({
                        date: item.transaction_date,
                        bill_no: item.bill_no,
                        fuel_quantity: parseFloat(item.fuel_quantity),
                        odometer_reading: parseFloat(item.odometer_reading),
                        distance_run: parseFloat(item.distance_run),
                        mileage_kmpl: parseFloat(item.mileage_kmpl),
                        fuel_cost: parseFloat(item.amount),
                        product_name: item.product_name,
                        notes: item.notes
                    }))
                }
            });

        } catch (error) {
            console.error('Error in getVehicleMileageDetails:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch vehicle details: ' + error.message
            });
        }
    },

    // Future: Save external fuel purchases (placeholder for now)
    saveExternalFuelPurchase: async (req, res) => {
        try {
            // This is a placeholder for future implementation
            // Will save external fuel purchases to a separate table
            res.status(501).json({
                success: false,
                message: 'External fuel purchase feature is coming soon'
            });
        } catch (error) {
            console.error('Error in saveExternalFuelPurchase:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save external fuel purchase: ' + error.message
            });
        }
    }
};

// Helper function to process raw data for dashboard display
function processMileageDataForDashboard(rawData) {
    const { fleetSummary, vehicleSummaries, detailedData, trendData, vehiclesWithoutData } = rawData;

    // Process fleet summary
    const processedFleetSummary = {
        totalVehicles: fleetSummary.total_vehicles || 0,
        totalTransactions: fleetSummary.total_transactions || 0,
        totalFuelConsumed: fleetSummary.total_fuel_consumed || 0,
        totalDistance: fleetSummary.total_distance || 0,
        totalFuelCost: fleetSummary.total_fuel_cost || 0,
        fleetAvgMileage: parseFloat(fleetSummary.fleet_avg_mileage) || 0,
        fleetOverallMileage: fleetSummary.fleet_overall_mileage || 0
    };

    // Process vehicle summaries with data quality indicators
    // In processMileageDataForDashboard, update the vehicle summaries:
const processedVehicleSummaries = vehicleSummaries.map(vehicle => ({
    vehicle_id: vehicle.vehicle_id,
    vehicle_number: vehicle.vehicle_number,
    vehicle_type: vehicle.vehicle_type,
    totalTransactions: vehicle.total_transactions,
    missingOdometerCount: vehicle.missing_odometer_count || 0,
    firstEntryCount: vehicle.first_entry_count || 0,        // Add this
    invalidReadingCount: vehicle.invalid_reading_count || 0, // Add this
    validMileageTransactions: vehicle.valid_mileage_transactions || 0,
    totalFuelConsumed: parseFloat(vehicle.total_fuel_consumed) || 0,
    totalDistance: vehicle.total_distance || 0,
    lastOdometerReading: vehicle.last_odometer_reading || 0,
    avgMileage: parseFloat(vehicle.avg_mileage) || 0,
    minMileage: parseFloat(vehicle.min_mileage) || 0,
    maxMileage: parseFloat(vehicle.max_mileage) || 0,
    lastTransactionDate: vehicle.last_transaction_date,
    dataQualityStatus: vehicle.data_quality_status || 'unknown',
    performanceStatus: getPerformanceStatus(parseFloat(vehicle.avg_mileage)),
    hasDataQualityIssues: vehicle.data_quality_status !== 'good',
    dataQualityMessage: getDataQualityMessage(
        vehicle.data_quality_status, 
        vehicle.missing_odometer_count, 
        vehicle.first_entry_count,      // Add this
        vehicle.invalid_reading_count,  // Add this
        vehicle.valid_mileage_transactions
    )
}));

   // Process detailed transaction data 
        const processedDetailedData = detailedData
            .map(item => ({
                transaction_date: item.transaction_date,
                vehicle_number: item.vehicle_number,
                vehicle_type: item.vehicle_type,
                bill_no: item.bill_no,
                fuel_quantity: parseFloat(item.fuel_quantity) || 0,
                odometer_reading: parseFloat(item.odometer_reading) || 0,
                distance_run: parseFloat(item.distance_run) || 0,
                mileage_kmpl: parseFloat(item.mileage_kmpl) || 0,
                fuel_cost: parseFloat(item.amount) || 0,
                product_name: item.product_name,
                notes: item.notes,
                mileage_status: item.mileage_status || 'unknown',
                performanceStatus: getPerformanceStatus(parseFloat(item.mileage_kmpl))
            }))
            .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

    // Process trend data
    const processedTrendData = groupTrendDataByVehicle(trendData);

    // Process vehicles without data
    const processedAlertsData = vehiclesWithoutData.filter(vehicle =>
        vehicle.fuel_transactions === 0 || vehicle.missing_odometer_count > 0
    );

    return {
        fleetSummary: processedFleetSummary,
        vehicleSummaries: processedVehicleSummaries,
        detailedData: processedDetailedData,
        trendData: processedTrendData,
        vehiclesWithoutData: processedAlertsData
    };
}


// Helper function to determine performance status based on mileage
function getPerformanceStatus(mileage) {
    if (mileage >= 6.0) return { status: 'excellent', class: 'success', label: 'Excellent' };
    if (mileage >= 4.5) return { status: 'good', class: 'warning', label: 'Good' };
    if (mileage >= 3.0) return { status: 'average', class: 'info', label: 'Average' };
    return { status: 'poor', class: 'danger', label: 'Needs Attention' };
}

// Helper function to group trend data by vehicle for charts
function groupTrendDataByVehicle(trendData) {
    const grouped = {};
    
    trendData.forEach(item => {
        if (!grouped[item.vehicle_number]) {
            grouped[item.vehicle_number] = {
                vehicle_id: item.vehicle_id,
                vehicle_number: item.vehicle_number,
                data: []
            };
        }
        
        grouped[item.vehicle_number].data.push({
            month: item["DATE_FORMAT(closing_date, '%Y-%m')"], 
            avgMileage: parseFloat(item.avg_monthly_mileage),
            transactionCount: item.transaction_count
        });
    });

    // Sort data by month for each vehicle
    Object.keys(grouped).forEach(vehicleNumber => {
        grouped[vehicleNumber].data.sort((a, b) => a.month.localeCompare(b.month));
    });

    return grouped;
}

// Helper function to get top performing vehicle
function getTopPerformingVehicle(vehicleSummaries) {
    if (!vehicleSummaries || vehicleSummaries.length === 0) return null;
    
    return vehicleSummaries.reduce((top, current) => {
        return (current.avgMileage > (top?.avgMileage || 0)) ? current : top;
    }, null);
}

// Helper function to get poor performing vehicles (below 4.0 KMPL)
function getPoorPerformingVehicles(vehicleSummaries) {
    if (!vehicleSummaries || vehicleSummaries.length === 0) return [];
    
    return vehicleSummaries
        .filter(vehicle => vehicle.avgMileage < 4.0)
        .sort((a, b) => a.avgMileage - b.avgMileage); // Worst first
}

// Helper function to get data quality message
// Enhanced helper function to get data quality message
function getDataQualityMessage(status, missingCount, firstEntryCount, invalidCount, validCount) {
    switch (status) {
        case 'missing_odometer':
            return `${missingCount} transaction(s) missing odometer reading`;
        case 'invalid_readings':
            return `${invalidCount} transaction(s) have invalid odometer readings`;
        case 'all_first_entries':
            return `${firstEntryCount} first-time transaction(s) - no historical data`;
        case 'no_mileage_data':
            return 'Cannot calculate mileage - no valid readings';
        case 'partial_mileage_data':
            return `${validCount} of ${missingCount + firstEntryCount + invalidCount + validCount} transactions have valid mileage`;
        case 'good':
            return `${validCount} valid mileage calculation(s)`;
        default:
            return 'Data quality unknown';
    }
}

function getMileageStatusMessage(status) {
    switch (status) {
        case 'missing_odometer':
            return 'Missing odometer reading';
        case 'first_entry':
            return 'First transaction - no previous data';
        case 'no_previous_reading':
            return 'Previous reading not available';
        case 'invalid_reading':
            return 'Invalid reading (lower than previous)';
        case 'valid_calculation':
            return 'Valid mileage calculation';
        default:
            return 'Unknown status';
    }
}