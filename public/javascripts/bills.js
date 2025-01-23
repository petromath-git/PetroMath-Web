document.addEventListener('DOMContentLoaded', function() {
    const billForm = document.querySelector('#billForm');
   

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
            
            updateTotalAmount();
        });

        // Remove row functionality
        removeBtn.addEventListener('click', function() {
            // Prevent removing the last row
            const rows = billItemsTable.querySelectorAll('.item-row');
            if (rows.length > 1) {
                row.remove();
                updateTotalAmount();
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
       // Always update amount based on quantity
        if (qty > 0) {
            const calculatedAmount = qty * discountedPrice;
            amountInput.value = calculatedAmount.toFixed(3);
        } else {
            amountInput.value = '0.000';
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

            updateTotalAmount();
        });
    }

    // Mobile: Delete item
    document.addEventListener('click', function(e) {
        if (e.target.closest('.delete-mobile-item')) {
            e.target.closest('.list-group-item').remove();
            updateTotalAmount();
        }
    });

    // Bill Type change handler
    const creditCustomerDiv = $('#creditCustomerDiv');
    const creditCustomerSelect = $('#creditCustomer');
    
    $('input[name="bill_type"]').change(function() {
        const billType = $(this).val();
        
        if (billType === 'CASH') {
            creditCustomerDiv.addClass('d-none');
            creditCustomerSelect.prop('required', false);
            creditCustomerSelect.val('');
        } else {
            creditCustomerDiv.removeClass('d-none');
            creditCustomerSelect.prop('required', true);
            
            // Clear and update options based on bill type
            creditCustomerSelect.empty().append('<option value="">Select Customer</option>');
            
            const customers = billType === 'DIGITAL' ? digitalCustomers : creditCustomers;
            customers.forEach(customer => {
                creditCustomerSelect.append(
                    $('<option></option>')
                        .val(customer.creditlist_id)
                        .text(customer.Company_Name)
                );
            });
        }
    });
    // Initial setup for first row
    const firstRow = billItemsTable.querySelector('tbody tr.item-row');
    attachProductSelectListener(firstRow);

    // Form validation
    billForm.addEventListener('submit', function(e) {


        let shift;
        const shiftSelect = document.getElementById('shift');
        const shiftHiddenInput = document.querySelector('input[name="closing_id"]');


        // Determine the shift value based on available input
        if (shiftSelect) {
            shift = shiftSelect.value;
        } else if (shiftHiddenInput) {
            shift = shiftHiddenInput.value;
        }    


        const billTypeInput = document.querySelector('input[name="bill_type"]:checked');
        const billType = billTypeInput ? billTypeInput.value : null;
        const creditCustomer = (billType === 'CREDIT' || billType === 'DIGITAL') 
                            ? document.getElementById('creditCustomer').value 
                            : null;


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
               

        if (!shift) {
            alert('Please select a shift');
            e.preventDefault();
            return false;
        }

        if ((billType === 'CREDIT' || billType === 'DIGITAL') && !creditCustomer) {
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
    });


     // Enable print button after successful save
     if (window.location.search.includes('success=true')) {
        $('#printBtn').prop('disabled', false);
    }

    // Print button click handler
    $('.print-bill, #printBtn').click(function() {
        const billId = $(this).data('bill-id');
        window.open(`/bills/${billId}/print`, '_blank');
    });
});