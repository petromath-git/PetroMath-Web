const TankDao = require("../dao/tank-dao");
const PumpDao = require("../dao/pump-dao");
const PumpTankDao = require("../dao/pump-tank-dao");
const dbMapping = require("../db/ui-db-field-mapping");
const dateFormat = require("dateformat");
const db = require("../db/db-connection");
const TankDipDao = require("../dao/tank-dip-dao");

exports.getTankDipEntry = async function (req, res, next) {
    try {
        const locationCode = req.user.location_code;
        const today = dateFormat(new Date(), "yyyy-mm-dd");
        
        // Get active tanks
        const tanks = await TankDao.findActiveTanks(locationCode);
        
       // Process each tank to include expanded dip chart       
       const tanksWithExpandedCharts = tanks.map(tank => {
        if (tank.m_tank_dipchart_header && tank.m_tank_dipchart_header.m_tank_dipchart_lines) {
            const expandedLines = calculateIntermediateDipCm(tank.m_tank_dipchart_header.m_tank_dipchart_lines);
            
            // Create a new tank object with the expanded dip chart
            return {
                ...tank,  // Spread the existing tank properties
                m_tank_dipchart_header: {
                    ...tank.m_tank_dipchart_header,
                    m_tank_dipchart_lines: expandedLines
                }
            };
        }
        return tank;
    });
        
        // Get active pumps
        const pumps = await PumpDao.findPumps(locationCode);
        
        // Get pump-tank mappings
        const pumpTankMappings = await PumpTankDao.findActiveMappings(locationCode);

        // Get today's existing dips
        const existingDips = await TankDipDao.findByDateLocation(locationCode, today);


          // Group the dips by tdip_id (Tank Dip ID) and create an array of readings for each dip
        const groupedDips = {};
        existingDips.forEach(dip => {
            if (!groupedDips[dip.tdip_id]) {
                groupedDips[dip.tdip_id] = {
                    ...dip, // Initial dip data
                    readings: [] // Create an array for the readings
                };
            }
            if (dip.reading) {
                groupedDips[dip.tdip_id].readings.push({
                    pump_code: dip.pump_code,
                    pump_make: dip.pump_make,
                    reading: dip.reading
                }); // Add the pump info along with reading to the respective dip
            }
        });

        // Convert the groupedDips object to an array
        const dipsWithReadings = Object.values(groupedDips);

        // Get the last readings for each tank's pumps
        const lastReadings = {};
        for (const tank of tanks) {
            const readings = await TankDipDao.getLatestPumpReadings(tank.tank_id);
            lastReadings[tank.tank_id] = readings;
        }        

        
        res.render('tank-dip', {
            title: 'Tank Dip Entry',
            user: req.user,
            tanks: tanksWithExpandedCharts,
            pumps: pumps,
            pumpTankMappings: pumpTankMappings,
            existingDips: dipsWithReadings,
            lastReadings: lastReadings,
            searchDate: today
        });
    } catch (error) {
        console.error('Error fetching tank dip data:', error);
        next(error);
    }
};

exports.saveTankDipData = async function (req, res, next) {
    try {
        console.log('1. Starting saveTankDipData');
        const tankDipData = dbMapping.newTankDip(req);
        
        console.log('2. Checking for existing dip with data:', {
            locationCode: req.user.location_code,
            tank_id: tankDipData.tank_id,
            dip_date: tankDipData.dip_date,
            dip_time: tankDipData.dip_time
        });

        // Direct query with a new connection
        const duplicateCheck = await db.sequelize.query(
            `SELECT tdip_id 
             FROM t_tank_dip td 
             WHERE td.location_code = :locationCode
             AND Date(td.dip_date) = :dip_date
             AND td.dip_time = :dip_time
             AND td.tank_id = :tank_id`,
            {
                replacements: { 
                    locationCode: req.user.location_code,
                    tank_id: tankDipData.tank_id,
                    dip_date: tankDipData.dip_date,
                    dip_time: tankDipData.dip_time
                },
                type: db.Sequelize.QueryTypes.SELECT
            }
        );

        console.log('3. Duplicate check result:', duplicateCheck);

        if (duplicateCheck && duplicateCheck.length > 0) {
            console.log('4. Found duplicate, redirecting');
            req.flash('error', 'Dip reading already exists for this tank at this time');
            return res.redirect('/tank-dip');
        }

        // Continue with save if no duplicate
        console.log('5. Starting save transaction');
        const t = await db.sequelize.transaction();
        
        try {
            // Save tank dip
            const tankDip = await TankDipDao.create(tankDipData, { transaction: t });
            
            // Save pump readings
            const pumpReadings = {};
            Object.keys(req.body).forEach(key => {
                if (key.startsWith('pump_reading_')) {
                    const pumpId = key.replace('pump_reading_', '');
                    pumpReadings[pumpId] = req.body[key];
                }
            });

            console.log('Processed pump readings:', pumpReadings);
           

            const readingPromises = Object.entries(pumpReadings).map(([pump_id, reading]) => {
                return TankDipDao.createPumpReading({
                    tdip_id: tankDip.tdip_id,
                    pump_id: parseInt(pump_id),
                    reading: reading,
                    created_by: req.user.User_Name,
                    location_code: req.user.location_code,
                    creation_date: new Date()
                }, { transaction: t });
            });

            await Promise.all(readingPromises);
            await t.commit();
            
            req.flash('success', 'Tank dip and readings saved successfully');
            return res.redirect('/tank-dip');
        } catch (txError) {
            console.error('6. Transaction error:', txError);
            await t.rollback();
            throw txError;
        }
    } catch (error) {
        console.error('Error in saveTankDipData:', error);
        req.flash('error', 'Failed to save tank dip data: ' + error.message);
        return res.redirect('/tank-dip');
    }
};
exports.deleteTankDip = async function (req, res, next) {
    try {
        const tdip_id = req.body.tdip_id;
        const locationCode = req.user.location_code;

        // // Check if dip exists and belongs to user's location
        // const dip = await TankDipDao.findById(tdip_id);
        // if (!dip || dip.location_code !== locationCode) {
        //     return res.status(403).json({ error: 'Access denied or record not found' });
        // }

        await TankDipDao.delete(tdip_id);
        res.status(200).json({ success: true, message: 'Tank dip deleted successfully' });
    } catch (error) {
        console.error('Error deleting tank dip:', error);
        res.status(500).json({ success: false, error: 'Failed to delete tank dip' });
    }
};

exports.searchDips = async function (req, res, next) {
    try {
        const locationCode = req.user.location_code;
        const searchDate = req.query.date || dateFormat(new Date(), "yyyy-mm-dd");
        const tank_id = req.query.tank_id;

        let dips;
        if (tank_id) {
            dips = await TankDipDao.findByDateAndTank(locationCode, searchDate, tank_id);
        } else {
            dips = await TankDipDao.findByDateLocation(locationCode, searchDate);
        }

        if (req.xhr) {
            res.json(dips);
        } else {
            const tanks = await TankDao.findActiveTanks(locationCode);
            res.render('tank-dip-list', {
                title: 'Tank Dips',
                user: req.user,
                dips: dips,
                tanks: tanks,
                searchDate: searchDate,
                selectedTank: tank_id
            });
        }
    } catch (error) {
        console.error('Error searching tank dips:', error);
        if (req.xhr) {
            res.status(500).json({ error: 'Failed to fetch tank dips' });
        } else {
            next(error);
        }
    }
};

exports.validateDip = async function (req, res) {
    try {
        const { tank_id, dip_date, dip_time } = req.query;
        const locationCode = req.user.location_code;

        console.log('Validating dip with params:', {
            locationCode,
            tank_id,
            dip_date,
            dip_time
        });

        const existingDip = await TankDipDao.findExistingDip(
            locationCode,
            tank_id,
            dip_date,
            dip_time
        );

        console.log('Validation result:', existingDip);

        // Since we're getting an array from the raw query
        // Check if array has any elements
        const exists = Array.isArray(existingDip) && existingDip.length > 0;

        res.json({
            exists: exists,
            message: exists ? 'Dip reading already exists for this time' : null
        });

    } catch (error) {
        console.error('Error validating tank dip:', error);
        res.status(500).json({ 
            error: 'Validation failed',
            message: 'Please try again'
        });
    }
};

function calculateIntermediateDipCm(dipChartLines) {
    let result = [];
    
    const sortedLines = [...dipChartLines].sort((a, b) => 
        parseFloat(a.dip_cm) - parseFloat(b.dip_cm)
    );

    for (let i = 0; i < sortedLines.length - 1; i++) {
        const currentLine = sortedLines[i];
        const nextLine = sortedLines[i + 1];
        
        // Add the base reading (e.g., 1.0 cm = 11.97 liters)
        let lastVolume = parseFloat(currentLine.volume_liters);
        const diffPerMm = parseFloat(currentLine.diff_liters_mm);
        const baseDipCm = parseFloat(currentLine.dip_cm);

        result.push({
            dip_cm: baseDipCm.toFixed(1),
            volume_liters: lastVolume.toFixed(2),
            diff_liters_mm: diffPerMm.toFixed(2)
        });

        // Generate intermediate values
        for (let j = 1; j <= 9; j++) {
            const newDipCm = baseDipCm + (j * 0.1);
            lastVolume = lastVolume + diffPerMm;  // Add diff_liters_mm for each 0.1 cm

            result.push({
                dip_cm: newDipCm.toFixed(1),
                volume_liters: lastVolume.toFixed(2),
                diff_liters_mm: diffPerMm.toFixed(2)
            });
        }
    }

    // Add the last line
    const lastLine = sortedLines[sortedLines.length - 1];
    result.push({
        dip_cm: parseFloat(lastLine.dip_cm).toFixed(1),
        volume_liters: parseFloat(lastLine.volume_liters).toFixed(2),
        diff_liters_mm: parseFloat(lastLine.diff_liters_mm).toFixed(2)
    });
    
    return result;
}