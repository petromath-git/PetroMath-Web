$(document).ready(function() {
    console.log('Menu Access Report initialized for location:', userLocation);
    
    // Load report data
    loadReportData();
    
    // Export buttons
    $('#export-excel-btn').click(exportToExcel);
    $('#export-pdf-btn').click(exportToPDF);
    
    function loadReportData() {
        $.get('/menu-management/api/access-report')
            .done(function(response) {
                if (response.success) {
                    renderReport(response.roles, response.data);
                } else {
                    showError('Failed to load report: ' + response.error);
                }
            })
            .fail(function(xhr) {
                showError('Failed to load report: ' + xhr.responseText);
            });
    }
    
    function renderReport(roles, data) {
        // Group data by menu groups
        const groupedData = {};
        data.forEach(item => {
            const groupKey = item.group_code || 'UNGROUPED';
            if (!groupedData[groupKey]) {
                groupedData[groupKey] = {
                    group_name: item.group_name || 'Ungrouped',
                    group_sequence: item.group_sequence || 999,
                    items: []
                };
            }
            groupedData[groupKey].items.push(item);
        });
        
        // Build HTML
        let html = '<div class="table-responsive">';
        html += '<table class="table table-bordered table-sm" id="access-report-table">';
        html += '<thead class="table-dark"><tr>';
        html += '<th class="sticky-col">Menu Item</th>';
        
        // Role headers
        roles.forEach(role => {
            html += `<th class="text-center">${role.role_display_name}</th>`;
        });
        html += '</tr></thead><tbody>';
        
        // Render grouped data
        Object.keys(groupedData).sort((a, b) => {
            return groupedData[a].group_sequence - groupedData[b].group_sequence;
        }).forEach(groupKey => {
            const group = groupedData[groupKey];
            
            // Group header
            html += '<tr class="table-secondary">';
            html += `<td colspan="${roles.length + 1}"><strong>${group.group_name}</strong></td>`;
            html += '</tr>';
            
            // Menu items in group
            group.items.forEach(item => {
                html += '<tr>';
                html += `<td class="sticky-col">${item.menu_name}</td>`;
                
                // Parse role permissions
                const permissions = {};
                if (item.role_permissions) {
                    item.role_permissions.split('|').forEach(perm => {
                        const [role, allowed] = perm.split(':');
                        permissions[role] = parseInt(allowed);
                    });
                }
                
                // Show permissions for each role
                roles.forEach(role => {
                    const hasAccess = permissions[role.role_name] === 1;
                    const icon = hasAccess 
                        ? '<i class="bi bi-check-circle-fill text-success"></i>' 
                        : '<i class="bi bi-x-circle-fill text-danger"></i>';
                    html += `<td class="text-center">${icon}</td>`;
                });
                
                html += '</tr>';
            });
        });
        
        html += '</tbody></table></div>';
        
        $('#report-container').html(html);
    }
    
    function exportToExcel() {
        // Simple CSV export
        const table = document.getElementById('access-report-table');
        let csv = [];
        
        for (let row of table.rows) {
            let csvRow = [];
            for (let cell of row.cells) {
                // Convert icons to text
                let text = cell.innerText;
                if (cell.querySelector('.bi-check-circle-fill')) text = 'Yes';
                if (cell.querySelector('.bi-x-circle-fill')) text = 'No';
                csvRow.push('"' + text + '"');
            }
            csv.push(csvRow.join(','));
        }
        
        // Download
        const csvContent = csv.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `menu-access-report-${userLocation}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }
    
    function exportToPDF() {
        window.print();
    }
    
    function showError(message) {
        $('#report-container').html(`
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-2"></i>${message}
            </div>
        `);
    }
});