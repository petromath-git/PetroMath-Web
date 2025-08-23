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

    // Enhanced item validation
    const items = document.querySelectorAll('.item-row');
    let hasValidItems = false;
    let allRowsValid = true;
    
    for (let item of items) {
        const productSelect = item.querySelector('.product-select');
        
        // Skip empty rows
        if (!productSelect.value) {
            continue;
        }
        
        const validation = validateRow(item);
        if (!validation.valid) {
            allRowsValid = false;
            alert(validation.message);
            e.preventDefault();
            return false;
        } else {
            hasValidItems = true;
        }
    }

    if (!hasValidItems) {
        alert('Please add at least one valid item');
        e.preventDefault();
        return false;
    }
    
    return true;
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

    $(document).ready(function() {
    // Enhanced product selection handler
    $(document).on('change', '.product-select', function() {
        const row = $(this).closest('.item-row');
        const selectedOption = $(this).find('option:selected');
        
        // Auto-fill price from product data
        const price = selectedOption.data('price');
        if (price) {
            row.find('.price-input').val(parseFloat(price).toFixed(2));
        }
        
        // Set quantity step and amount readonly state
        const unit = selectedOption.data('unit') || '';
        const qtyInput = row.find('.qty-input')[0];
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        
        if (unitBasedProducts.includes(unit.toUpperCase())) {
            qtyInput.step = '1';
            qtyInput.setAttribute('title', 'This product can only be sold in whole units');
        } else {
            qtyInput.step = '0.001';
            qtyInput.setAttribute('title', 'Quantity can have decimals');
        }
        
        // Set amount field readonly state
        setAmountFieldState(row[0]);
        
        calculateRowTax(row);
    });
    
    // Enhanced input validation
    $(document).on('input', '.qty-input, .price-input, .discount-input', function() {
        // Prevent negative values
        if (parseFloat($(this).val()) < 0) {
            $(this).val(0);
        }
        
        const row = $(this).closest('.item-row');
        validateRow(row[0]);
        calculateRowTax(row);
    });
    
    // Handle manual amount entry
    $(document).on('input', '.amount-input', function() {
        // Prevent negative values
        if (parseFloat($(this).val()) < 0) {
            $(this).val(0);
        }
        
        const row = $(this).closest('.item-row')[0];
        validateRow(row);
        reverseCalculateTax(row);
    });
    
    // Calculate on page load for edit screen with existing data
    $('#billItems .item-row').each(function() {
        const productSelect = $(this).find('.product-select');
        if (productSelect.val()) {
            setAmountFieldState(this);
            calculateRowTax($(this));
        }
    });
});


    // Calculate on page load for edit screen with existing data
    const existingRows = document.querySelectorAll('#billItems .item-row');
    existingRows.forEach(function(row) {
        const productSelect = row.querySelector('.product-select');
        if (productSelect && productSelect.value) {
            calculateRowTax(row);
        }
    });    


});


function calculateRowTax(row) {
    const productSelect = row.find('.product-select');
    const qtyInput = row.find('.qty-input');
    const priceInput = row.find('.price-input');
    const discountInput = row.find('.discount-input');
    
    const selectedOption = productSelect.find('option:selected');
    const cgstPercent = parseFloat(selectedOption.data('cgst-percent') || 0);
    const sgstPercent = parseFloat(selectedOption.data('sgst-percent') || 0);
    
    const rspPrice = parseFloat(priceInput.val() || 0);
    const qty = parseFloat(qtyInput.val() || 0);
    const discount = parseFloat(discountInput.val() || 0);
    
    // Calculate line total after discount (RSP inclusive)
    const lineTotalRSP = (rspPrice * qty) - discount;
    
    // Calculate tax amounts using RSP-inclusive logic
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        // Base amount = RSP / (1 + total tax rate)
        baseAmount = lineTotalRSP / (1 + (totalTaxPercent / 100));
        
        // Individual tax amounts
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
        // No tax case
        baseAmount = lineTotalRSP;
    }
    
    // Final amount should equal lineTotalRSP (verification)
    const finalAmount = baseAmount + cgstAmount + sgstAmount;
    
    // Update the row displays
    row.find('.subtotal-display').text(baseAmount.toFixed(2));
    row.find('.cgst-display').text(cgstAmount.toFixed(2));
    row.find('.sgst-display').text(sgstAmount.toFixed(2));
    row.find('.amount-input').val(finalAmount.toFixed(2));
    
    // Update hidden fields for form submission
    row.find('.subtotal-hidden').val(baseAmount.toFixed(2));
    row.find('.cgst-hidden').val(cgstAmount.toFixed(2));
    row.find('.sgst-hidden').val(sgstAmount.toFixed(2));
    row.find('input[name*="[cgst_percent]"]').val(cgstPercent.toFixed(2));
    row.find('input[name*="[sgst_percent]"]').val(sgstPercent.toFixed(2));
    row.find('input[name*="[base_amount]"]').val(baseAmount.toFixed(2));
    row.find('input[name*="[cgst_amount]"]').val(cgstAmount.toFixed(2));
    row.find('input[name*="[sgst_amount]"]').val(sgstAmount.toFixed(2));
    
    calculateGrandTotal();
}


function calculateGrandTotal() {
    let grandTotal = 0;
    let totalBase = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    
    $('#billItems .item-row').each(function() {
        const amount = parseFloat($(this).find('.amount-input').val() || 0);
        const base = parseFloat($(this).find('.subtotal-hidden').val() || 0);
        const cgst = parseFloat($(this).find('.cgst-hidden').val() || 0);
        const sgst = parseFloat($(this).find('.sgst-hidden').val() || 0);
        
        grandTotal += amount;
        totalBase += base;
        totalCGST += cgst;
        totalSGST += sgst;
    });
    
    // Update grand total display
    $('#grandTotal').text('₹ ' + grandTotal.toFixed(2));
    
    // Update tax summary if elements exist
    $('#totalBase').text('₹ ' + totalBase.toFixed(2));
    $('#totalCGST').text('₹ ' + totalCGST.toFixed(2));
    $('#totalSGST').text('₹ ' + totalSGST.toFixed(2));
}


function validateRow(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    const amountInput = row.querySelector('.amount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    
    let isValid = true;
    let errorMessage = '';
    
    if (!productSelect.value) {
        return { valid: true }; // Empty row is okay
    }
    
    // Validate quantity
    const qty = parseFloat(qtyInput.value || 0);
    if (qty <= 0) {
        isValid = false;
        errorMessage = 'Quantity must be greater than 0';
        qtyInput.style.borderColor = 'red';
    } else {
        // Check unit-based products
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        if (unitBasedProducts.includes(unit.toUpperCase()) && qty % 1 !== 0) {
            isValid = false;
            errorMessage = `${selectedOption.text} must be sold in whole units only`;
            qtyInput.style.borderColor = 'red';
        } else {
            qtyInput.style.borderColor = '';
        }
    }
    
    // Validate price
    const price = parseFloat(priceInput.value || 0);
    if (price <= 0) {
        isValid = false;
        errorMessage = 'Price must be greater than 0';
        priceInput.style.borderColor = 'red';
    } else {
        priceInput.style.borderColor = '';
    }
    
    // Validate discount
    const discount = parseFloat(discountInput.value || 0);
    const lineTotal = price * qty;
    if (discount < 0) {
        isValid = false;
        errorMessage = 'Discount cannot be negative';
        discountInput.style.borderColor = 'red';
    } else if (discount >= lineTotal) {
        isValid = false;
        errorMessage = 'Discount cannot be equal to or greater than line total';
        discountInput.style.borderColor = 'red';
    } else {
        discountInput.style.borderColor = '';
    }
    
    // Validate final amount
    const amount = parseFloat(amountInput.value || 0);
    if (amount <= 0) {
        isValid = false;
        errorMessage = 'Final amount must be greater than 0';
        amountInput.style.borderColor = 'red';
    } else {
        amountInput.style.borderColor = '';
    }
    
    return { valid: isValid, message: errorMessage };
}


function reverseCalculateTax(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    const amountInput = row.querySelector('.amount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
    
    // Only allow manual amount entry for non-unit-based products
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        calculateRowTax($(row)); // Use jQuery version for existing code
        return;
    }
    
    const cgstPercent = parseFloat(selectedOption.dataset.cgstPercent || 0);
    const sgstPercent = parseFloat(selectedOption.dataset.sgstPercent || 0);
    
    const manualAmount = parseFloat(amountInput.value || 0);
    const unitPrice = parseFloat(priceInput.value || 0);
    const discount = parseFloat(discountInput.value || 0);
    
    if (manualAmount <= 0 || unitPrice <= 0) {
        return;
    }
    
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        baseAmount = manualAmount / (1 + (totalTaxPercent / 100));
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
        baseAmount = manualAmount;
    }
    
    const calculatedQty = (manualAmount + discount) / unitPrice;
    qtyInput.value = calculatedQty.toFixed(3);
    
    // Update using jQuery to match existing code
    const $row = $(row);
    $row.find('.subtotal-display').text(baseAmount.toFixed(2));
    $row.find('.cgst-display').text(cgstAmount.toFixed(2));
    $row.find('.sgst-display').text(sgstAmount.toFixed(2));
    
    $row.find('.subtotal-hidden').val(baseAmount.toFixed(2));
    $row.find('.cgst-hidden').val(cgstAmount.toFixed(2));
    $row.find('.sgst-hidden').val(sgstAmount.toFixed(2));
    $row.find('input[name*="[cgst_percent]"]').val(cgstPercent.toFixed(2));
    $row.find('input[name*="[sgst_percent]"]').val(sgstPercent.toFixed(2));
    $row.find('input[name*="[base_amount]"]').val(baseAmount.toFixed(2));
    $row.find('input[name*="[cgst_amount]"]').val(cgstAmount.toFixed(2));
    $row.find('input[name*="[sgst_amount]"]').val(sgstAmount.toFixed(2));
    
    calculateGrandTotal();
}

function setAmountFieldState(row) {
    const productSelect = row.querySelector('.product-select');
    const amountInput = row.querySelector('.amount-input');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
    
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        amountInput.readOnly = true;
        amountInput.style.backgroundColor = '#f8f9fa';
        amountInput.title = "Amount is calculated automatically for this product (Qty × Price)";
    } else {
        amountInput.readOnly = false;
        amountInput.style.backgroundColor = '#ffffff';
        amountInput.title = "You can enter amount directly or it will be calculated from quantity";
    }
}