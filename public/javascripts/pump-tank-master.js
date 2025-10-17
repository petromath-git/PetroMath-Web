// public/javascripts/pump-tank-master.js

$(document).ready(function() {
    let currentLocation = selectedLocation;
    
    // Load data for the active tab on page load
    loadTanks();
    
    // Location selector change event
    $('#locationSelector').change(function() {
        currentLocation = $(this).val();
        
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
                            <button class="btn btn-sm btn-outline-primary edit-tank-btn" data-id="${tank.tank_id}">
                                <i class="bi bi-pencil"></i> Edit
                            </button>
                            ${isActive ? `
                            <button class="btn btn-sm btn-outline-danger deactivate-tank-btn" data-id="${tank.tank_id}">
                                <i class="bi bi-trash"></i> Deactivate
                            </button>
                            ` : ''}
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
    
    function renderRelationsTable(relations) {
        let html = '';
        
        if (relations.length === 0) {
            html = '<tr><td colspan="7" class="text-center">No pump-tank relations found for this location</td></tr>';
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
                            ` : ''}
                        </td>
                    </tr>
                `;
            });
        }
        
        $('#relationsTable tbody').html(html);
    }
    
    function renderRelationsCards(relations) {
        let html = '';
        
        if (relations.length === 0) {
            html = '<div class="col-12 text-center">No pump-tank relations found for this location</div>';
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
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        $('#relationsCardContainer').html(html);
    }
    
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
    
    // ==================== BUTTON EVENT HANDLERS (Placeholders) ====================
    
    $('#addTankBtn').click(function() {
        alert('Add Tank functionality - to be implemented');
    });
    
    $('#addPumpBtn').click(function() {
        alert('Add Pump functionality - to be implemented');
    });
    
    $('#addRelationBtn').click(function() {
        alert('Add Relation functionality - to be implemented');
    });
    
    // Event delegation for dynamically created buttons
    $(document).on('click', '.edit-tank-btn', function() {
        const tankId = $(this).data('id');
        alert('Edit Tank ' + tankId + ' - to be implemented');
    });
    
    $(document).on('click', '.deactivate-tank-btn', function() {
        const tankId = $(this).data('id');
        if (confirm('Are you sure you want to deactivate this tank?')) {
            alert('Deactivate Tank ' + tankId + ' - to be implemented');
        }
    });
    
    $(document).on('click', '.edit-pump-btn', function() {
        const pumpId = $(this).data('id');
        alert('Edit Pump ' + pumpId + ' - to be implemented');
    });
    
    $(document).on('click', '.deactivate-pump-btn', function() {
        const pumpId = $(this).data('id');
        if (confirm('Are you sure you want to deactivate this pump?')) {
            alert('Deactivate Pump ' + pumpId + ' - to be implemented');
        }
    });
    
    $(document).on('click', '.edit-relation-btn', function() {
        const relationId = $(this).data('id');
        alert('Edit Relation ' + relationId + ' - to be implemented');
    });
    
    $(document).on('click', '.deactivate-relation-btn', function() {
        const relationId = $(this).data('id');
        if (confirm('Are you sure you want to remove this pump-tank relation?')) {
            alert('Remove Relation ' + relationId + ' - to be implemented');
        }
    });
});