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
    $('.delete-dip').click(function() {
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
    console.log(connectedPumps)
    connectedPumps.forEach(pump => {  
       
        const pumpHtml = `
            <div class="col-md-4 mb-3">
                <div class="form-group">
                    <label>${pump.pump_code} (${pump.pump_make})</label>
                    <input
                        type="number"
                        name="pump_reading_${pump.pump_id}"
                        class="form-control"
                        step="0.001"
                        min="0"
                        value="${pump.reading || ''}"  // Ensure the value is set correctly
                        required
                    >
                </div>
            </div>
        `;
        console.log(pumpHtml);
        $('#pumpReadingsContainer').append(pumpHtml);
    });

    $('#connectedPumpsSection').show();
    $('#noPumpsMessage').hide();
}

async function validateAndSubmit() {
    const tankId = $('#tank_id').val();
    const dipDate = $('#dip_date').val();
    const dipTime = $('#dip_time').val();

    try {
        const response = await $.get('/tank-dip/validate', {
            tank_id: tankId,
            dip_date: dipDate,
            dip_time: dipTime
        });

        if (response.exists) {
            showSnackbar(response.message, 'danger');
        } else {
            $('#tankDipForm')[0].submit();
        }
    } catch (error) {
        showSnackbar('Error validating dip data', 'danger');
    }
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