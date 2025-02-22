const db = require("../db/db-connection");
const LubesInvoiceHeader = db.t_lubes_inv_hdr;
const LubesInvoiceLine = db.t_lubes_inv_lines;
const Product = db.product;
const Supplier = db.m_supplier;
const Location = db.location;
const config = require("../config/app-config");
const { Sequelize, Op } = require("sequelize");

module.exports = {
    findLubesInvoice: (locationCode, lubesHdrId) => {
        return LubesInvoiceHeader.findByPk(lubesHdrId, {
            include: [
                {
                    model: LubesInvoiceLine,
                    include: [
                        {
                            model: Product || db.m_product,
                            attributes: ['product_name', 'unit', 'price']
                        }
                    ]
                }
            ]
        });
    },
    
    findLubesInvoices: (locationCode, fromDate, toDate) => {
        return LubesInvoiceHeader.findAll({
            where: { 
                [Op.and]: [
                    { location_code: locationCode },
                    {
                        invoice_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), ">=", fromDate)
                    },
                    {
                        invoice_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), "<=", toDate)
                    }
                ] 
            },
            include: [
                {
                    model: Supplier,
                    attributes: ['supplier_name']
                },
                {
                    model: LubesInvoiceLine,
                    attributes: ['lubes_line_id']
                }
            ],
            order: [Sequelize.literal('invoice_date')]
        });
    },
    
    findLubesInvoicesWithSpecificDate: (locationCode, invoiceDate) => {
        return LubesInvoiceHeader.findAll({
            where: { 
                [Op.and]: [
                    { location_code: locationCode },
                    {
                        invoice_date: Sequelize.where(
                            Sequelize.fn("date_format", Sequelize.col("invoice_date"), '%Y-%m-%d'), "=", invoiceDate)
                    }
                ] 
            }
        });
    },
    
    addNew: (lubesInvoiceHeader) => {
        return LubesInvoiceHeader.create(lubesInvoiceHeader);
    },
    
    findLubesInvoiceLines: (lubesHdrId) => {
        return LubesInvoiceLine.findAll({
            where: { lubes_hdr_id: lubesHdrId },
            include: [
                {
                    model: Product,
                    attributes: ['product_name', 'unit', 'price']
                }
            ],
            attributes: [
                'lubes_line_id', 
                'product_id', 
                'qty', 
                'amount', 
                'mrp', 
                'net_rate', 
                'notes'
            ]
        });
    },
    
    saveLubesInvoiceLines: (data) => {
        const lines = LubesInvoiceLine.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: [
                "product_id", 
                "qty", 
                "mrp", 
                "net_rate", 
                "amount", 
                "notes", 
                "updated_by", 
                "updation_date"
            ]
        });
        return lines;
    },
    
    deleteLine: (id) => {
        const line = LubesInvoiceLine.destroy({ where: { lubes_line_id: id } });
        return line;
    },
    
    finishInvoice: (lubesHdrId) => {
        const invoice = LubesInvoiceHeader.update(
            { closing_status: 'CLOSED' },
            { where: { lubes_hdr_id: lubesHdrId } }
        );
        return invoice;
    },
    
    deleteLubesInvoice: (lubesHdrId) => {
        return db.sequelize.transaction(async (t) => {
            // Delete lines first due to foreign key constraint
            await LubesInvoiceLine.destroy({ 
                where: { lubes_hdr_id: lubesHdrId },
                transaction: t
            });
            
            // Then delete header
            const result = await LubesInvoiceHeader.destroy({ 
                where: { lubes_hdr_id: lubesHdrId },
                transaction: t
            });
            
            return result;
        });
    },
    
    getProducts: (locationCode) => {
        return Product.findAll({
            where: {
                location_code: locationCode,
                [Sequelize.Op.and]: [
                    Sequelize.literal(`product_name NOT IN (
                        SELECT DISTINCT product_code 
                        FROM m_pump 
                        WHERE location_code = '${locationCode}')`)
                ]
            },
            order: [['product_name', 'ASC']]
        });
    },
    
    getSuppliers: (locationCode) => {
        return Supplier.findAll({
            where: { location_code: locationCode },
            order: [['supplier_name', 'ASC']]
        });
    },
    
    getLocations: () => {
        return Location.findAll({
            order: [['location_code', 'ASC']]
        });
    },
    getLocationId: (locationCode) => {
        return Location.findOne({
            attributes: ['location_id'],
            where: {'location_code': locationCode}
        });
    },    
    updateProductQuantity: (productId, qty, updatedBy) => {
        return Product.update(
            { 
                qty: Sequelize.literal(`qty + ${qty}`),
                updated_by: updatedBy,
                updation_date: Sequelize.fn('NOW')
            },
            { where: { product_id: productId } }
        );
    }
};
