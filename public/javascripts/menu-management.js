// public/javascripts/menu-management.js

$(document).ready(function() {
    console.log('Menu Management JavaScript initialized');
    console.log('User Location:', typeof userLocationCode !== 'undefined' ? userLocationCode : 'undefined');
    console.log('User Name:', typeof userName !== 'undefined' ? userName : 'undefined');
    
    // Global variables
    let currentEditingItem = null;
    let currentEditingGroup = null;
    let menuGroups = [];
    let menuItems = [];

    // Initialize the page
    init();

    function init() {
        console.log('init() function called');
        
        // Load initial data
        loadMenuItems();
        loadMenuGroups();
        loadMenuAccess();
        loadCacheStats();
        
        // Set up event listeners
        setupEventListeners();
        
        // Set up tab change events
        setupTabEvents();
    }

    function setupEventListeners() {
        // Menu Items - Fixed IDs to match template
        $('#add-menu-item-btn').click(() => openMenuItemModal());
        $('#save-menu-item-btn').click(saveMenuItem);
        
        // Menu Groups - Fixed IDs to match template
        $('#add-menu-group-btn').click(() => openMenuGroupModal());
        $('#save-menu-group-btn').click(saveMenuGroup);
        
        // Cache Management - Fixed IDs to match template
        $('#refresh-cache-btn, #refresh-cache-btn-tab').click(refreshCache);
        
        // Form submissions - Fixed IDs to match template
        $('#menu-item-form').submit((e) => {
            e.preventDefault();
            saveMenuItem();
        });
        
        $('#menu-group-form').submit((e) => {
            e.preventDefault();
            saveMenuGroup();
        });
    }

    function setupTabEvents() {
        // Load data when tabs are activated - Fixed target IDs
        $('a[data-toggle="tab"], button[data-toggle="tab"]').on('shown.bs.tab', function (e) {
            const target = $(e.target).attr('data-bs-target') || $(e.target).attr('href');
            
            switch(target) {
                case '#menu-items-pane':
                    if (menuItems.length === 0) loadMenuItems();
                    break;
                case '#menu-groups-pane':
                    if (menuGroups.length === 0) loadMenuGroups();
                    break;
                case '#menu-access-pane':
                    loadMenuAccess();
                    break;
                case '#cache-pane':
                    loadCacheStats();
                    break;
            }
        });
    }

    // =============================================
    // MENU ITEMS FUNCTIONS
    // =============================================

    function loadMenuItems() {
        console.log('loadMenuItems() function called');
        
        $.get('/menu-management/api/menu-items')
            .done(function(response) {
                console.log('Menu Items API Success:', response);
                if (response.success) {
                    console.log('Menu items data:', response.data);
                    console.log('Number of menu items:', response.data.length);
                    menuItems = response.data;
                    renderMenuItemsTable(response.data);
                } else {
                    console.log('API returned error:', response.error);
                    showError('Failed to load menu items: ' + response.error);
                }
            })
            .fail(function(xhr) {
                console.log('Menu Items API Failed:', xhr.status, xhr.responseText);
                showError('Failed to load menu items: ' + xhr.responseText);
            });
    }

    function renderMenuItemsTable(items) {
        const tbody = $('#menu-items-table tbody');
        tbody.empty();

        if (items.length === 0) {
            tbody.html('<tr><td colspan="6" class="text-center text-muted">No menu items found</td></tr>');
            return;
        }

        items.forEach(item => {
            const row = `
                <tr>
                    <td><code>${item.menu_code}</code></td>
                    <td>${item.menu_name}</td>
                    <td><small class="text-muted">${item.url_path || '-'}</small></td>
                    <td><span class="badge bg-secondary">${item.group_code || 'None'}</span></td>
                    <td>${item.sequence}</td>
                    <td class="text-center">
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-primary btn-sm" onclick="editMenuItem(${item.menu_id})"
                                    title="Edit">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteMenuItem(${item.menu_id}, '${item.menu_name.replace(/'/g, "\\'")}')"
                                    title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.append(row);
        });
    }

    function openMenuItemModal(item = null) {
        currentEditingItem = item;
        
        // Reset form - Fixed ID to match template
        const form = document.getElementById('menu-item-form');
        if (form) {
            form.reset();
        }
        
        // Populate dropdowns
        populateGroupDropdown();
        populateParentMenuDropdown();
        
        if (item) {
            // Edit mode - Fixed IDs to match template
            $('#menu-item-modal-title').text('Edit Menu Item');
            $('#menu-code').val(item.menu_code);
            $('#menu-name').val(item.menu_name);
            $('#url-path').val(item.url_path || '');
            $('#group-code').val(item.group_code || '');
            $('#parent-code').val(item.parent_code || '');
            $('#sequence').val(item.sequence);
        } else {
            // Add mode
            $('#menu-item-modal-title').text('Add Menu Item');
        }
        
        // Show modal - Fixed ID to match template
        $('#menu-item-modal').modal('show');
    }

    function populateGroupDropdown() {
        const select = $('#group-code');
        select.find('option:not(:first)').remove();
        
        menuGroups.forEach(group => {
            select.append(`<option value="${group.group_code}">${group.group_name}</option>`);
        });
    }

    function populateParentMenuDropdown() {
        const select = $('#parent-code');
        select.find('option:not(:first)').remove();
        
        menuItems.forEach(item => {
            select.append(`<option value="${item.menu_code}">${item.menu_name}</option>`);
        });
    }

    function saveMenuItem() {

         // Check if form is valid
        const form = document.getElementById('menu-item-form');
        if (!form.checkValidity()) {
            form.reportValidity(); // This will show browser validation messages
            return;
        }

         // Get form values
        const groupCode = $('#group-code').val();
        const sequence = parseInt($('#sequence').val());
        const menuCode = $('#menu-code').val();
        
        // Check for duplicate sequence within the same group
        const duplicateSequence = menuItems.find(item => 
            item.group_code === groupCode && 
            parseInt(item.sequence) === sequence &&
            item.menu_code !== menuCode // Exclude current item when editing
        );
        
        if (duplicateSequence) {
            showError(`Sequence ${sequence} is already used by "${duplicateSequence.menu_name}" in this group. Please use a different sequence number.`);
            $('#sequence').focus();
            return;
        }

        // Fixed IDs to match template
        const formData = {
            menu_code: $('#menu-code').val(),
            menu_name: $('#menu-name').val(),
            url_path: $('#url-path').val() || null,
            group_code: $('#group-code').val() || null,
            parent_code: $('#parent-code').val() || null,
            sequence: parseInt($('#sequence').val()) || 1
        };

        const url = currentEditingItem 
            ? `/menu-management/api/menu-items/${currentEditingItem.menu_id}`
            : '/menu-management/api/menu-items';
            
        const method = currentEditingItem ? 'PUT' : 'POST';

        $.ajax({
            url: url,
            method: method,
            data: JSON.stringify(formData),
            contentType: 'application/json',
            success: function(response) {
                if (response.success) {
                    $('#menu-item-modal').modal('hide');
                    showSuccess(response.message);
                    loadMenuItems(); // Reload the table
                } else {
                    showError(response.error);
                }
            },
            error: function(xhr) {
                showError('Failed to save menu item: ' + xhr.responseText);
            }
        });
    }

    // Global functions for table actions
    window.editMenuItem = function(menuId) {
        const item = menuItems.find(i => i.menu_id === menuId);
        if (item) {
            openMenuItemModal(item);
        }
    };

    window.deleteMenuItem = function(menuId, menuName) {
        if (confirm(`Are you sure you want to delete the menu item "${menuName}"?`)) {
            $.ajax({
                url: `/menu-management/api/menu-items/${menuId}`,
                method: 'DELETE',
                success: function(response) {
                    if (response.success) {
                        showSuccess(response.message);
                        loadMenuItems();
                    } else {
                        showError(response.error);
                    }
                },
                error: function(xhr) {
                    showError('Failed to delete menu item: ' + xhr.responseText);
                }
            });
        }
    };

    // =============================================
    // MENU GROUPS FUNCTIONS
    // =============================================

    function loadMenuGroups() {
        $.get('/menu-management/api/menu-groups')
            .done(function(response) {
                if (response.success) {
                    menuGroups = response.data;
                    renderMenuGroupsTable(response.data);
                } else {
                    showError('Failed to load menu groups: ' + response.error);
                }
            })
            .fail(function(xhr) {
                showError('Failed to load menu groups: ' + xhr.responseText);
            });
    }

    function renderMenuGroupsTable(groups) {
        const tbody = $('#menu-groups-table tbody');
        tbody.empty();

        if (groups.length === 0) {
            tbody.html('<tr><td colspan="5" class="text-center text-muted">No menu groups found</td></tr>');
            return;
        }

        groups.forEach(group => {
            const row = `
                <tr>
                    <td><code>${group.group_code}</code></td>
                    <td>${group.group_name}</td>
                    <td>${group.group_sequence}</td>
                    <td>${group.group_icon ? `<i class="bi ${group.group_icon}"></i> ${group.group_icon}` : '-'}</td>
                    <td class="text-center">
                        <div class="btn-group btn-group-sm" role="group">
                            <button class="btn btn-outline-primary btn-sm" onclick="editMenuGroup(${group.group_id})"
                                    title="Edit">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteMenuGroup(${group.group_id}, '${group.group_name.replace(/'/g, "\\'")}')"
                                    title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            tbody.append(row);
        });
    }

    function openMenuGroupModal(group = null) {
        currentEditingGroup = group;
        
        // Reset form - Fixed ID to match template
        const form = document.getElementById('menu-group-form');
        if (form) {
            form.reset();
        }
        
        if (group) {
            // Edit mode - Fixed IDs to match template
            $('#menu-group-modal-title').text('Edit Menu Group');
            $('#group-code-input').val(group.group_code);
            $('#group-name-input').val(group.group_name);
            $('#group-sequence-input').val(group.group_sequence);
            $('#group-icon-input').val(group.group_icon || '');
        } else {
            // Add mode
            $('#menu-group-modal-title').text('Add Menu Group');
        }
        
        // Show modal - Fixed ID to match template
        $('#menu-group-modal').modal('show');
    }

    function saveMenuGroup() {
        // Fixed IDs to match template
        const formData = {
            group_code: $('#group-code-input').val(),
            group_name: $('#group-name-input').val(),
            group_sequence: parseInt($('#group-sequence-input').val()) || 1,
            group_icon: $('#group-icon-input').val() || null
        };

        const url = currentEditingGroup 
            ? `/menu-management/api/menu-groups/${currentEditingGroup.group_id}`
            : '/menu-management/api/menu-groups';
            
        const method = currentEditingGroup ? 'PUT' : 'POST';

        $.ajax({
            url: url,
            method: method,
            data: JSON.stringify(formData),
            contentType: 'application/json',
            success: function(response) {
                if (response.success) {
                    $('#menu-group-modal').modal('hide');
                    showSuccess(response.message);
                    loadMenuGroups();
                } else {
                    showError(response.error);
                }
            },
            error: function(xhr) {
                showError('Failed to save menu group: ' + xhr.responseText);
            }
        });
    }

    // Global functions for group table actions
    window.editMenuGroup = function(groupId) {
        const group = menuGroups.find(g => g.group_id === groupId);
        if (group) {
            openMenuGroupModal(group);
        }
    };

    window.deleteMenuGroup = function(groupId, groupName) {
        if (confirm(`Are you sure you want to delete the menu group "${groupName}"?`)) {
            $.ajax({
                url: `/menu-management/api/menu-groups/${groupId}`,
                method: 'DELETE',
                success: function(response) {
                    if (response.success) {
                        showSuccess(response.message);
                        loadMenuGroups();
                    } else {
                        showError(response.error);
                    }
                },
                error: function(xhr) {
                    showError('Failed to delete menu group: ' + xhr.responseText);
                }
            });
        }
    };

    // =============================================
    // MENU ACCESS FUNCTIONS
    // =============================================

    function loadMenuAccess() {
        // Fixed container ID - create the container if it doesn't exist in template
        let container = $('#menu-access-table tbody');
        if (container.length === 0) {
            container = $('#menu-access-pane .table-responsive');
        }
        
        container.html(`
            <div class="text-center p-4">
                <div class="spinner-border me-2" role="status"></div>
                Loading access matrix...
            </div>
        `);

        $.get('/menu-management/api/menu-access')
            .done(function(response) {
                if (response.success) {
                    renderAccessMatrix(response.roles, response.access);
                } else {
                    showError('Failed to load menu access: ' + response.error);
                }
            })
            .fail(function(xhr) {
                showError('Failed to load menu access: ' + xhr.responseText);
            });
    }

    function renderAccessMatrix(roles, accessData) {
        // Group access data by role and menu
        const accessMap = {};
        accessData.forEach(item => {
            const key = `${item.role}-${item.menu_code}`;
            accessMap[key] = item;
        });

        // Get unique menu items
        const menus = [...new Set(accessData.map(item => ({ code: item.menu_code, name: item.menu_name })))];

        let html = `
            <table class="table table-sm table-bordered">
                <thead class="table-dark">
                    <tr>
                        <th class="sticky-left">Menu Item</th>
        `;

        roles.forEach(role => {
            html += `<th class="text-center" style="min-width: 80px;">${role.role_name}</th>`;
        });

        html += `</tr></thead><tbody>`;

        menus.forEach(menu => {
            html += `<tr><td class="sticky-left"><small>${menu.name}</small></td>`;
            
            roles.forEach(role => {
                const key = `${role.role_name}-${menu.code}`;
                const access = accessMap[key];
                const isAllowed = access && access.allowed;
                
                html += `
                    <td class="text-center">
                        <div class="form-check form-switch d-flex justify-content-center">
                            <input class="form-check-input access-toggle" type="checkbox" 
                                   ${isAllowed ? 'checked' : ''} 
                                   data-role="${role.role_name}" 
                                   data-menu="${menu.code}">
                        </div>
                    </td>
                `;
            });
            
            html += '</tr>';
        });

        html += '</tbody></table>';

        // Replace the container content
        $('#menu-access-pane .table-responsive').html(html);

        // Set up toggle event handlers
        $('.access-toggle').change(function() {
            const $this = $(this);
            const role = $this.data('role');
            const menuCode = $this.data('menu');
            const allowed = $this.is(':checked');

            updateMenuAccess(role, menuCode, allowed);
        });
    }

    function updateMenuAccess(role, menuCode, allowed) {
        const data = {
            role: role,
            menu_code: menuCode,
            allowed: allowed,
            isOverride: false // For now, we'll use global permissions
        };

        $.ajax({
            url: '/menu-management/api/menu-access',
            method: 'PUT',
            data: JSON.stringify(data),
            contentType: 'application/json',
            success: function(response) {
                if (response.success) {
                    showSuccess(`Access updated for ${role} - ${menuCode}`, 2000);
                } else {
                    showError(response.error);
                    // Revert the checkbox state
                    $(`.access-toggle[data-role="${role}"][data-menu="${menuCode}"]`).prop('checked', !allowed);
                }
            },
            error: function(xhr) {
                showError('Failed to update access: ' + xhr.responseText);
                // Revert the checkbox state
                $(`.access-toggle[data-role="${role}"][data-menu="${menuCode}"]`).prop('checked', !allowed);
            }
        });
    }

    // =============================================
    // CACHE MANAGEMENT FUNCTIONS
    // =============================================

    function loadCacheStats() {
        // Fixed ID to match template
        $('#cache-info').html(`
            <p class="text-center">
                <div class="spinner-border spinner-border-sm me-2" role="status"></div>
                Loading cache stats...
            </p>
        `);

        // For now, show basic info. This can be enhanced later with actual cache statistics
        $('#cache-info').html(`
            <div class="row text-center">
                <div class="col-12">
                    <p class="mb-2"><strong>Cache Status:</strong> <span class="badge bg-success">Active</span></p>
                    <p class="mb-2"><strong>Last Refresh:</strong> <span id="last-refresh-time">Not available</span></p>
                    <p class="mb-0"><strong>Records Cached:</strong> <span id="cached-records">Not available</span></p>
                </div>
            </div>
        `);
    }

    function refreshCache() {
        const $button = $(this);
        const originalHtml = $button.html();
        
        // Show loading state
        $button.prop('disabled', true)
               .html('<span class="spinner-border spinner-border-sm me-2" role="status"></span>Refreshing...');

        $.post('/menu-management/api/refresh-cache')
            .done(function(response) {
                if (response.success) {
                    showSuccess('Menu cache refreshed successfully!');
                    
                    // Update cache stats if on that tab
                    loadCacheStats();
                } else {
                    showError('Failed to refresh cache: ' + response.error);
                }
            })
            .fail(function(xhr) {
                showError('Failed to refresh cache: ' + xhr.responseText);
            })
            .always(function() {
                // Restore button state
                $button.prop('disabled', false).html(originalHtml);
            });
    }

    // =============================================
    // UTILITY FUNCTIONS
    // =============================================

    function showSuccess(message, duration = 5000) {
        const toast = $(`
            <div class="toast align-items-center text-white bg-success border-0" role="alert" style="position: fixed; top: 20px; right: 20px; z-index: 9999;">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-check-circle me-2"></i>${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `);
        
        $('body').append(toast);
        const bsToast = new bootstrap.Toast(toast[0], { delay: duration });
        bsToast.show();
        
        toast.on('hidden.bs.toast', function() {
            $(this).remove();
        });
    }

    function showError(message, duration = 8000) {
        const toast = $(`
            <div class="toast align-items-center text-white bg-danger border-0" role="alert" style="position: fixed; top: 20px; right: 20px; z-index: 9999;">
                <div class="d-flex">
                    <div class="toast-body">
                        <i class="bi bi-exclamation-triangle me-2"></i>${message}
                    </div>
                    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                </div>
            </div>
        `);
        
        $('body').append(toast);
        const bsToast = new bootstrap.Toast(toast[0], { delay: duration });
        bsToast.show();
        
        toast.on('hidden.bs.toast', function() {
            $(this).remove();
        });
    }

    // Add responsive CSS for better mobile experience
    $('<style>')
        .prop('type', 'text/css')
        .html(`
            .sticky-left {
                position: sticky;
                left: 0;
                background-color: #f8f9fa;
                z-index: 10;
                min-width: 150px;
            }
            
            @media (max-width: 768px) {
                .table-responsive table {
                    font-size: 0.875rem;
                }
                
                .sticky-left {
                    min-width: 120px;
                    font-size: 0.8rem;
                }
                
                .form-check-input {
                    transform: scale(0.9);
                }
                
                .btn-group-sm > .btn {
                    padding: 0.125rem 0.25rem;
                    font-size: 0.75rem;
                }
            }
            
            @media (max-width: 576px) {
                .nav-tabs .nav-link {
                    padding: 0.5rem 0.25rem;
                    font-size: 0.875rem;
                }
                
                .modal-dialog {
                    margin: 0.5rem;
                }
                
                .toast {
                    min-width: calc(100vw - 40px);
                    left: 20px !important;
                    right: 20px !important;
                }
            }
        `)
        .appendTo('head');
});