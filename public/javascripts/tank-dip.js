$(document).ready(function() {
    // Get current date and time in IST
        const today = new Date().toLocaleString('en-US', { 
            timeZone: 'Asia/Kolkata' 
        });
        const istDate = new Date(today);
        
        const currentDate = istDate.toISOString().split('T')[0];
        const currentTime = istDate.toTimeString().slice(0,5);

        // Get allowPastDate from the page (passed from server)
        const allowPastDate = window.allowPastDate || false;

        // Set date constraints based on config
        if (!allowPastDate) {
            $('#dip_date').attr('min', currentDate);
        }
        $('#dip_date').attr('max', currentDate);
        $('#dip_date').val(currentDate);
        
        // Validation for date and time
        $('#dip_date, #dip_time').on('change', function() {
            const selectedDate = $('#dip_date').val();
            const selectedTime = $('#dip_time').val();
            const now = moment();
            
            // Validate date only if past dates not allowed
            if (!allowPastDate && selectedDate !== currentDate) {
                alert('Only current date is allowed');
                $('#dip_date').val(currentDate);
                return;
            }
            
            // Prevent future dates (always)
            if (selectedDate > currentDate) {
                alert('Future dates are not allowed');
                $('#dip_date').val(currentDate);
                return;
            }

            // Prevent future time only for today's date
            if (selectedDate === currentDate && selectedTime > now.format('HH:mm')) {
                alert('Future time is not allowed');
                $('#dip_time').val(currentTime);
            }
        });
    

        // Tank selection handler
        $('#tank_id').change(function() {
            const tankId = $(this).val();
            updateTankInfo(tankId);
        });

        // Delete dip handler
        $(document).on('click', '.delete-dip', function() {
            if (confirm('Are you sure you want to delete this dip reading?')) {
                const dipId = $(this).data('dip-id');
                deleteDipReading(dipId);
            }
        });

    // Form validation
    $('#tankDipForm').submit(function(e) {
        e.preventDefault();
        validateAndSubmit();
    });
});


// Shared state for the currently selected tank's dip chart, used by both
// the dip volume display and the live tank-variance check.
const currentTankState = { dipVolumeMap: {}, maxDip: 0 };

function volumeForDip(dipCm) {
    if (isNaN(dipCm) || dipCm <= 0 || dipCm > currentTankState.maxDip) return null;
    const floor = Math.floor(dipCm);
    const frac  = dipCm - floor;
    const volFloor = currentTankState.dipVolumeMap[floor] || 0;
    const volCeil  = currentTankState.dipVolumeMap[floor + 1] || volFloor;
    return frac > 0 ? volFloor + frac * (volCeil - volFloor) : volFloor;
}

function updateTankInfo(tankId) {
    if (!tankId) {
        $('#tankInfo, #connectedPumpsSection, #noPumpsMessage').hide();
        $('#dip_reading').val('').prop('disabled', true);
        $('#dip_volume_display').text('--');
        $('#dip_variance_warning').hide();
        return;
    }

    const selectedOption = $(`#tank_id option[value="${tankId}"]`);
    const tank = tanks.find(t => t.tank_id === parseInt(tankId));

    if (tank) {
        $('#productCode').text(tank.product_code);
        $('#tankCapacity').text(`${tank.tank_orig_capacity} liters`);
        $('#deadStock').text(`${tank.dead_stock} liters`);
        $('#tankInfo').show();

        // Build lookup map: dip_cm (integer key) -> volume_liters
        const chartLines = (tank.m_tank_dipchart_header && tank.m_tank_dipchart_header.m_tank_dipchart_lines) || [];
        currentTankState.dipVolumeMap = {};
        currentTankState.maxDip = 0;
        chartLines.forEach(line => {
            const cm = Math.round(parseFloat(line.dip_cm));
            currentTankState.dipVolumeMap[cm] = parseFloat(line.volume_liters);
            if (cm > currentTankState.maxDip) currentTankState.maxDip = cm;
        });

        const dipInput = $('#dip_reading');
        dipInput.val('').prop('disabled', false);
        $('#dip_volume_display').text('--');
        $('#dip_variance_warning').hide();

        dipInput.off('input').on('input', function() {
            // Restrict to max 2 decimal places
            const val = $(this).val();
            const dotPos = val.indexOf('.');
            if (dotPos !== -1 && val.length - dotPos > 3) {
                $(this).val(val.substring(0, dotPos + 3));
            }

            const vol = volumeForDip(parseFloat($(this).val()));
            $('#dip_volume_display').text(vol !== null ? vol.toLocaleString('en-IN', {maximumFractionDigits: 2}) + ' L' : '--');
            recalcTankVariance();
        });

        updatePumpReadings(tankId);
    }
}

function recalcTankVariance() {
    const tankId = $('#tank_id').val();
    const baseline = tankBaseline[tankId];
    const warningEl = $('#dip_variance_warning');

    if (!baseline) { warningEl.hide(); return; }

    const dipVal = parseFloat($('#dip_reading').val());
    const openingVolume = volumeForDip(baseline.lastDipReading);
    const actualVolume = volumeForDip(dipVal);
    if (openingVolume === null || actualVolume === null) { warningEl.hide(); return; }

    let grossSales = 0;
    $('.pump-reading-input').each(function() {
        const last = parseFloat($(this).attr('data-last'));
        const cur = parseFloat($(this).val());
        if (!isNaN(last) && !isNaN(cur) && cur > last) {
            grossSales += (cur - last);
        }
    });

    const receipts = baseline.receiptsSinceLastDip || 0;
    const expected = openingVolume + receipts - grossSales;
    const variance = actualVolume - expected;

    if (Math.abs(variance) >= 100) {
        warningEl.attr('title',
            `Expected ~${expected.toFixed(0)} L (opening ${openingVolume.toFixed(0)} + receipts ${receipts.toFixed(0)} - sales ${grossSales.toFixed(0)}) | You entered ~${actualVolume.toFixed(0)} L | Diff: ${variance.toFixed(0)} L`
        ).show();
    } else {
        warningEl.hide();
    }
}






function updatePumpReadings(tankId) {
    console.log('tankId'+tankId)
    const connectedPumps = pumpTankMappings.filter(m => m.tank_id === parseInt(tankId));

    if (connectedPumps.length === 0) {
        $('#connectedPumpsSection').hide();
        $('#noPumpsMessage').show();
        return;
    }

    $('#pumpReadingsContainer').empty();

    connectedPumps.forEach(pump => {
        const lastReading = lastReadings[tankId]?.find(r => r.pump_id === pump.pump_id);
        const baseline = (pumpHistory[tankId] || {})[pump.pump_id];
        const pumpHtml = `
            <div class="col-md-4 mb-3">
                <div class="form-group">
                    <label>${pump.pump_code} (${pump.pump_make})
                      ${lastReading ?
                            `<span class="text-muted ml-2">Last: ${lastReading.reading}</span>` :
                            ''}
                      <span class="pump-deviation-warning text-warning font-weight-bold ml-1" style="display:none" title=""> ⚠</span>
                    </label>
                    <input
                        type="number"
                        name="pump_reading_${pump.pump_id}"
                        class="form-control form-control-sm pump-reading-input"
                        step="0.001"
                        min="0"
                        ${lastReading?.reading ? `data-last="${lastReading.reading}"` : ''}
                        ${baseline?.avgPerDay != null ? `data-avg-per-day="${baseline.avgPerDay}" data-last-ts="${baseline.lastTs}"` : ''}
                        value="${pump.reading || ''}"  // Ensure the value is set correctly
                        required
                    >
                </div>
            </div>
        `;
        console.log(pumpHtml);
        $('#pumpReadingsContainer').append(pumpHtml);
    });


      // Handle immediate validation on pump reading change
    $(document).off('change', '.pump-reading-input').on('change', '.pump-reading-input', function() {
        validatePumpReading(this);
    });

    $(document).off('input', '.pump-reading-input').on('input', '.pump-reading-input', function() {
        checkPumpReadingDeviation(this);
        recalcTankVariance();
    });

    $('#connectedPumpsSection').show();
    $('#noPumpsMessage').hide();
}

function checkPumpReadingDeviation(input) {
    const warningSpan = $(input).closest('.form-group').find('.pump-deviation-warning');
    const avgPerDay = parseFloat($(input).attr('data-avg-per-day'));
    const lastTs = parseFloat($(input).attr('data-last-ts'));
    const lastReading = parseFloat($(input).attr('data-last')) || 0;
    const currentReading = parseFloat($(input).val());

    if (isNaN(avgPerDay) || isNaN(lastTs) || isNaN(currentReading)) {
        warningSpan.hide();
        return;
    }

    const dipDate = $('#dip_date').val();
    const dipTime = $('#dip_time').val() || '00:00';
    const currentTs = dipDate ? new Date(`${dipDate}T${dipTime}`).getTime() : Date.now();
    const daysSince = Math.max((currentTs - lastTs) / 86400000, 1 / 24);

    const expectedDelta = avgPerDay * daysSince;
    const actualDelta = currentReading - lastReading;

    const lowerBound = Math.min(expectedDelta * 0.2, expectedDelta - 50);
    const upperBound = Math.max(expectedDelta * 5, expectedDelta + 50);

    if (actualDelta < lowerBound || actualDelta > upperBound) {
        warningSpan.attr('title', `Last: ${lastReading} | Usual change over ${daysSince.toFixed(1)} day(s): ~${expectedDelta.toFixed(0)} L | You entered: ${actualDelta.toFixed(0)} L`).show();
    } else {
        warningSpan.hide();
    }
}


function validatePumpReading(input) {
    const lastReading = parseFloat($(input).attr('data-last')) || 0;
    const currentReading = parseFloat($(input).val()) || 0;
    
    console.log('Validating pump reading:', {
        lastReading,
        currentReading,
        inputName: $(input).attr('name')
    });

    if (lastReading > 0 && currentReading < lastReading) {
        alert(`New reading (${currentReading}) must be greater than the last reading (${lastReading})`);
        $(input).val('');
        $(input).focus();
        return false;
    }
    return true;
}





// Consolidated validation and submit function
async function validateAndSubmit() {
    try {
        // Basic field validation
        const tankId = $('#tank_id').val();
        const dipDate = $('#dip_date').val();
        const dipTime = $('#dip_time').val();
        const dipReading = parseFloat($('#dip_reading').val());

        if (!tankId || !dipDate || !dipTime || isNaN(dipReading) || dipReading <= 0) {
            alert('Please fill all required fields');
            return;
        }

        // Duplicate check
        const response = await $.get('/tank-dip/validate', {
            tank_id: tankId,
            dip_date: dipDate,
            dip_time: dipTime
        });

        if (response.exists) {
            showError(response.message || 'Dip reading already exists for this time');
            return;
        }

        // Validate all pump readings
        let pumpReadingsValid = true;
        $('.pump-reading-input').each(function() {
            if (!validatePumpReading(this)) {
                pumpReadingsValid = false;
                return false; // break the loop
            }
        });

        if (!pumpReadingsValid) {
            return;
        }

        // If all validations pass, submit the form
        $('#submitBtn').prop('disabled', true).text('Saving...');
        $('#tankDipForm')[0].submit();

    } catch (error) {
        console.error('Validation error:', error);
        showError('Error validating data. Please try again.');
    }
}



function showError(message) {
    $('#snackbar')
        .text(message)
        .addClass('alert alert-danger')
        .show();
    
    setTimeout(() => {
        $('#snackbar').hide();
    }, 3000);
}

async function deleteDipReading(dipId) {
    try {
        const response = await $.ajax({
            url: '/tank-dip',
            method: 'DELETE',
            data: JSON.stringify({ tdip_id: dipId }),
            contentType: 'application/json'
        });

        if (response.success) {
            location.reload();
        } else {
            showSnackbar('Failed to delete dip reading', 'danger');
        }
    } catch (error) {
        showSnackbar('Error deleting dip reading', 'danger');
    }
}

function showSnackbar(message, type) {
    const snackbar = $('#snackbar');
    snackbar.text(message).addClass(`alert alert-${type}`).show();
    setTimeout(() => snackbar.hide(), 3000);
}