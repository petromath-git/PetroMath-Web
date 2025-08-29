document.addEventListener('DOMContentLoaded', function() {
    const billForm = document.getElementById('billForm');
    const billItemsTable = document.getElementById('billItemsTable');
    const addRowDesktopBtn = document.getElementById('addRowDesktop');
    const totalAmountDisplay = document.getElementById('totalAmount');
    let rowIndex = 0;

    // Handle product selection for desktop
    function attachProductSelectListener(row) {
        const productSelect = row.querySelector('.product-select');
        const priceInput = row.querySelector('.price-input');
        const qtyInput = row.querySelector('.qty-input');
        const discountInput = row.querySelector('.discount-input');
        const amountInput = row.querySelector('.amount-input');
        const removeBtn = row.querySelector('.remove-row');

        productSelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            const price = selectedOption.getAttribute('data-price') || '0';
            
            priceInput.value = parseFloat(price).toFixed(3);
            
            // Enable remove button if it's not the first row
            if (rowIndex > 0) {
                removeBtn.disabled = false;
            }

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
            
            calculateGrandTotal();
        });

        // Remove row functionality
        removeBtn.addEventListener('click', function() {
            // Prevent removing the last row
            const rows = billItemsTable.querySelectorAll('.item-row');
            if (rows.length > 1) {
                row.remove();
                calculateGrandTotal();
            }
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

        calculateGrandTotal();
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


document.addEventListener('change', function(e) {
    if (e.target.classList.contains('product-select')) {
        const row = e.target.closest('.item-row');
        const selectedOption = e.target.options[e.target.selectedIndex];
        
        // Auto-fill price
        const price = selectedOption.dataset.price;
        const priceInput = row.querySelector('.price-input');
        if (price && priceInput) {
            priceInput.value = parseFloat(price).toFixed(2);
        }
        
        // Set quantity step for unit-based products
        const qtyInput = row.querySelector('.qty-input');
        const unit = selectedOption.dataset.unit || '';
        const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
        
        if (unitBasedProducts.includes(unit.toUpperCase())) {
            qtyInput.step = '1';
            qtyInput.setAttribute('title', 'This product can only be sold in whole units');
        } else {
            qtyInput.step = '0.001';
            qtyInput.setAttribute('title', 'Quantity can have decimals');
        }
        
        // NEW: Set amount field readonly state
        setAmountFieldState(row);
        
        calculateRowTax(row);
    }
});
    


    document.addEventListener('input', function(e) {
    if (e.target.classList.contains('qty-input') || 
        e.target.classList.contains('price-input') || 
        e.target.classList.contains('discount-input')) {
        
        // Prevent negative values
        if (parseFloat(e.target.value) < 0) {
            e.target.value = 0;
        }
        
        const row = e.target.closest('.item-row');
        validateRow(row);
        calculateRowTax(row);
    }

     if (e.target.classList.contains('amount-input')) {
        // Prevent negative values
        if (parseFloat(e.target.value) < 0) {
            e.target.value = 0;
        }
        
        const row = e.target.closest('.item-row');
        validateRow(row);
        reverseCalculateTax(row);
    }
});








    // Add new row for desktop
    addRowDesktopBtn.addEventListener('click', function() {
        rowIndex++;
        const newRow = billItemsTable.querySelector('tbody tr.item-row').cloneNode(true);
        
        // Reset values
        newRow.querySelectorAll('select, input').forEach(el => {
            if (el.type === 'select-one') {
                el.selectedIndex = 0;
            } else if (el.classList.contains('discount-input')) {
                el.value = '0';
            } else {
                el.value = '';
            }
        });

        // Update input names with new index
        newRow.querySelector('.product-select').name = `items[${rowIndex}][product_id]`;
        newRow.querySelector('.price-input').name = `items[${rowIndex}][price]`;
        newRow.querySelector('.qty-input').name = `items[${rowIndex}][qty]`;
        newRow.querySelector('.discount-input').name = `items[${rowIndex}][price_discount]`;
        newRow.querySelector('.amount-input').name = `items[${rowIndex}][amount]`;
        newRow.querySelector('.notes-input').name = `items[${rowIndex}][notes]`;
        newRow.querySelector('.subtotal-hidden').name = `items[${rowIndex}][base_amount]`;
        newRow.querySelector('.cgst-hidden').name = `items[${rowIndex}][cgst_amount]`;
        newRow.querySelector('.sgst-hidden').name = `items[${rowIndex}][sgst_amount]`;
       const cgstPercentInput = newRow.querySelector('input[name*="[cgst_percent]"]');
       const sgstPercentInput = newRow.querySelector('input[name*="[sgst_percent]"]');

        if (cgstPercentInput) cgstPercentInput.name = `items[${rowIndex}][cgst_percent]`;
        if (sgstPercentInput) sgstPercentInput.name = `items[${rowIndex}][sgst_percent]`;

        // Enable remove button
        const removeBtn = newRow.querySelector('.remove-row');
        removeBtn.disabled = false;

        // Attach event listeners
        attachProductSelectListener(newRow);

        // Append new row
        billItemsTable.querySelector('tbody').appendChild(newRow);
    });

    // Mobile: Add item handler
    const addRowMobileBtn = document.getElementById('addRowMobile');
    if (addRowMobileBtn) {
        addRowMobileBtn.addEventListener('click', function() {
            const mobileProduct = document.getElementById('mobileProduct');
            const selectedProduct = mobileProduct.options[mobileProduct.selectedIndex];
            const mobileQty = document.getElementById('mobileQty');
            const mobileDiscount = document.getElementById('mobileDiscount');
            const mobileItemsList = document.getElementById('mobileItemsList');

            const product = selectedProduct.value;
            const qty = mobileQty.value;
            const discount = mobileDiscount.value || 0;
            
            if (!product || !qty) {
                alert('Please fill all required fields');
                return;
            }

            const price = selectedProduct.dataset.price;
            const discountedPrice = parseFloat(price) - parseFloat(discount);
            const amount = discountedPrice * parseFloat(qty);

            // Create mobile item HTML
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('list-group-item');
            itemDiv.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">${selectedProduct.text}</h6>
                        <small>Qty: ${qty} × ₹${price}</small>
                        ${discount > 0 ? `<br><small>Discount: ₹${discount}</small>` : ''}
                    </div>
                    <div class="text-right">
                        <h6 class="mb-1">₹${amount.toFixed(2)}</h6>
                        <button class="btn btn-danger btn-sm delete-mobile-item" type="button">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                <input type="hidden" name="items[${mobileItemsList.children.length}][product_id]" value="${product}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][price]" value="${price}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][qty]" value="${qty}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][price_discount]" value="${discount}">
                <input type="hidden" name="items[${mobileItemsList.children.length}][amount]" value="${amount}">
            `;

            // Append to mobile items list
            mobileItemsList.appendChild(itemDiv);

            // Clear mobile inputs
            mobileProduct.selectedIndex = 0;
            mobileQty.value = '';
            mobileDiscount.value = '';

            calculateGrandTotal();
        });
    }

    // Mobile: Delete item
    document.addEventListener('click', function(e) {
        if (e.target.closest('.delete-mobile-item')) {
            e.target.closest('.list-group-item').remove();
            calculateGrandTotal();
        }
    });

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
                creditCustomerSelect.value = ''; // Clear selection
            }
        });
    });

    // Initial setup for first row
    const firstRow = billItemsTable.querySelector('tbody tr.item-row');
    attachProductSelectListener(firstRow);

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

    // Check if there are any items (either desktop or mobile)
    const desktopItems = document.querySelectorAll('.item-row');
    const mobileItems = document.querySelectorAll('#mobileItemsList .list-group-item');
    const hasDesktopItems = desktopItems.length > 0 && desktopItems[0].querySelector('.product-select').value;
    const hasMobileItems = mobileItems.length > 0;

    if (!hasDesktopItems && !hasMobileItems) {
        alert('Please add at least one item');
        e.preventDefault();
        return false;
    }

    // NEW: Add detailed item validation for desktop items
    if (hasDesktopItems) {
        let hasValidItems = false;
        let allRowsValid = true;
        
        for (let row of desktopItems) {
            const productSelect = row.querySelector('.product-select');
            
            // Skip empty rows
            if (!productSelect.value) {
                continue;
            }
            
            const validation = validateRow(row);
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
            alert('Please add at least one valid item to the bill');
            e.preventDefault();
            return false;
        }
    }

    // If we reach here, all validations passed
    return true;
    });


     // Enable print button after successful save
     if (window.location.search.includes('success=true')) {
        $('#printBtn').prop('disabled', false);
    }

    // Print button click handler
    $('.print-bill, #printBtn').click(function() {
            const billId = $(this).data('bill-id');
            
            // Create a simple menu for print options
            const printMenu = `
                <div class="dropdown-menu show" style="position: absolute; z-index: 1000;">
                    <h6 class="dropdown-header">Print Options</h6>
                    <a class="dropdown-item" href="/bills/${billId}/print" target="_blank">
                        <i class="bi bi-eye"></i> Preview (HTML)
                    </a>
                    <a class="dropdown-item" href="/bills/${billId}/print/pdf" target="_blank">
                        <i class="bi bi-file-pdf"></i> Download PDF
                    </a>
                    <div class="dropdown-divider"></div>
                    <a class="dropdown-item" href="#" onclick="printDirectly(${billId})">
                        <i class="bi bi-printer"></i> Print Directly
                    </a>
                </div>
            `;
            
            // For now, let's just open the PDF directly (simpler approach)
            window.open(`/bills/${billId}/print/pdf`, '_blank');
        });
});


// Auto-calculate tax with RSP-inclusive logic
function calculateRowTax(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const cgstPercent = parseFloat(selectedOption.dataset.cgstPercent || 0);
    const sgstPercent = parseFloat(selectedOption.dataset.sgstPercent || 0);
    
    const rspPrice = parseFloat(priceInput.value || 0);
    const qty = parseFloat(qtyInput.value || 0);
    const discount = parseFloat(discountInput.value || 0);
    
    // Calculate line total after discount (RSP inclusive)
    const lineTotalRSP = (rspPrice * qty) - discount;
    
    // Calculate tax amounts using RSP-inclusive logic
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        baseAmount = lineTotalRSP / (1 + (totalTaxPercent / 100));
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
        baseAmount = lineTotalRSP;
    }
    
    const finalAmount = baseAmount + cgstAmount + sgstAmount;
    
    // Update displays
    const subtotalDisplay = row.querySelector('.subtotal-display');
    const cgstDisplay = row.querySelector('.cgst-display');
    const sgstDisplay = row.querySelector('.sgst-display');
    const amountInput = row.querySelector('.amount-input');
    
    if (subtotalDisplay) subtotalDisplay.textContent = baseAmount.toFixed(2);
    if (cgstDisplay) cgstDisplay.textContent = cgstAmount.toFixed(2);
    if (sgstDisplay) sgstDisplay.textContent = sgstAmount.toFixed(2);
    if (amountInput) amountInput.value = finalAmount.toFixed(2);
    
    // Update hidden fields
    const subtotalHidden = row.querySelector('.subtotal-hidden');
    const cgstHidden = row.querySelector('.cgst-hidden');
    const sgstHidden = row.querySelector('.sgst-hidden');
    const cgstPercentInput = row.querySelector('input[name*="[cgst_percent]"]');
    const sgstPercentInput = row.querySelector('input[name*="[sgst_percent]"]');
    const baseAmountInput = row.querySelector('input[name*="[base_amount]"]');
    const cgstAmountInput = row.querySelector('input[name*="[cgst_amount]"]');
    const sgstAmountInput = row.querySelector('input[name*="[sgst_amount]"]');
    
    if (subtotalHidden) subtotalHidden.value = baseAmount.toFixed(2);
    if (cgstHidden) cgstHidden.value = cgstAmount.toFixed(2);
    if (sgstHidden) sgstHidden.value = sgstAmount.toFixed(2);
    if (cgstPercentInput) cgstPercentInput.value = cgstPercent.toFixed(2);
    if (sgstPercentInput) sgstPercentInput.value = sgstPercent.toFixed(2);
    if (baseAmountInput) baseAmountInput.value = baseAmount.toFixed(2);
    if (cgstAmountInput) cgstAmountInput.value = cgstAmount.toFixed(2);
    if (sgstAmountInput) sgstAmountInput.value = sgstAmount.toFixed(2);
    
    calculateGrandTotal();
}

// Calculate grand total and tax summary
function calculateGrandTotal() {
    let grandTotal = 0;
    const itemRows = document.querySelectorAll('#billItems .item-row');
    itemRows.forEach(function(row) {
        const amountInput = row.querySelector('.amount-input');
        const amount = parseFloat(amountInput?.value || 0);
        grandTotal += amount;
    });
    
    const grandTotalElement = document.getElementById('totalAmount');
    if (grandTotalElement) {
        grandTotalElement.textContent = '₹ ' + grandTotal.toFixed(2);
    }
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

function validateBillForm() {
    let hasValidItems = false;
    let allRowsValid = true;
    const rows = document.querySelectorAll('.item-row');
    
    for (let row of rows) {
        const productSelect = row.querySelector('.product-select');
        
        if (!productSelect.value) {
            continue;
        }
        
        const validation = validateRow(row);
        if (!validation.valid) {
            allRowsValid = false;
            alert(validation.message);
            break;
        } else {
            hasValidItems = true;
        }
    }
    
    if (!hasValidItems) {
        alert('Please add at least one valid item to the bill');
        return false;
    }
    
    return allRowsValid;
}


function reverseCalculateTax(row) {
    const productSelect = row.querySelector('.product-select');
    const qtyInput = row.querySelector('.qty-input');
    const priceInput = row.querySelector('.price-input');
    const discountInput = row.querySelector('.discount-input');
    const amountInput = row.querySelector('.amount-input');
    
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS']; // TODO: Make this configurable
    
    // Only allow manual amount entry for non-unit-based products (fuels, oils by volume)
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        // For unit-based products, recalculate normally (qty -> amount)
        calculateRowTax(row);
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
    
    // Calculate tax breakdown from manual amount (reverse of RSP-inclusive)
    const totalTaxPercent = cgstPercent + sgstPercent;
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    
    if (totalTaxPercent > 0) {
        // Base amount = Manual Amount / (1 + total tax rate)
        baseAmount = manualAmount / (1 + (totalTaxPercent / 100));
        cgstAmount = baseAmount * (cgstPercent / 100);
        sgstAmount = baseAmount * (sgstPercent / 100);
    } else {
        baseAmount = manualAmount;
    }
    
    // Calculate quantity from amount and price
    // Amount after discount = (unitPrice × qty) - discount
    // So: qty = (baseAmount + discount) / unitPrice
    const calculatedQty = (manualAmount + discount) / unitPrice;
    
    // Update quantity field
    qtyInput.value = calculatedQty.toFixed(3);
    
    // Update tax displays
    const subtotalDisplay = row.querySelector('.subtotal-display');
    const cgstDisplay = row.querySelector('.cgst-display');
    const sgstDisplay = row.querySelector('.sgst-display');
    
    if (subtotalDisplay) subtotalDisplay.textContent = baseAmount.toFixed(2);
    if (cgstDisplay) cgstDisplay.textContent = cgstAmount.toFixed(2);
    if (sgstDisplay) sgstDisplay.textContent = sgstAmount.toFixed(2);
    
    // Update hidden fields
    const subtotalHidden = row.querySelector('.subtotal-hidden');
    const cgstHidden = row.querySelector('.cgst-hidden');
    const sgstHidden = row.querySelector('.sgst-hidden');
    const cgstPercentInput = row.querySelector('input[name*="[cgst_percent]"]');
    const sgstPercentInput = row.querySelector('input[name*="[sgst_percent]"]');
    const baseAmountInput = row.querySelector('input[name*="[base_amount]"]');
    const cgstAmountInput = row.querySelector('input[name*="[cgst_amount]"]');
    const sgstAmountInput = row.querySelector('input[name*="[sgst_amount]"]');
    
    if (subtotalHidden) subtotalHidden.value = baseAmount.toFixed(2);
    if (cgstHidden) cgstHidden.value = cgstAmount.toFixed(2);
    if (sgstHidden) sgstHidden.value = sgstAmount.toFixed(2);
    if (cgstPercentInput) cgstPercentInput.value = cgstPercent.toFixed(2);
    if (sgstPercentInput) sgstPercentInput.value = sgstPercent.toFixed(2);
    if (baseAmountInput) baseAmountInput.value = baseAmount.toFixed(2);
    if (cgstAmountInput) cgstAmountInput.value = cgstAmount.toFixed(2);
    if (sgstAmountInput) sgstAmountInput.value = sgstAmount.toFixed(2);
    
    calculateGrandTotal();
}


// Add this function to handle readonly state for amount field
function setAmountFieldState(row) {
    const productSelect = row.querySelector('.product-select');
    const amountInput = row.querySelector('.amount-input');
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const unit = selectedOption.dataset.unit || '';
    const unitBasedProducts = ['NOS', 'PCS', 'UNITS', 'BOTTLES', 'CANS'];
    
    if (unitBasedProducts.includes(unit.toUpperCase())) {
        // Unit-based products: Amount is calculated, not manually entered
        amountInput.readOnly = true;
        amountInput.style.backgroundColor = '#f8f9fa';
        amountInput.title = "Amount is calculated automatically for this product (Qty × Price)";
    } else {
        // Volume-based products: Allow manual amount entry
        amountInput.readOnly = false;
        amountInput.style.backgroundColor = '#ffffff';
        amountInput.title = "You can enter amount directly or it will be calculated from quantity";
    }
}

function printDirectly(billId) {
    const printWindow = window.open(`/bills/${billId}/print/pdf`, '_blank');
    printWindow.addEventListener('load', function() {
        printWindow.print();
    });
}