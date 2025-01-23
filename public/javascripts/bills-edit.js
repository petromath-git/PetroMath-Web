document.addEventListener('DOMContentLoaded', function() {
    const billForm = document.getElementById('billForm');
    const billItemsTable = document.getElementById('billItemsTable');
    const totalAmountDisplay = document.getElementById('totalAmount');

    // Handle product selection for desktop
    function attachProductSelectListener(row) {
        const productSelect = row.querySelector('.product-select');
        const priceInput = row.querySelector('.price-input');
        const qtyInput = row.querySelector('.qty-input');
        const discountInput = row.querySelector('.discount-input');
        const amountInput = row.querySelector('.amount-input');

        productSelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            const price = selectedOption.getAttribute('data-price') || '0';
            
            priceInput.value = parseFloat(price).toFixed(3);
            
            // Recalculate if any input is present
            recalculateBillItem(row);
        });

        // Add event listeners for dynamic calculation
        qtyInput.addEventListener('input', () => recalculateBillItem(row));
        discountInput.addEventListener('input', () => recalculateBillItem(row));
        
        // Allow manual amount entry
        amountInput.addEventListener('input', () => {
            const price = parseFloat(priceInput.value) || 0;
            const discount = parseFloat(discountInput.value) || 0;
            const amount = parseFloat(amountInput.value) || 0;
            
            // If amount is manually entered, calculate quantity
            if (price > 0) {
                const discountedPrice = price - discount;
                const qty = (amount / discountedPrice).toFixed(3);
                qtyInput.value = qty;
            }
            
            updateTotalAmount();
        });
    }

    // Recalculate bill item based on different inputs
    function recalculateBillItem(row) {
        const priceInput = row.querySelector('.price-input');
        const qtyInput = row.querySelector('.qty-input');
        const discountInput = row.querySelector('.discount-input');
        const amountInput = row.querySelector('.amount-input');

        const originalPrice = parseFloat(priceInput.value) || 0;
        const qty = parseFloat(qtyInput.value) || 0;
        const discount = parseFloat(discountInput.value) || 0;

        // Calculate discounted price
        const discountedPrice = originalPrice - discount;

        // Calculate amount if quantity is entered
        if (qty > 0) {
            const calculatedAmount = qty * discountedPrice;
            amountInput.value = calculatedAmount.toFixed(3);
        }

        updateTotalAmount();
    }

    // Update total amount
    function updateTotalAmount() {
        let total = 0;
        document.querySelectorAll('.amount-input').forEach(amountInput => {
            const amount = parseFloat(amountInput.value) || 0;
            total += amount;
        });
        totalAmountDisplay.textContent = `₹ ${total.toFixed(2)}`;
    }

  

    // Initial setup for rows
    const rows = billItemsTable.querySelectorAll('.item-row');
    rows.forEach(row => attachProductSelectListener(row));  

     // Add Item functionality
const addRow = document.getElementById('addRow');
if (addRow) {
    addRow.addEventListener('click', function() {
        const tbody = billItemsTable.querySelector('tbody');
        const templateRow = tbody.querySelector('.item-row');
        const newRow = templateRow.cloneNode(true);
        const rowCount = tbody.querySelectorAll('.item-row').length;

        // Update the indices in the name attributes
        newRow.querySelectorAll('select, input').forEach(element => {
            if (element.name) {
                element.name = element.name.replace(/\[\d+\]/, `[${rowCount}]`);
            }
            // Clear values
            element.value = '';
        });

        // Enable remove button for new row
        const removeBtn = newRow.querySelector('.remove-row');
        removeBtn.disabled = false;
        removeBtn.onclick = function() {
            if (tbody.querySelectorAll('.item-row').length > 1) {
                newRow.remove();
                updateTotalAmount();
            }
        };

        // Attach product select listener to new row
        attachProductSelectListener(newRow);

        tbody.appendChild(newRow);
    });
}

    // Enable remove buttons for existing rows if more than one
    const existingRows = billItemsTable.querySelectorAll('.item-row');
    if (existingRows.length > 1) {
        existingRows.forEach(row => {
            const removeBtn = row.querySelector('.remove-row');
            removeBtn.disabled = false;
            removeBtn.onclick = function() {
                if (existingRows.length > 1) {
                    row.remove();
                    updateTotalAmount();
                }
            };
        });
    }



    // Initial total amount calculation
    updateTotalAmount();

    // Form validation
    billForm.addEventListener('submit', function(e) {
        const shift = document.getElementById('shift').value;
        

        if (!shift) {
            alert('Please select a shift');
            e.preventDefault();
            return false;
        }

        //Quantity cannot be 0       

        // Iterate over all Quantity inputs
        document.querySelectorAll('.qty-input').forEach(qtyInput => {
            const qty = parseFloat(qtyInput.value) || 0;

            // Check if the line Quantity is greater than 0
            if (qty <= 0) {
                alert('Quantity Cannot 0.');                
                qtyInput.focus(); // Focus the invalid input for user attention
                return; // Exit loop for this iteration
            }
            
        });



        let totalAmount = 0;
        let isValid = true; // Flag to track validity of individual line amounts

        // Iterate over all amount inputs
        document.querySelectorAll('.amount-input').forEach(amountInput => {
            const amount = parseFloat(amountInput.value) || 0;

            // Check if the line amount is greater than 0
            if (amount <= 0) {
                alert('Each line amount must be greater than 0.');
                isValid = false;
                amountInput.focus(); // Focus the invalid input for user attention
                return; // Exit loop for this iteration
            }

            totalAmount += amount;
        });

        // If any line amount is invalid, prevent form submission
        if (!isValid) {
            e.preventDefault();
            return false;
        }

        // Check if the total amount is greater than 0
        if (totalAmount <= 0) {
            alert('Total amount must be greater than 0.');
            e.preventDefault();
            return false;
        }

    

        // Check if there are any items
        const items = document.querySelectorAll('.item-row');
        const hasValidItems = Array.from(items).some(item => 
            item.querySelector('.product-select').value && 
            parseFloat(item.querySelector('.amount-input').value) > 0
        );

        if (!hasValidItems) {
            alert('Please add at least one valid item');
            e.preventDefault();
            return false;
        }
    });

    const deleteBillBtn = document.getElementById('deleteBillBtn');
    
    if (deleteBillBtn) {
        deleteBillBtn.addEventListener('click', function() {
            const billId = this.dataset.billId;
            
            if (confirm('Are you sure you want to delete this bill? This action cannot be undone.')) {
                fetch(`/bills/${billId}`, {
                    method: 'DELETE'
                }).then(response => {
                    if (response.redirected) {
                        window.location.href = response.url;
                    }
                }).catch(error => {
                    console.error('Delete error:', error);
                    alert('An error occurred while deleting the bill.');
                });
            }
        });
    }

});