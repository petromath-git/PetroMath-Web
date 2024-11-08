const db = require("../db/db-connection");
const Product = db.product;
const { Op } = require("sequelize");
const Sequelize = require("sequelize");

module.exports = {
    findProducts: (locationCode) => {
        if (locationCode) {
            return Product.findAll({
                attributes: ['product_id', 'product_name', 'qty', 'unit', 'price','ledger_name','cgst_percent','sgst_percent'],
                where: {'location_code': locationCode},
                order: [Sequelize.literal("case when product_name in ('MS','HSD','XMS') then 0 else 1 end,product_name")],
            });
        } else {
            return Product.findAll({
                attributes: ['product_id', 'product_name', 'qty', 'unit', 'price','ledger_name','cgst_percent','sgst_percent'],
                order: [Sequelize.literal("case when product_name in ('MS','HSD','XMS') then 0 else 1 end,product_name")],
            });

        }
        
    },
    findProductNames: (productIds) => {
        return Product.findAll({
            attributes: ['product_id','product_name'], where: {'product_id': productIds}
        });
    },
    findPreviousDaysData: (locationCode) => {
        // TODO: Move to t_closing or whichever table will have required entries
        return Product.findAll({
            attributes: ['product_name', 'qty', 'unit', 'price'], where: {'location_code': locationCode}
        });
    },
    create: (product) => {
        return Product.create(product);
    },
    update: (product) => {
        return Product.update({
            price: product.price,
            unit: product.unit,
            ledger_name:product.ledger_name,
            cgst_percent:product.cgst_percent,
            sgst_percent:product.sgst_percent
        }, {
            where: {'product_id': product.product_id},
        });
    }
};