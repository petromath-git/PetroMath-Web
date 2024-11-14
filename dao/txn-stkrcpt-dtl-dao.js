const db = require("../db/db-connection");
const moment = require('moment');
const Sequelize = require("sequelize");
const { Op } = require("sequelize");
const config = require("../config/app-config");
const TxnDecantLines = db.txn_stkrcpt_dtl;

module.exports = {
    
    saveDecantLineData: (data) => {
        const stckdtlTxn = TxnDecantLines.bulkCreate(data, {
            returning: true,
            updateOnDuplicate: ["ttank_id", "tank_id", "quantity","opening_dip","closing_dip","EB_MS_FLAG",
                "notes", "amount", "updated_by", "updation_date"]
        });
        return stckdtlTxn;
    },

    getdecantlinesdata: (ttank_id) => {
        return TxnDecantLines.findAll({
            where: {'ttank_id': ttank_id}
        });
    },

    deleteDecantLineById: (tdtank_id) => {
        const decantLineTxn = TxnDecantLines.destroy({ where: { tdtank_id: tdtank_id } });
        return decantLineTxn;
    },

    deleteDecantLineByTankid: (ttank_id) => {
        const decantLineTxn = TxnDecantLines.destroy({ where: { ttank_id: ttank_id } });
        return decantLineTxn;
    }

}