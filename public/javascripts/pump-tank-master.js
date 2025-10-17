// public/javascripts/pump-tank-master.js

$(document).ready(function() {
    let currentLocation = selectedLocation;
    let products = []; // Store products for dropdowns
    
    // Load products and tanks on page load
    loadProducts();
    loadTanks();
    
    // Location selector change event
    $('#locationSelector').change(function() {
        currentLocation = $(this).val();
        
        // Reload products for new location
        loadProducts();
        
        // Reload data for active tab
        const activeTab = $('.nav-link.active').attr('href');
        if (activeTab === '#tanks') {
            loadTanks();
        } else if (activeTab === '#pumps') {
            loadPumps();
        } else if (activeTab === '#relations') {
            loadRelations();
        }
    });
    
    // Tab change event - load data when tab is clicked
    $('#pumpTankTabs a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
        const target = $(e.target).attr("href");
        
        if (target === '#tanks') {
            loadTanks();
        } else if (target === '#pumps') {
            loadPumps();
        } else if (target === '#relations') {
            loadRelations();
        }
    });
    
    // ==================== PRODUCTS FUNCTIONS ====================
    
    function loadProducts() {
        $.ajax({
            url: '/masters/pump-tank/api/products',
            method: 'GET',
            data: { location_code: currentLocation },
            success: function(response) {
                if (response.success) {
                    products = response.products;
                    populateProductDropdowns();
                    populatePumpProductDropdowns(); // For pumps
                }
            },
            error: function(xhr) {
                console.error('Error loading products:', xhr);
            }
        });
    }
    
    function populateProductDropdowns() {
        let options = '<option value="">-- Select Product --</option>';
        products.forEach(product => {
            options += `<option value="${product.product_name}">${product.product_name}</option>`;
        });
        
        $('#addTankProduct').html(options);
        $('#editTankProduct').html(options);
    }
    
    // ==================== TANKS FUNCTIONS ====================
    
    function loadTanks() {
        showLoading('#tanksTable tbody', 7);
        showLoading('#tanksCardContainer', 1);
        
        $.ajax({
            url: '/masters/pump-tank/api/tanks',
            method: 'GET',
            data: { location_code: currentLocation },
            success: function(response) {
                if (response.success) {
                    renderTanksTable(response.tanks);
                    renderTanksCards(response.tanks);
                } else {
                    showError('Failed to load tanks');
                }
            },
            error: function(xhr) {
                showError('Error loading tanks: ' + (xhr.responseJSON?.error || xhr.statusText));
                $('#tanksTable tbody').html('<tr><td colspan="7" class="text-center text-danger">Error loading tanks</td></tr>');
                $('#tanksCardContainer').html('<div class="col-12 text-center text-danger">Error loading tanks</div>');
            }
        });
    }
    
    function renderTanksTable(tanks) {
        let html = '';
        
        if (tanks.length === 0) {
            html = '<tr><td colspan="7" class="text-center">No tanks found for this location</td></tr>';
        } else {
            tanks.forEach(tank => {
                const isActive = new Date(tank.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                html += `
                    <tr>
                        <td>${tank.tank_code}</td>
                        <td>
                            ${tank.product_code}
                            ${tank.rgb_color ? `<span class="ml-2" style="display:inline-block;width:15px;height:15px;background-color:${tank.rgb_color};border-radius:3px;"></span>` : ''}
                        </td>
                        <td>${Number(tank.tank_orig_capacity).toLocaleString()}</td>
                        <td>${Number(tank.tank_opening_stock || 0).toLocaleString()}</td>
                        <td>${Number(tank.dead_stock || 0).toLocaleString()}</td>
                        <td>${statusBadge}</td>
                        <td>
                            ${isActive ? `
                            <button class="btn btn-sm btn-outline-primary edit-tank-btn" data-id="${tank.tank_id}">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            <button class="btn btn-sm btn-outline-danger deactivate-tank-btn" data-id="${tank.tank_id}">
                                <i class="bi bi-trash"></i> Deactivate
                            </button>
                            ` : '<span class="text-muted">Inactive</span>'}
                        </td>
                    </tr>
                `;
            });
        }
        
        $('#tanksTable tbody').html(html);
    }
    
    function renderTanksCards(tanks) {
        let html = '';
        
        if (tanks.length === 0) {
            html = '<div class="col-12 text-center">No tanks found for this location</div>';
        } else {
            tanks.forEach(tank => {
                const isActive = new Date(tank.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                html += `
                    <div class="col-12 col-md-6 mb-3">
                        <div class="card master-card shadow-sm">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <strong>${tank.tank_code}</strong>
                                ${statusBadge}
                            </div>
                            <div class="card-body">
                                <div class="row g-2">
                                    <div class="col-6">
                                        <small class="text-muted">Product</small>
                                        <div class="fw-bold">
                                            ${tank.product_code}
                                            ${tank.rgb_color ? `<span class="ml-2" style="display:inline-block;width:15px;height:15px;background-color:${tank.rgb_color};border-radius:3px;"></span>` : ''}
                                        </div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Capacity</small>
                                        <div class="fw-bold">${Number(tank.tank_orig_capacity).toLocaleString()} L</div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Opening Stock</small>
                                        <div class="fw-bold">${Number(tank.tank_opening_stock || 0).toLocaleString()} L</div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Dead Stock</small>
                                        <div class="fw-bold">${Number(tank.dead_stock || 0).toLocaleString()} L</div>
                                    </div>
                                </div>
                                ${isActive ? `
                                <div class="row mt-3">
                                    <div class="col-6">
                                        <button class="btn btn-outline-primary btn-sm w-100 edit-tank-btn" data-id="${tank.tank_id}">
                                            <i class="bi bi-pencil"></i> Edit
                                        </button>
                                    </div>
                                    <div class="col-6">
                                        <button class="btn btn-outline-danger btn-sm w-100 deactivate-tank-btn" data-id="${tank.tank_id}">
                                            <i class="bi bi-trash"></i> Delete
                                        </button>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        $('#tanksCardContainer').html(html);
    }
    
    // ==================== TANK CRUD OPERATIONS ====================
    
    // Add Tank Button
    $('#addTankBtn').click(function() {
        $('#addTankForm')[0].reset();
        $('#addTankModal').modal('show');
    });
    
    
    // Save Tank Button
    $('#saveTankBtn').click(function() {
        // Hide any previous errors
        hideModalError('addTank');
        
        const tankCode = $('#addTankCode').val().trim().toUpperCase();
        const productCode = $('#addTankProduct').val();
        const capacity = $('#addTankCapacity').val();
        const openingStock = $('#addTankOpeningStock').val() || 0;
        const deadStock = $('#addTankDeadStock').val() || 0;
        
        // Client-side validation
        if (!tankCode || !productCode || !capacity) {
            showModalError('addTank', 'Please fill all required fields'); // CHANGED
            return;
        }
        
        // Validate tank code format
        const tankCodeRegex = /^[A-Z0-9-]{1,10}$/;
        if (!tankCodeRegex.test(tankCode)) {
            showModalError('addTank', 'Tank code can only contain letters, numbers, and hyphens (max 10 characters)'); // CHANGED
            return;
        }
        
        const data = {
            tank_code: tankCode,
            product_code: productCode,
            tank_orig_capacity: capacity,
            tank_opening_stock: openingStock,
            dead_stock: deadStock,
            location_code: currentLocation
        };
        
        // Disable button
        $('#saveTankBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Saving...');
        
        $.ajax({
            url: '/masters/pump-tank/api/tanks',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#addTankModal').modal('hide');
                    showSuccess('Tank created successfully');
                    loadTanks();
                } else {
                    showModalError('addTank', response.error || 'Failed to create tank'); // CHANGED
                }
            },
            error: function(xhr) {
                showModalError('addTank', xhr.responseJSON?.error || 'Error creating tank'); // CHANGED
            },
            complete: function() {
                $('#saveTankBtn').prop('disabled', false).html('<i class="bi bi-save me-1"></i>Save Tank');
            }
        });
    });
    
    // Edit Tank Button (Event delegation)
    $(document).on('click', '.edit-tank-btn', function() {
        const tankId = $(this).data('id');
        
        $.ajax({
            url: `/masters/pump-tank/api/tanks/${tankId}`,
            method: 'GET',
            success: function(response) {
                if (response.success) {
                    const tank = response.tank;
                    $('#editTankId').val(tank.tank_id);
                    $('#editTankCode').val(tank.tank_code);
                    $('#editTankProduct').val(tank.product_code);
                    $('#editTankCapacity').val(tank.tank_orig_capacity);
                    $('#editTankOpeningStock').val(tank.tank_opening_stock || 0);
                    $('#editTankDeadStock').val(tank.dead_stock || 0);
                    
                    $('#editTankModal').modal('show');
                } else {
                    showError('Failed to load tank details');
                }
            },
            error: function(xhr) {
                showError('Error loading tank details');
            }
        });
    });
    
    
    // Update Tank Button
    $('#updateTankBtn').click(function() {
        // Hide any previous errors
        hideModalError('editTank');
        
        const tankId = $('#editTankId').val();
        const tankCode = $('#editTankCode').val().trim().toUpperCase();
        const productCode = $('#editTankProduct').val();
        const capacity = $('#editTankCapacity').val();
        const openingStock = $('#editTankOpeningStock').val() || 0;
        const deadStock = $('#editTankDeadStock').val() || 0;
        
        // Client-side validation
        if (!tankCode || !productCode || !capacity) {
            showModalError('editTank', 'Please fill all required fields'); // CHANGED
            return;
        }
        
        // Validate tank code format
        const tankCodeRegex = /^[A-Z0-9-]{1,10}$/;
        if (!tankCodeRegex.test(tankCode)) {
            showModalError('editTank', 'Tank code can only contain letters, numbers, and hyphens (max 10 characters)'); // CHANGED
            return;
        }
        
        const data = {
            tank_code: tankCode,
            product_code: productCode,
            tank_orig_capacity: capacity,
            tank_opening_stock: openingStock,
            dead_stock: deadStock
        };
        
        // Disable button
        $('#updateTankBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Updating...');
        
        $.ajax({
            url: `/masters/pump-tank/api/tanks/${tankId}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#editTankModal').modal('hide');
                    showSuccess('Tank updated successfully');
                    loadTanks();
                } else {
                    showModalError('editTank', response.error || 'Failed to update tank'); // CHANGED
                }
            },
            error: function(xhr) {
                showModalError('editTank', xhr.responseJSON?.error || 'Error updating tank'); // CHANGED
            },
            complete: function() {
                $('#updateTankBtn').prop('disabled', false).html('<i class="bi bi-save me-1"></i>Update Tank');
            }
        });
    });
    
    // Deactivate Tank Button (Event delegation)
    $(document).on('click', '.deactivate-tank-btn', function() {
        const tankId = $(this).data('id');
        
        if (!confirm('Are you sure you want to deactivate this tank? This action cannot be undone.')) {
            return;
        }
        
        $.ajax({
            url: `/masters/pump-tank/api/tanks/${tankId}/deactivate`,
            method: 'PUT',
            success: function(response) {
                if (response.success) {
                    showSuccess('Tank deactivated successfully');
                    loadTanks();
                } else {
                    showError(response.error || 'Failed to deactivate tank');
                }
            },
            error: function(xhr) {
                showError(xhr.responseJSON?.error || 'Error deactivating tank');
            }
        });
    });
    
    // Tank code input - auto uppercase and validate
    $('#addTankCode, #editTankCode').on('input', function() {
        let val = $(this).val().toUpperCase();
        // Remove any characters that aren't alphanumeric or hyphen
        val = val.replace(/[^A-Z0-9-]/g, '');
        $(this).val(val);
    });
    
    // ==================== PUMPS FUNCTIONS ====================
    
    function loadPumps() {
        showLoading('#pumpsTable tbody', 7);
        showLoading('#pumpsCardContainer', 1);
        
        $.ajax({
            url: '/masters/pump-tank/api/pumps',
            method: 'GET',
            data: { location_code: currentLocation },
            success: function(response) {
                if (response.success) {
                    renderPumpsTable(response.pumps);
                    renderPumpsCards(response.pumps);
                } else {
                    showError('Failed to load pumps');
                }
            },
            error: function(xhr) {
                showError('Error loading pumps: ' + (xhr.responseJSON?.error || xhr.statusText));
                $('#pumpsTable tbody').html('<tr><td colspan="7" class="text-center text-danger">Error loading pumps</td></tr>');
                $('#pumpsCardContainer').html('<div class="col-12 text-center text-danger">Error loading pumps</div>');
            }
        });
    }
    
    function renderPumpsTable(pumps) {
        let html = '';
        
        if (pumps.length === 0) {
            html = '<tr><td colspan="7" class="text-center">No pumps found for this location</td></tr>';
        } else {
            pumps.forEach(pump => {
                const isActive = new Date(pump.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                html += `
                    <tr>
                        <td>${pump.pump_code}</td>
                        <td>${pump.pump_make || '-'}</td>
                        <td>
                            ${pump.product_code}
                            ${pump.rgb_color ? `<span class="ml-2" style="display:inline-block;width:15px;height:15px;background-color:${pump.rgb_color};border-radius:3px;"></span>` : ''}
                        </td>
                        <td>${Number(pump.opening_reading || 0).toFixed(3)}</td>
                        <td>${pump.display_order || '-'}</td>
                        <td>${statusBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary edit-pump-btn" data-id="${pump.pump_id}">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            ${isActive ? `
                            <button class="btn btn-sm btn-outline-danger deactivate-pump-btn" data-id="${pump.pump_id}">
                                <i class="bi bi-trash"></i> Deactivate
                            </button>
                            ` : ''}
                        </td>
                    </tr>
                `;
            });
        }
        
        $('#pumpsTable tbody').html(html);
    }
    
    function renderPumpsCards(pumps) {
        let html = '';
        
        if (pumps.length === 0) {
            html = '<div class="col-12 text-center">No pumps found for this location</div>';
        } else {
            pumps.forEach(pump => {
                const isActive = new Date(pump.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                html += `
                    <div class="col-12 col-md-6 mb-3">
                        <div class="card master-card shadow-sm">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <strong>${pump.pump_code}</strong>
                                ${statusBadge}
                            </div>
                            <div class="card-body">
                                <div class="row g-2">
                                    <div class="col-6">
                                        <small class="text-muted">Make</small>
                                        <div class="fw-bold">${pump.pump_make || '-'}</div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Product</small>
                                        <div class="fw-bold">
                                            ${pump.product_code}
                                            ${pump.rgb_color ? `<span class="ml-2" style="display:inline-block;width:15px;height:15px;background-color:${pump.rgb_color};border-radius:3px;"></span>` : ''}
                                        </div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Opening Reading</small>
                                        <div class="fw-bold">${Number(pump.opening_reading || 0).toFixed(3)}</div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Display Order</small>
                                        <div class="fw-bold">${pump.display_order || '-'}</div>
                                    </div>
                                </div>
                                ${isActive ? `
                                <div class="row mt-3">
                                    <div class="col-6">
                                        <button class="btn btn-outline-primary btn-sm w-100 edit-pump-btn" data-id="${pump.pump_id}">
                                            <i class="bi bi-pencil"></i> Edit
                                        </button>
                                    </div>
                                    <div class="col-6">
                                        <button class="btn btn-outline-danger btn-sm w-100 deactivate-pump-btn" data-id="${pump.pump_id}">
                                            <i class="bi bi-trash"></i> Delete
                                        </button>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        $('#pumpsCardContainer').html(html);
    }
    
    
    
   // ==================== RELATIONS FUNCTIONS ====================

    let showHistoricalRelations = false; // Toggle state

    function loadRelations() {
        showLoading('#relationsTable tbody', 7);
        showLoading('#relationsCardContainer', 1);
        
        $.ajax({
            url: '/masters/pump-tank/api/relations',
            method: 'GET',
            data: { location_code: currentLocation },
            success: function(response) {
                if (response.success) {
                    renderRelationsTable(response.relations);
                    renderRelationsCards(response.relations);
                } else {
                    showError('Failed to load relations');
                }
            },
            error: function(xhr) {
                showError('Error loading relations: ' + (xhr.responseJSON?.error || xhr.statusText));
                $('#relationsTable tbody').html('<tr><td colspan="7" class="text-center text-danger">Error loading relations</td></tr>');
                $('#relationsCardContainer').html('<div class="col-12 text-center text-danger">Error loading relations</div>');
            }
        });
    }

    function filterRelationsByToggle(relations) {
        if (showHistoricalRelations) {
            return relations; // Show all
        } else {
            // Show only active relations
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return relations.filter(rel => new Date(rel.effective_end_date) >= today);
        }
    }

    function renderRelationsTable(allRelations) {
        const relations = filterRelationsByToggle(allRelations);
        let html = '';
        
        if (relations.length === 0) {
            const message = showHistoricalRelations 
                ? 'No pump-tank relations found for this location'
                : 'No active pump-tank relations found. Toggle to view historical relations.';
            html = `<tr><td colspan="7" class="text-center">${message}</td></tr>`;
        } else {
            relations.forEach(rel => {
                const isActive = new Date(rel.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                const effectiveFrom = new Date(rel.effective_start_date).toLocaleDateString('en-IN');
                
                html += `
                    <tr>
                        <td>${rel.pump_code}</td>
                        <td>${rel.pump_product}</td>
                        <td>${rel.tank_code}</td>
                        <td>${rel.tank_product}</td>
                        <td>${effectiveFrom}</td>
                        <td>${statusBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary edit-relation-btn" data-id="${rel.pump_tank_id}">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            ${isActive ? `
                            <button class="btn btn-sm btn-outline-danger deactivate-relation-btn" data-id="${rel.pump_tank_id}">
                                <i class="bi bi-trash"></i> Remove
                            </button>
                            ` : '<span class="text-muted">Historical</span>'}
                        </td>
                    </tr>
                `;
            });
        }
        
        $('#relationsTable tbody').html(html);
    }

    function renderRelationsCards(allRelations) {
        const relations = filterRelationsByToggle(allRelations);
        let html = '';
        
        if (relations.length === 0) {
            const message = showHistoricalRelations 
                ? 'No pump-tank relations found for this location'
                : 'No active pump-tank relations found. Toggle to view historical relations.';
            html = `<div class="col-12 text-center">${message}</div>`;
        } else {
            relations.forEach(rel => {
                const isActive = new Date(rel.effective_end_date) >= new Date();
                const statusBadge = isActive 
                    ? '<span class="badge badge-success">Active</span>' 
                    : '<span class="badge badge-secondary">Inactive</span>';
                
                const effectiveFrom = new Date(rel.effective_start_date).toLocaleDateString('en-IN');
                
                html += `
                    <div class="col-12 col-md-6 mb-3">
                        <div class="card master-card shadow-sm">
                            <div class="card-header d-flex justify-content-between align-items-center">
                                <strong>${rel.pump_code} → ${rel.tank_code}</strong>
                                ${statusBadge}
                            </div>
                            <div class="card-body">
                                <div class="row g-2">
                                    <div class="col-6">
                                        <small class="text-muted">Pump Product</small>
                                        <div class="fw-bold">${rel.pump_product}</div>
                                    </div>
                                    <div class="col-6">
                                        <small class="text-muted">Tank Product</small>
                                        <div class="fw-bold">${rel.tank_product}</div>
                                    </div>
                                    <div class="col-12">
                                        <small class="text-muted">Effective From</small>
                                        <div class="fw-bold">${effectiveFrom}</div>
                                    </div>
                                </div>
                                ${isActive ? `
                                <div class="row mt-3">
                                    <div class="col-6">
                                        <button class="btn btn-outline-primary btn-sm w-100 edit-relation-btn" data-id="${rel.pump_tank_id}">
                                            <i class="bi bi-pencil"></i> Edit
                                        </button>
                                    </div>
                                    <div class="col-6">
                                        <button class="btn btn-outline-danger btn-sm w-100 deactivate-relation-btn" data-id="${rel.pump_tank_id}">
                                            <i class="bi bi-trash"></i> Remove
                                        </button>
                                    </div>
                                </div>
                                ` : '<div class="text-center mt-2"><span class="text-muted">Historical Record</span></div>'}
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        $('#relationsCardContainer').html(html);
    }

    // ==================== RELATIONSHIP CRUD OPERATIONS ====================

    // Load available pumps for linking
    function loadAvailablePumps(effectiveDate) {
        $.ajax({
            url: '/masters/pump-tank/api/available-pumps',
            method: 'GET',
            data: { 
                location_code: currentLocation,
                effective_date: effectiveDate
            },
            success: function(response) {
                if (response.success) {
                    let options = '<option value="">-- Select Pump --</option>';
                    response.pumps.forEach(pump => {
                        options += `<option value="${pump.pump_id}" data-product="${pump.product_code}">${pump.pump_code} (${pump.product_code})</option>`;
                    });
                    $('#addRelationPump').html(options);
                }
            },
            error: function(xhr) {
                showModalError('addRelation', 'Error loading available pumps');
            }
        });
    }

    // Load available tanks based on selected pump
    function loadAvailableTanks(pumpId) {
        if (!pumpId) {
            $('#addRelationTank').html('<option value="">-- Select Pump First --</option>').prop('disabled', true);
            $('#relationProductInfo').hide();
            return;
        }
        
        $.ajax({
            url: '/masters/pump-tank/api/available-tanks',
            method: 'GET',
            data: { 
                location_code: currentLocation,
                pump_id: pumpId
            },
            success: function(response) {
                if (response.success) {
                    let options = '<option value="">-- Select Tank --</option>';
                    response.tanks.forEach(tank => {
                        options += `<option value="${tank.tank_id}">${tank.tank_code} (${tank.product_code})</option>`;
                    });
                    $('#addRelationTank').html(options).prop('disabled', false);
                    
                    // Show product info
                    if (response.tanks.length > 0) {
                        const product = response.tanks[0].product_code;
                        const pumpCode = $('#addRelationPump option:selected').text().split(' ')[0];
                        $('#relationProductText').text(`Pump ${pumpCode} will be linked to selected tank (Product: ${product})`);
                        $('#relationProductInfo').show();
                    } else {
                        $('#relationProductInfo').hide();
                        showModalError('addRelation', 'No tanks available with matching product');
                    }
                }
            },
            error: function(xhr) {
                showModalError('addRelation', 'Error loading available tanks');
            }
        });
    }

    // Set max date to today for date inputs
    function setMaxDateToday() {
        const today = new Date().toISOString().split('T')[0];
        $('#addRelationDate, #editRelationStartDate, #deactivateRelationEndDate').attr('max', today);
    }

    // Add Relation Button
    $('#addRelationBtn').click(function() {
        $('#addRelationForm')[0].reset();
        hideModalError('addRelation');
        $('#relationProductInfo').hide();
        
        // Set default date to today
        const today = new Date().toISOString().split('T')[0];
        $('#addRelationDate').val(today);
        
        setMaxDateToday();
        loadAvailablePumps(today);
        
        $('#addRelationModal').modal('show');
    });

    // Date change - reload available pumps
    $('#addRelationDate').change(function() {
        const effectiveDate = $(this).val();
        loadAvailablePumps(effectiveDate);
        $('#addRelationTank').html('<option value="">-- Select Pump First --</option>').prop('disabled', true);
        $('#relationProductInfo').hide();
    });

    // Pump change - load available tanks
    $('#addRelationPump').change(function() {
        const pumpId = $(this).val();
        loadAvailableTanks(pumpId);
    });

    // Save Relation Button
    $('#saveRelationBtn').click(function() {
        hideModalError('addRelation');
        
        const pumpId = $('#addRelationPump').val();
        const tankId = $('#addRelationTank').val();
        const effectiveDate = $('#addRelationDate').val();
        
        // Client-side validation
        if (!pumpId || !tankId || !effectiveDate) {
            showModalError('addRelation', 'Please fill all required fields');
            return;
        }
        
        // Validate date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const effective = new Date(effectiveDate);
        effective.setHours(0, 0, 0, 0);
        if (effective > today) {
            showModalError('addRelation', 'Effective date cannot be in the future');
            return;
        }
        
        const data = {
            pump_id: pumpId,
            tank_id: tankId,
            effective_start_date: effectiveDate,
            location_code: currentLocation
        };
        
        // Disable button
        $('#saveRelationBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Creating...');
        
        $.ajax({
            url: '/masters/pump-tank/api/relations',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#addRelationModal').modal('hide');
                    showSuccess('Pump-tank relationship created successfully');
                    loadRelations();
                } else {
                    showModalError('addRelation', response.error || 'Failed to create relationship');
                }
            },
            error: function(xhr) {
                showModalError('addRelation', xhr.responseJSON?.error || 'Error creating relationship');
            },
            complete: function() {
                $('#saveRelationBtn').prop('disabled', false).html('<i class="bi bi-link me-1"></i>Create Link');
            }
        });
    });

    // Edit Relation Button (Event delegation)
    $(document).on('click', '.edit-relation-btn', function() {
        const relationId = $(this).data('id');
        
        $.ajax({
            url: `/masters/pump-tank/api/relations/${relationId}`,
            method: 'GET',
            success: function(response) {
                if (response.success) {
                    const rel = response.relation;
                    hideModalError('editRelation');
                    setMaxDateToday();
                    
                    $('#editRelationId').val(rel.pump_tank_id);
                    $('#editRelationStartDate').val(rel.effective_start_date);
                    
                    // Set end date if not default
                    if (rel.effective_end_date !== '2099-12-31') {
                        $('#editRelationEndDate').val(rel.effective_end_date);
                    } else {
                        $('#editRelationEndDate').val('');
                    }
                    
                    $('#editRelationInfoText').text(`${rel.pump_code} (${rel.pump_product}) → ${rel.tank_code} (${rel.tank_product})`);
                    
                    $('#editRelationModal').modal('show');
                } else {
                    showError('Failed to load relationship details');
                }
            },
            error: function(xhr) {
                showError('Error loading relationship details');
            }
        });
    });

    // Update Relation Button
    $('#updateRelationBtn').click(function() {
        hideModalError('editRelation');
        
        const relationId = $('#editRelationId').val();
        const startDate = $('#editRelationStartDate').val();
        const endDate = $('#editRelationEndDate').val();
        
        // Client-side validation
        if (!startDate) {
            showModalError('editRelation', 'Start date is required');
            return;
        }
        
        // Validate start date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = new Date(startDate);
        if (start > today) {
            showModalError('editRelation', 'Start date cannot be in the future');
            return;
        }
        
        // Validate end date if provided
        if (endDate) {
            const end = new Date(endDate);
            if (end < start) {
                showModalError('editRelation', 'End date cannot be before start date');
                return;
            }
        }
        
        const data = {
            effective_start_date: startDate,
            effective_end_date: endDate || null
        };
        
        // Disable button
        $('#updateRelationBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Updating...');
        
        $.ajax({
            url: `/masters/pump-tank/api/relations/${relationId}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#editRelationModal').modal('hide');
                    showSuccess('Relationship updated successfully');
                    loadRelations();
                } else {
                    showModalError('editRelation', response.error || 'Failed to update relationship');
                }
            },
            error: function(xhr) {
                showModalError('editRelation', xhr.responseJSON?.error || 'Error updating relationship');
            },
            complete: function() {
                $('#updateRelationBtn').prop('disabled', false).html('<i class="bi bi-save me-1"></i>Update Dates');
            }
        });
    });

    // Deactivate Relation Button (Event delegation)
    $(document).on('click', '.deactivate-relation-btn', function() {
        const relationId = $(this).data('id');
        
        $.ajax({
            url: `/masters/pump-tank/api/relations/${relationId}`,
            method: 'GET',
            success: function(response) {
                if (response.success) {
                    const rel = response.relation;
                    hideModalError('deactivateRelation');
                    setMaxDateToday();
                    
                    $('#deactivateRelationId').val(rel.pump_tank_id);
                    
                    // Set default end date to today
                    const today = new Date().toISOString().split('T')[0];
                    $('#deactivateRelationEndDate').val(today);
                    
                    $('#deactivateRelationInfoText').text(`${rel.pump_code} (${rel.pump_product}) → ${rel.tank_code} (${rel.tank_product})`);
                    
                    $('#deactivateRelationModal').modal('show');
                } else {
                    showError('Failed to load relationship details');
                }
            },
            error: function(xhr) {
                showError('Error loading relationship details');
            }
        });
    });

    // Confirm Deactivate Button
    $('#confirmDeactivateRelationBtn').click(function() {
        hideModalError('deactivateRelation');
        
        const relationId = $('#deactivateRelationId').val();
        const endDate = $('#deactivateRelationEndDate').val();
        
        if (!endDate) {
            showModalError('deactivateRelation', 'End date is required');
            return;
        }
        
        // Validate end date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        if (end > today) {
            showModalError('deactivateRelation', 'End date cannot be in the future');
            return;
        }
        
        const data = {
            effective_end_date: endDate
        };
        
        // Disable button
        $('#confirmDeactivateRelationBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Deactivating...');
        
        $.ajax({
            url: `/masters/pump-tank/api/relations/${relationId}/deactivate`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#deactivateRelationModal').modal('hide');
                    showSuccess('Relationship deactivated successfully');
                    loadRelations();
                } else {
                    showModalError('deactivateRelation', response.error || 'Failed to deactivate relationship');
                }
            },
            error: function(xhr) {
                showModalError('deactivateRelation', xhr.responseJSON?.error || 'Error deactivating relationship');
            },
            complete: function() {
                $('#confirmDeactivateRelationBtn').prop('disabled', false).html('<i class="bi bi-trash me-1"></i>Deactivate');
            }
        });
    });

    // Clear modal errors when opening modals
    $('#addRelationModal').on('show.bs.modal', function() {
        hideModalError('addRelation');
    });

    $('#editRelationModal').on('show.bs.modal', function() {
        hideModalError('editRelation');
    });

    $('#deactivateRelationModal').on('show.bs.modal', function() {
        hideModalError('deactivateRelation');
    });
    
    // ==================== UTILITY FUNCTIONS ====================
    
    function showLoading(selector, colspan) {
        if (selector.includes('tbody')) {
            $(selector).html(`<tr><td colspan="${colspan}" class="text-center"><span class="spinner-border spinner-border-sm mr-2"></span> Loading...</td></tr>`);
        } else {
            $(selector).html(`<div class="col-12 text-center py-4"><span class="spinner-border spinner-border-sm mr-2"></span> Loading...</div>`);
        }
    }
    
    function showError(message) {
        $('#messageText').text(message);
        $('#messageAlert').removeClass('alert-success').addClass('alert-danger').fadeIn();
        
        setTimeout(function() {
            $('#messageAlert').fadeOut();
        }, 5000);
    }
    
    function showSuccess(message) {
        $('#messageText').text(message);
        $('#messageAlert').removeClass('alert-danger').addClass('alert-success').fadeIn();
        
        setTimeout(function() {
            $('#messageAlert').fadeOut();
        }, 3000);
    }


    function showModalError(modalId, message) {
        $(`#${modalId}Error`).show();
        $(`#${modalId}ErrorText`).text(message);
        
        // Auto-hide after 5 seconds
        setTimeout(function() {
            $(`#${modalId}Error`).fadeOut();
        }, 5000);
    }

    function hideModalError(modalId) {
        $(`#${modalId}Error`).hide();
        $(`#${modalId}ErrorText`).text('');
    }

    
    // ==================== PLACEHOLDER BUTTON HANDLERS ====================
    
   // ==================== PUMP CRUD OPERATIONS ====================

    // Populate product dropdowns for pumps
    function populatePumpProductDropdowns() {
        let options = '<option value="">-- Select Product --</option>';
        products.forEach(product => {
            options += `<option value="${product.product_name}">${product.product_name}</option>`;
        });
        
        $('#addPumpProduct').html(options);
        $('#editPumpProduct').html(options);
    }

    // Call this when products are loaded
    // Update the loadProducts success callback to include:
    // populatePumpProductDropdowns();

    // Auto-calculate stamping due date
    function calculateStampingDue(stampingDate, targetFieldId) {
        if (!stampingDate) {
            $(`#${targetFieldId}`).val('');
            return;
        }
        
        const date = new Date(stampingDate);
        date.setFullYear(date.getFullYear() + 1);
        
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        $(`#${targetFieldId}`).val(`${year}-${month}-${day}`);
    }

    // Stamping date change handlers
    $('#addPumpStampingDate').change(function() {
        calculateStampingDue($(this).val(), 'addPumpStampingDue');
    });

    $('#editPumpStampingDate').change(function() {
        calculateStampingDue($(this).val(), 'editPumpStampingDue');
    });

    // Add Pump Button
    $('#addPumpBtn').click(function() {
        $('#addPumpForm')[0].reset();
        populatePumpProductDropdowns();
        $('#addPumpModal').modal('show');
    });

    // Save Pump Button
    $('#savePumpBtn').click(function() {
        // Hide any previous errors
        hideModalError('addPump');
        
        const pumpCode = $('#addPumpCode').val().trim().toUpperCase();
        const pumpMake = $('#addPumpMake').val().trim();
        const productCode = $('#addPumpProduct').val();
        const openingReading = $('#addPumpOpeningReading').val();
        const displayOrder = $('#addPumpDisplayOrder').val();
        const stampingDate = $('#addPumpStampingDate').val();
        
        // Client-side validation
        if (!pumpCode || !productCode || !openingReading || !displayOrder || !stampingDate) {
            showModalError('addPump', 'Please fill all required fields');
            return;
        }
        
        // Validate pump code format
        const pumpCodeRegex = /^[A-Z0-9-]{1,10}$/;
        if (!pumpCodeRegex.test(pumpCode)) {
            showModalError('addPump', 'Pump code can only contain letters, numbers, and hyphens (max 10 characters)');
            return;
        }
        
        // Validate opening reading decimal places
        const decimalPlaces = (openingReading.toString().split('.')[1] || '').length;
        if (decimalPlaces > 3) {
            showModalError('addPump', 'Opening reading can have maximum 3 decimal places');
            return;
        }
        
        // Validate stamping date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const stamping = new Date(stampingDate);
        if (stamping > today) {
            showModalError('addPump', 'Stamping date cannot be in the future');
            return;
        }
        
        const data = {
            pump_code: pumpCode,
            pump_make: pumpMake || null,
            product_code: productCode,
            opening_reading: openingReading,
            display_order: displayOrder,
            current_stamping_date: stampingDate,
            location_code: currentLocation
        };
        
        // Disable button
        $('#savePumpBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Saving...');
        
        $.ajax({
            url: '/masters/pump-tank/api/pumps',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#addPumpModal').modal('hide');
                    showSuccess('Pump created successfully');
                    loadPumps();
                } else {
                    showModalError('addPump', response.error || 'Failed to create pump');
                }
            },
            error: function(xhr) {
                showModalError('addPump', xhr.responseJSON?.error || 'Error creating pump');
            },
            complete: function() {
                $('#savePumpBtn').prop('disabled', false).html('<i class="bi bi-save me-1"></i>Save Pump');
            }
        });
    });

    // Edit Pump Button (Event delegation)
    $(document).on('click', '.edit-pump-btn', function() {
        const pumpId = $(this).data('id');
        
        $.ajax({
            url: `/masters/pump-tank/api/pumps/${pumpId}`,
            method: 'GET',
            success: function(response) {
                if (response.success) {
                    const pump = response.pump;
                    populatePumpProductDropdowns();
                    
                    $('#editPumpId').val(pump.pump_id);
                    $('#editPumpCode').val(pump.pump_code);
                    $('#editPumpMake').val(pump.pump_make || '');
                    $('#editPumpProduct').val(pump.product_code);
                    $('#editPumpOpeningReading').val(pump.opening_reading);
                    $('#editPumpDisplayOrder').val(pump.display_order);
                    $('#editPumpStampingDate').val(pump.current_stamping_date);
                    $('#editPumpStampingDue').val(pump.Stamping_due);
                    
                    $('#editPumpModal').modal('show');
                } else {
                    showError('Failed to load pump details');
                }
            },
            error: function(xhr) {
                showError('Error loading pump details');
            }
        });
    });

    // Update Pump Button
    $('#updatePumpBtn').click(function() {
        // Hide any previous errors
        hideModalError('editPump');
        
        const pumpId = $('#editPumpId').val();
        const pumpCode = $('#editPumpCode').val().trim().toUpperCase();
        const pumpMake = $('#editPumpMake').val().trim();
        const productCode = $('#editPumpProduct').val();
        const openingReading = $('#editPumpOpeningReading').val();
        const displayOrder = $('#editPumpDisplayOrder').val();
        const stampingDate = $('#editPumpStampingDate').val();
        
        // Client-side validation
        if (!pumpCode || !productCode || !openingReading || !displayOrder || !stampingDate) {
            showModalError('editPump', 'Please fill all required fields');
            return;
        }
        
        // Validate pump code format
        const pumpCodeRegex = /^[A-Z0-9-]{1,10}$/;
        if (!pumpCodeRegex.test(pumpCode)) {
            showModalError('editPump', 'Pump code can only contain letters, numbers, and hyphens (max 10 characters)');
            return;
        }
        
        // Validate opening reading decimal places
        const decimalPlaces = (openingReading.toString().split('.')[1] || '').length;
        if (decimalPlaces > 3) {
            showModalError('editPump', 'Opening reading can have maximum 3 decimal places');
            return;
        }
        
        // Validate stamping date is not in future
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const stamping = new Date(stampingDate);
        if (stamping > today) {
            showModalError('editPump', 'Stamping date cannot be in the future');
            return;
        }
        
        const data = {
            pump_code: pumpCode,
            pump_make: pumpMake || null,
            product_code: productCode,
            opening_reading: openingReading,
            display_order: displayOrder,
            current_stamping_date: stampingDate
        };
        
        // Disable button
        $('#updatePumpBtn').prop('disabled', true).html('<span class="spinner-border spinner-border-sm mr-2"></span>Updating...');
        
        $.ajax({
            url: `/masters/pump-tank/api/pumps/${pumpId}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data),
            success: function(response) {
                if (response.success) {
                    $('#editPumpModal').modal('hide');
                    showSuccess('Pump updated successfully');
                    loadPumps();
                } else {
                    showModalError('editPump', response.error || 'Failed to update pump');
                }
            },
            error: function(xhr) {
                showModalError('editPump', xhr.responseJSON?.error || 'Error updating pump');
            },
            complete: function() {
                $('#updatePumpBtn').prop('disabled', false).html('<i class="bi bi-save me-1"></i>Update Pump');
            }
        });
    });

    // Pump code input - auto uppercase and validate
    $('#addPumpCode, #editPumpCode').on('input', function() {
        let val = $(this).val().toUpperCase();
        // Remove any characters that aren't alphanumeric or hyphen
        val = val.replace(/[^A-Z0-9-]/g, '');
        $(this).val(val);
    });

    // Clear modal errors when opening modals
    $('#addPumpModal').on('show.bs.modal', function() {
        hideModalError('addPump');
    });

    $('#editPumpModal').on('show.bs.modal', function() {
        hideModalError('editPump');
    });

    // Deactivate pump placeholder (to be implemented later)
    $(document).on('click', '.deactivate-pump-btn', function() {
        const pumpId = $(this).data('id');
        alert('Deactivate Pump ' + pumpId + ' - to be implemented later');
    });    
    
    
    
    
   
    
    
    

    // Clear modal errors when opening modals - ADD HERE
    $('#addTankModal').on('show.bs.modal', function() {
        hideModalError('addTank');
    });

    $('#editTankModal').on('show.bs.modal', function() {
        hideModalError('editTank');
    });

    // Toggle for historical relations
    $('#showHistoricalToggle').change(function() {
        showHistoricalRelations = $(this).is(':checked');
        loadRelations();
    });
});