const Sequelize = require("sequelize");
const db = require("../db/db-connection");
const TxnClosing = db.txn_closing;
var txnWriteDao = require("../dao/txn-write-dao");
const config = require("../config/app-config");
var dateFormat = require('dateformat');


module.exports = {
    newProduct : function (req) {
        const data = {
            product_name: req.body.m_product_name_0,
            location_code: req.user.location_code,
            qty: req.body.m_product_qty_0,
            unit: req.body.m_product_unit_0,
            price: req.body.m_product_price_0,
            ledger_name:req.body.m_product_ledger_name_0,
            cgst_percent:req.body.m_product_cgst_0,
            sgst_percent:req.body.m_product_sgst_0,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
    },
    newCredit : function (req) {
        const data = {
            Company_Name: req.body.m_credit_name_0,
            type: req.body.m_credit_type_0,
            address: req.body.m_credit_address_0,
            phoneno: req.body.m_credit_phoneno_0,
            gst: req.body.m_credit_gst_0,
            short_name: req.body.m_credit_short_name_0,
            Opening_Balance : 0,
            location_code: req.user.location_code,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id,
            effective_start_date: dateFormat(new Date()),
            effective_end_date: '2400-01-01',
        };
        return data;
    },
    newReceipt: function (req) {
        const data = {
            receipt_date: req.body.txn_receipt_date_0,
            receipt_no: req.body.creditreceiptno_0,
            creditlist_id : req.body.cr_companyId_0,
            digital_creditlist_id: req.body.cr_digitalcreditparty_0 || null,
            receipt_type: req.body.cr_receiptType_0,
            amount: req.body.cramount_0,
            notes: req.body.crnotes_0,
            location_code: req.user.location_code,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
    },
    newUser : function (req) {
        const data = {
            Person_Name: req.body.m_user_name_0,
            User_Name : req.body.m_user_username_0,
            Role: req.body.m_user_role_0,
            location_code: req.user.location_code,
            Password: 'welcome123',
            effective_start_date: dateFormat(new Date()),
            effective_end_date: '2400-01-01',
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
    },
    changePwd: function (req) {
        const data = {
            Person_id: req.user.Person_id,
            Password: req.body.new_password
        };
        return data;
    },
    newTruckLoad: function (req) {
        const data = {
            invoice_date: req.body.txn_invoice_date_0,
            invoice_number: req.body.invoiceno_0,
            decant_date : req.body.txn_decant_date_0,
            decant_time: req.body.decanttime_0,
            location_id:req.body.decantloc_0,
            truck_id: req.body.truckno_0,
            odometer_reading:req.body.odometer_0,
            driver_id:req.body.driverid_0,
            helper_id:req.body.helperid_0,
            MS:req.body.MSQty_0,
            HSD:req.body.HSDQty_0,
            XMS:req.body.XMSQty_0,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        
        return data;
    },
    newTruckExpense: function (req) {
        const data = {
            truck_id:req.body.truckno_0,
            expense_id:req.body.expenseType_0,
            costcenter_id:req.body.expcost_center_0,
            amount:req.body.expamount_0,
            qty:req.body.expqty_0,
            payment_mode:req.body.payment_mode_0,
            expense_date: req.body.txn_exp_date_0,
            notes: req.body.expnotes_0,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
        
    },

    newBankTransaction: function (req, rowCnt) {

        const creditRaw = parseFloat(req.body[`creditamount_${rowCnt}`]);
        const debitRaw = parseFloat(req.body[`debitamount_${rowCnt}`]);

        


        const data = {
            trans_date: req.body[`trans_date_${rowCnt}`],
            bank_id: req.body[`acctno_${rowCnt}`],
            credit_amount: (isNaN(creditRaw) || creditRaw === 0) ? null : creditRaw,
            debit_amount: (isNaN(debitRaw) || debitRaw === 0) ? null : debitRaw,
            transaction_type: req.body[`trans_type_${rowCnt}`],
            accounting_type: req.body[`accnt_type_${rowCnt}`],
            expense_date: req.body[`txn_exp_date_${rowCnt}`],
            remarks: req.body[`banknotes_${rowCnt}`],
            ledger_name: req.body[`ledgername_${rowCnt}`],
            external_id: req.body[`external_id_${rowCnt}`],
            external_source: req.body[`external_source_${rowCnt}`],
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
        
    },
    newDeadlineData : function (req) {
        const data = {
            deadline_date: req.body.deadline_date_0,
            purpose: req.body.purpose_0,
            warning_day: req.body.warning_day_0,
            hard_stop: req.body.hard_stop_0,
            closed: req.body.closed_0,
            comment:req.body.comments_0,
            location_id: req.body.location_id,
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id
        };
        return data;
    },
    newTankDip : function(req) {
        return {
            tank_id: req.body.tank_id,
            dip_date: req.body.dip_date,
            dip_time: req.body.dip_time,
            dip_reading: req.body.dip_reading,
            location_code: req.user.location_code,
            created_by: req.user.User_Name,
            creation_date: new Date()
        };
    },
    newPump: function (req) {
        return {
            pump_code: req.body.pump_code,
            pump_make: req.body.pump_make,
            product_code: req.body.product_code,
            opening_reading: req.body.opening_reading,
            location_code: req.user.location_code,
            current_stamping_date: req.body.current_stamping_date,
            Stamping_due: req.body.Stamping_due,
            effective_start_date: new Date(),
            effective_end_date: '2900-01-01',
            created_by: req.user.User_Name,
            creation_date: new Date()
        };
    },
    updatePump: function (req) {
        return {
            pump_code: req.body.pump_code,
            pump_make: req.body.pump_make,
            product_code: req.body.product_code,
            opening_reading: req.body.opening_reading,
            current_stamping_date: req.body.current_stamping_date,
            Stamping_due: req.body.Stamping_due,
            updated_by: req.user.User_Name,
            updation_date: new Date()
        };
    },

    newPumpTank: function (req) {
        return {
            pump_id: req.body.pump_id,
            tank_id: req.body.tank_id,
            location_code: req.user.location_code,
            effective_start_date: dateFormat(new Date(), "yyyy-mm-dd"),
            effective_end_date: '2900-01-01',
            created_by: req.user.User_Name,
            creation_date: new Date()
        };
    },
    newSupplier: function (req) {
        const now = new Date();
        return {
            supplier_name: req.body.supplier_name_0,
            supplier_short_name: req.body.supplier_short_name_0,
            location_code: req.user.location_code,
            location_id: req.user.location_id,
            created_by: req.user.username,
            creation_date: now,
            effective_start_date: now,
            effective_end_date: '9999-12-31 23:59:59'
        };
    },    
    newVehicle: function (req, rowIndex = 0) {
        const data = {
            creditlist_id: req.body.creditlist_id,
            vehicle_type: req.body[`m_vehicle_type_${rowIndex}`] || null,
            vehicle_number: req.body[`m_vehicle_number_${rowIndex}`],
            created_by: req.user.Person_id,
            updated_by: req.user.Person_id,
            creation_date: new Date(),
            updation_date: new Date(),
            effective_start_date: dateFormat(new Date(), "yyyy-mm-dd"),
            effective_end_date: '2400-01-01'
        };
        return data;
    },
    updateVehicle: function (req, rowIndex = 0) {
        const data = {
            vehicle_type: req.body[`m_vehicle_type_${rowIndex}`] || null,
            vehicle_number: req.body[`m_vehicle_number_${rowIndex}`],
            updated_by: req.user.Person_id,
            updation_date: new Date()
        };
        return data;
    },
    newDigitalCustomer: (req) => {
        return {
            Company_Name: req.body.m_digital_name,
            type: 'credit',
            short_name: req.body.m_digital_name,
            address: req.body.m_digital_name,
            phoneno: req.body.m_digital_phoneno,
            gst: req.body.m_digital_gst,
            Opening_Balance: 0.00,
            location_code: req.user.location_code,
            created_by: req.user.Person_id,
            card_flag: 'Y',  // This is the key difference - marks it as digital
            effective_start_date: new Date(),
            effective_end_date: '2099-12-31'
        };
    }
}
