const appUtils = require("../../utils/app-utils");
const AppError = require("../../exception/AppException");
const msg = require("../../config/app-messages");
const db = require("../../db/db-connection");

const {expect, assert} = require("chai");

describe("Test app util", function() {

    before(() => {
        if(db.schemaName.includes('_dev')) {
            deleteDao.deleteAllMasterRecords();
            deleteDao.deleteAllTxnRecords();
        } else {
            assert.fail("Incorrect DB to proceed..");
        }
    })

    it("Testing noOfDaysDifference - valid number of days", function() {
        const noOfDaysDifference = 5;
        let dateObj = new Date(), dateObj2 = new Date(dateObj);
        dateObj2.setDate(dateObj.getDate() - noOfDaysDifference);
        expect(appUtils.noOfDaysDifference(dateObj2, dateObj)).to.equal(noOfDaysDifference);
    });

    it("Testing noOfDaysDifference - providing same end date ", function() {
        expect(appUtils.noOfDaysDifference(Date.now(), Date.now())).to.equal(0);
    });

    it("Testing noOfDaysDifference - providing wrong input ", function() {
        const noOfDaysDifference = 5;
        let dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - noOfDaysDifference);
        expect(function() { appUtils.noOfDaysDifference(Date.now(), dateObj); })
            .to.throw(AppError);
    });
})