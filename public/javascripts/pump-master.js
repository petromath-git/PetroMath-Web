function formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString();
}

function formatDateForInput(date) {
    if (!date) return '';
    return new Date(date).toISOString().split('T')[0];
}

$(document).ready(function() {

    console.log('Available data:', {
        pumps: pumps,
        pumpTankMappings: pumpTankMappings
    });

    // Initialize any Bootstrap tooltips
    $('[data-toggle="tooltip"]').tooltip();

   

    // Set default dates
    const today = new Date();
    $('#effectiveStartDate').val(formatDateForInput(today));

    // Add Pump Form Submission
    $('#addPumpBtn').click(function(e) {
        e.preventDefault();
        
        const formData = {
            pump_code: $('#pumpCode').val(),
            pump_make: $('#pumpMake').val(),
            product_code: $('#productCode').val(),
            opening_reading: $('#openingReading').val(),
            current_stamping_date: $('#stampingDate').val(),
            Stamping_due: $('#stampingDue').val()
        };

        // Validate required fields
        const requiredFields = ['pump_code', 'pump_make', 'product_code', 'opening_reading', 
                              'current_stamping_date', 'Stamping_due'];
        
        for (const field of requiredFields) {
            if (!formData[field]) {
                alert(`Please fill in all required fields`);
                return;
            }
        }

        // Send AJAX request
        $.ajax({
            url: '/pumps',
            type: 'POST',
            data: formData,
            success: function(response) {
                if (response.success) {
                    location.reload();
                } else {
                    alert(response.message || 'Error saving pump');
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Error saving pump');
            }
        });
    });

    // Edit Pump Form Submission
    $('#updatePumpBtn').click(function(e) {
        e.preventDefault();
        
        const pumpId = $('#editPumpId').val();
        const formData = {
            pump_code: $('#editPumpCode').val(),
            pump_make: $('#editPumpMake').val(),
            product_code: $('#editProductCode').val(),
            opening_reading: $('#editOpeningReading').val(),
            current_stamping_date: $('#editStampingDate').val(),
            Stamping_due: $('#editStampingDue').val()
        };

        // Validate required fields
        const requiredFields = ['pump_code', 'pump_make', 'product_code', 'opening_reading',
                              'current_stamping_date', 'Stamping_due'];
        
        for (const field of requiredFields) {
            if (!formData[field]) {
                alert(`Please fill in all required fields`);
                return;
            }
        }

        // Send AJAX request
        $.ajax({
            url: `/pumps/${pumpId}`,
            type: 'PUT',
            data: formData,
            success: function(response) {
                if (response.success) {
                    location.reload();
                } else {
                    alert(response.message || 'Error updating pump');
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Error updating pump');
            }
        });
    });

    $('#linkPumpId').on('change', function() {
        const selectedPumpId = $(this).val();
        const selectedProduct = $(this).find('option:selected').data('product');
        const tankSelect = $('#linkTankId');
        
        // Clear current tank options
        tankSelect.empty();
        tankSelect.append('<option value="">-- Select Tank --</option>');
        
        if (selectedPumpId) {
            // Filter tanks based on product code
            const matchingTanks = tanks.filter(tank => tank.product_code === selectedProduct);
            
            matchingTanks.forEach(tank => {
                tankSelect.append(
                    `<option value="${tank.tank_id}">${tank.tank_code} (${tank.product_code})</option>`
                );
            });
            
            if (matchingTanks.length === 0) {
                alert(`No tanks available for product ${selectedProduct}`);
            }
        }
    });


    // Add Pump-Tank Link Form Submission
    $('#addPumpTankBtn').click(function(e) {
        console.log('Link button clicked');
        e.preventDefault();
        
        const selectedPumpId = $('#linkPumpId').val();
        const selectedTankId = $('#linkTankId').val();

        console.log('Selected values:', {
            pumpId: selectedPumpId,
            tankId: selectedTankId
        });
        
        if (!selectedPumpId || !selectedTankId) {
            alert('Please select both pump and tank');
            return;
        }
    
        const selectedPump = pumps.find(p => p.pump_id.toString() === selectedPumpId);
        const selectedTank = tanks.find(t => t.tank_id.toString() === selectedTankId);
    
        if (!selectedPump || !selectedTank) {
            alert('Invalid pump or tank selection');
            return;
        }
    
        if (selectedPump.product_code !== selectedTank.product_code) {
            alert(`Tank product (${selectedTank.product_code}) does not match pump product (${selectedPump.product_code})`);
            return;
        }
    
        const formData = {
            pump_id: selectedPumpId,
            tank_id: selectedTankId,
            location_code: userLocationCode  // Use the location code from template
        };
    
        // Send AJAX request
        $.ajax({
            url: '/pump-tanks',
            type: 'POST',
            data: formData,
            success: function(response) {
                if (response.success) {
                    location.reload();
                } else {
                    alert(response.message || 'Error linking pump to tank');
                }
            },
            error: function(xhr) {
                alert(xhr.responseJSON?.message || 'Error linking pump to tank');
            }
        });
    });

    // Validation for opening reading
    $('#openingReading, #editOpeningReading').on('input', function() {
        const value = parseFloat($(this).val());
        if (value < 0) {
            alert('Opening reading cannot be negative');
            $(this).val('');
        }
    });

    // Validation for stamping dates
    $('#stampingDate, #editStampingDate').on('change', function() {
        const stampingDate = new Date($(this).val());
        const dueDate = new Date(stampingDate);
        dueDate.setFullYear(dueDate.getFullYear() + 1);
        
        const dueDateInput = $(this).attr('id') === 'stampingDate' ? 
            $('#stampingDue') : $('#editStampingDue');
        
        dueDateInput.val(formatDateForInput(dueDate));
    });
});


// Function to open edit modal
function editPump(pumpId) {
    const pump = pumps.find(p => p.pump_id === pumpId);
    if (!pump) {
        alert('Pump not found');
        return;
    }

    // Fill the form
    $('#editPumpId').val(pump.pump_id);
    $('#editPumpCode').val(pump.pump_code);
    $('#editPumpMake').val(pump.pump_make);
    $('#editProductCode').val(pump.product_code);
    $('#editOpeningReading').val(pump.opening_reading);
    $('#editStampingDate').val(formatDateForInput(pump.current_stamping_date));
    $('#editStampingDue').val(formatDateForInput(pump.Stamping_due));

    // Show the modal
    $('#editPumpModal').modal('show');
}

// Function to handle pump deactivation
function deactivatePump(pumpId) {
    if (!confirm('Are you sure you want to deactivate this pump?')) {
        return;
    }

    $.ajax({
        url: `/pumps/${pumpId}/deactivate`,
        type: 'PUT',
        success: function(response) {
            if (response.success) {
                location.reload();
            } else {
                alert(response.message || 'Error deactivating pump');
            }
        },
        error: function(xhr) {
            alert(xhr.responseJSON?.message || 'Error deactivating pump');
        }
    });
}

// Helper function for date formatting in inputs
function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
}