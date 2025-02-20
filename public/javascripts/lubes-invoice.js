document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('lubesInvoiceForm');
    const itemsTable = document.getElementById('invoice-items-table').getElementsByTagName('tbody')[0];
    const addRowBtn = document.getElementById('add-row-btn');
    const saveBtn = document.getElementById('save-btn');
    const closeBtn = document.getElementById('close-btn');
    const invoiceNumberInput = document.getElementById('invoice_number');
    const supplierSelect = document.getElementById('supplier_id');
    const invoiceDateInput = document.getElementById('invoice_date');

    // Get product options HTML (used when adding new rows)
    function getProductOptions() {
        return products.map(product => 
            `<option value="${product.product_id}" data-unit="${product.unit}">
                ${product.product_name}
            </option>`
        ).join('');
    }

    // Setup row events for a specific row
    function setupRowEvents(row) {
        const productSelect = row.querySelector('.product-select');
        const unitCell = row.querySelector('.product-unit');
        const mrpInput = row.querySelector('.mrp');
        const netRateInput = row.querySelector('.net-rate');
        const quantityInput = row.querySelector('.quantity');
        const amountInput = row.querySelector('.amount');
        const removeBtn = row.querySelector('.remove-row');
        
        // Update product details when product is selected
        function updateProductDetails() {
            const selectedOption = productSelect.options[productSelect.selectedIndex];
            
            if (selectedOption.value) {
                const unit = selectedOption.getAttribute('data-unit') || '';
                unitCell.textContent = unit;
            } else {
                unitCell.textContent = '';
            }
        }
        
        // Calculate amount based on net rate and quantity
        function calculateAmount() {
            const netRate = parseFloat(netRateInput.value) || 0;
            const quantity = parseFloat(quantityInput.value) || 0;
            
            const calculatedAmount = netRate * quantity;
            amountInput.value = calculatedAmount.toFixed(2);
            
            calculateTotal();
        }
        
        // Product select change event
        if (productSelect) {
            productSelect.addEventListener('change', updateProductDetails);
            
            // Trigger update if a product is pre-selected
            if (productSelect.value) {
                updateProductDetails();
            }
        }
        
        // Net Rate input event
        if (netRateInput) {
            netRateInput.addEventListener('input', calculateAmount);
        }
        
        // Quantity input event
        if (quantityInput) {
            quantityInput.addEventListener('input', calculateAmount);
        }
        
        // Remove row button
        if (removeBtn) {
            removeBtn.addEventListener('click', function() {
                if (itemsTable.rows.length > 1) {
                    row.remove();
                    renumberRows();
                    calculateTotal();
                }
            });
        }
    }

    // Add new row functionality
    if (addRowBtn) {
        addRowBtn.addEventListener('click', function() {
            const newRow = document.createElement('tr');
            const rowCount = itemsTable.rows.length;
            
            newRow.innerHTML = `
                <td>${rowCount + 1}</td>
                <td>
                    <select class="form-control product-select" name="items[${rowCount}][product_id]" required>
                        <option value="">Select Product</option>
                        ${getProductOptions()}
                    </select>
                </td>
                <td class="product-unit"></td>
                <td>
                    <input class="form-control mrp" type="number" name="items[${rowCount}][mrp]" step="0.01" min="0" required>
                </td>
                <td>
                    <input class="form-control net-rate" type="number" name="items[${rowCount}][net_rate]" step="0.01" min="0" required>
                </td>
                <td>
                    <input class="form-control quantity" type="number" name="items[${rowCount}][qty]" step="0.01" min="0.01" required>
                </td>
                <td>
                    <input class="form-control amount" type="number" name="items[${rowCount}][amount]" readonly>
                </td>
                <td>
                    <input class="form-control notes" type="text" name="items[${rowCount}][notes]">
                </td>
                <td>
                    <button type="button" class="btn btn-danger remove-row">Remove</button>
                </td>
            `;
            
            itemsTable.appendChild(newRow);
            setupRowEvents(newRow);
        });
    }

    // Renumber rows after deletion
    function renumberRows() {
        const rows = itemsTable.querySelectorAll('tr');
        rows.forEach((row, index) => {
            row.cells[0].textContent = index + 1;
            
            // Update input names
            const inputs = row.querySelectorAll('[name^="items["]');
            inputs.forEach(input => {
                const name = input.getAttribute('name');
                const newName = name.replace(/items\[\d+\]/, `items[${index}]`);
                input.setAttribute('name', newName);
            });
        });
    }

    // Calculate total invoice amount
    function calculateTotal() {
        const total = [...itemsTable.querySelectorAll('.amount')]
            .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
        
        document.getElementById('invoice_amount').value = total.toFixed(2);
        
        // Enable/disable close button based on total
        if (closeBtn) {
            closeBtn.disabled = total <= 0;
        }
    }

    // Validate form before submission
    function validateForm() {
        // Validate invoice number
        if (!invoiceNumberInput.value.trim()) {
            alert('Please enter an invoice number');
            invoiceNumberInput.focus();
            return false;
        }

        // Validate supplier
        if (!supplierSelect.value) {
            alert('Please select a supplier');
            supplierSelect.focus();
            return false;
        }

        // Validate invoice date
        if (!invoiceDateInput.value) {
            alert('Please select an invoice date');
            invoiceDateInput.focus();
            return false;
        }

        // Validate items
        const rows = itemsTable.querySelectorAll('tr');
        if (rows.length === 0) {
            alert('Please add at least one invoice item');
            return false;
        }

        // Validate each row
        let isValid = true;
        rows.forEach((row, index) => {
            const productSelect = row.querySelector('.product-select');
            const mrpInput = row.querySelector('.mrp');
            const netRateInput = row.querySelector('.net-rate');
            const quantityInput = row.querySelector('.quantity');

            if (!productSelect.value) {
                alert(`Please select a product for row ${index + 1}`);
                isValid = false;
                return;
            }

            if (!mrpInput.value || parseFloat(mrpInput.value) < 0) {
                alert(`Please enter a valid MRP for row ${index + 1}`);
                isValid = false;
                return;
            }

            if (!netRateInput.value || parseFloat(netRateInput.value) < 0) {
                alert(`Please enter a valid net rate for row ${index + 1}`);
                isValid = false;
                return;
            }

            if (!quantityInput.value || parseFloat(quantityInput.value) <= 0) {
                alert(`Please enter a valid quantity for row ${index + 1}`);
                isValid = false;
                return;
            }
        });

        return isValid;
    }

    // Save invoice
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            if (!validateForm()) return;
            
            const formData = new FormData(form);
            const items = [];
            
            // Collect items from form
            const rows = itemsTable.querySelectorAll('tr');
            rows.forEach((row, index) => {
                const productSelect = row.querySelector('.product-select');
                const mrpInput = row.querySelector('.mrp');
                const netRateInput = row.querySelector('.net-rate');
                const quantityInput = row.querySelector('.quantity');
                const amountInput = row.querySelector('.amount');
                const notesInput = row.querySelector('.notes');
                
                if (productSelect && productSelect.value) {
                    items.push({
                        product_id: productSelect.value,
                        mrp: mrpInput.value,
                        net_rate: netRateInput.value,
                        qty: quantityInput.value,
                        amount: amountInput.value,
                        notes: notesInput ? notesInput.value : ''
                    });
                }
            });
            
            // Convert FormData to object
            const data = {};
            for (const [key, value] of formData.entries()) {
                data[key] = value;
            }

            // Ensure location_id is the numeric ID
            data.location_id = document.querySelector('input[name="location_id"]').value;
            data.location_code = userLocationCode;
            data.items = items;
            
            // Send data to server
            fetch('/lubes-invoice/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    alert(result.message || 'Invoice saved successfully');
                    window.location.href = `/lubes-invoice?id=${result.lubes_hdr_id}`;
                } else {
                    alert(result.message || 'Failed to save invoice');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred while saving the invoice');
            });
        });
    }

    // Close invoice
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            const invoiceId = document.getElementById('lubes_hdr_id')?.value;
            
            if (!invoiceId) {
                alert('No invoice selected to close');
                return;
            }

            fetch(`/lubes-invoice/close?id=${invoiceId}`, {
                method: 'GET'
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    alert(result.message || 'Invoice closed successfully');
                    window.location.href = '/lubes-invoice-home';
                } else {
                    alert(result.message || 'Failed to close invoice');
                }
            })
            .catch(error => {
                console.error('Error:', error);
                alert('An error occurred while closing the invoice');
            });
        });
    }

    // Initial setup for all rows
    function setupAllRows() {
        const rows = itemsTable.querySelectorAll('tr');
        rows.forEach(row => setupRowEvents(row));
        calculateTotal();
    }

    // Initialize when DOM is loaded
    setupAllRows();
});