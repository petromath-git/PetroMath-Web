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

   // Bill Type change handler
        document.querySelectorAll('input[name="bill_type"]').forEach(radio => {
            radio.addEventListener('change', function() {
                const creditCustomerDiv = document.getElementById('creditCustomerDiv');
                const creditCustomerSelect = document.getElementById('creditCustomer');
                
                if (this.value === 'CREDIT') {
                    creditCustomerDiv.classList.remove('d-none');
                    creditCustomerSelect.required = true;
                } else {
                    creditCustomerDiv.classList.add('d-none');
                    creditCustomerSelect.required = false;
                    creditCustomerSelect.value = ''; // Clear selection when switching to cash
                }
            });
        });

    // Initial setup for rows
    const rows = billItemsTable.querySelectorAll('.item-row');
    rows.forEach(row => attachProductSelectListener(row));

    // Initial total amount calculation
    updateTotalAmount();

    // Form validation
    billForm.addEventListener('submit', function(e) {
        const shift = document.getElementById('shift').value;
        const billType = document.getElementById('billType').value;
        const creditCustomer = billType === 'CREDIT' ? document.getElementById('creditCustomer').value : null;

        if (!shift) {
            alert('Please select a shift');
            e.preventDefault();
            return false;
        }

        if (billType === 'CREDIT' && !creditCustomer) {
            alert('Please select a customer for credit bill');
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