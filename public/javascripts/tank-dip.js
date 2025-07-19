$(document).ready(function() {
     // Get current date and time in IST
     const today = new Date().toLocaleString('en-US', { 
        timeZone: 'Asia/Kolkata' 
    });
    const istDate = new Date(today);
    
    const currentDate = istDate.toISOString().split('T')[0];
    const currentTime = istDate.toTimeString().slice(0,5);

    // Set min and max to current date (only allowing today)
    $('#dip_date').attr('min', currentDate);
    $('#dip_date').attr('max', currentDate);
    $('#dip_date').val(currentDate);
    

    // Validation for date and time
    $('#dip_date, #dip_time').on('change', function() {
        const selectedDate = $('#dip_date').val();
        const selectedTime = $('#dip_time').val();
        const now = moment();
        
        // Force the date to be today
        if (selectedDate !== currentDate) {
            alert('Only current date is allowed');
            $('#dip_date').val(currentDate);
            return;
        }

          // Prevent future time
          if (selectedTime > now.format('HH:mm')) {
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


function updateTankInfo(tankId) {
    if (!tankId) {
        $('#tankInfo, #connectedPumpsSection, #noPumpsMessage').hide();
        return;
    }

    const selectedOption = $(`#tank_id option[value="${tankId}"]`);
    const tank = tanks.find(t => t.tank_id === parseInt(tankId));
    
    if (tank) {
        $('#productCode').text(tank.product_code);
        $('#tankCapacity').text(`${tank.tank_orig_capacity} liters`);
        $('#deadStock').text(`${tank.dead_stock} liters`);
        $('#tankInfo').show();

        // Update dip reading dropdown
        const dipSelect = $('#dip_reading');
        dipSelect.empty();
        dipSelect.append('<option value="">-- Select Dip Value --</option>');

        if (tank.m_tank_dipchart_header && tank.m_tank_dipchart_header.m_tank_dipchart_lines) {
            tank.m_tank_dipchart_header.m_tank_dipchart_lines.forEach(line => {
                dipSelect.append(`
                    <option value="${line.dip_cm}" 
                            data-volume="${line.volume_liters}">
                        <strong>${line.dip_cm}</strong> cm (${line.volume_liters} liters)
                    </option>
                `);
            });
        }

        // Handle dip selection change
        dipSelect.off('change').on('change', function() {
            const selectedOption = $(this).find('option:selected');
            const volume = selectedOption.data('volume');
            if (volume) {
                // You could display volume information if needed
                console.log(`Selected dip corresponds to ${volume} liters`);
            }
        });

        updatePumpReadings(tankId);
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
        const pumpHtml = `
            <div class="col-md-4 mb-3">
                <div class="form-group">
                    <label>${pump.pump_code} (${pump.pump_make})
                      ${lastReading ? 
                            `<span class="text-muted ml-2">Last: ${lastReading.reading}</span>` : 
                            ''}
                    </label>
                    <input
                        type="number"
                        name="pump_reading_${pump.pump_id}"
                        class="form-control form-control-sm pump-reading-input"
                        step="0.001"
                        min="0"
                        ${lastReading?.reading ? `data-last="${lastReading.reading}"` : ''}
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

    $('#connectedPumpsSection').show();
    $('#noPumpsMessage').hide();
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
        const dipReading = $('#dip_reading').val();

        if (!tankId || !dipDate || !dipTime || !dipReading) {
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