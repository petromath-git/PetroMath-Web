//const request = require('supertest');
const request = require('superagent');
const cheerio = require('cheerio');
const localAddress = 'http://localhost:5000';
const app = require("../../app");
const userRequest = request.agent(app);
const db = require("../../db/db-connection");
const deleteDao = require("../data/bulk-delete");
const person = db.person;
const product = db.product;
const pump = db.pump;
const credit = db.credit;
const expense = db.expense;
const {expect, assert} = require("chai");


describe("App master data", function() {

    let isDBClean = false;
    before(() => {
        if(!isDBClean) {
            if (db.schemaName.includes('_dev')) {
                isDBClean = true;
                deleteDao.deleteAllMasterRecords();
                deleteDao.deleteAllTxnRecords();
            } else {
                assert.fail("Incorrect DB to proceed..");
            }
        }
    })

    describe("Page: get login page", function() {
        it("LOGIN", function (done) {
            userRequest
                .get(localAddress + '/login')
                .end(function(err, res) {
                    expect(res.status).to.equal(200);
                    if (err) {
                        return done(err);
                    }
                    done();
                });
        });
    })

    describe("Login : happy path", function() {
        it('LOGIN POST', function(done) {
            this.timeout(10000);
            userRequest
                .post(localAddress + '/login')
                .send({ 'username': 'admin', 'password': 'welcome123' })
                .end((err, res) => {
                    console.warn("RESPONSE FOR LOGIN POST " + JSON.stringify(res.text));
                    expect(res.status).to.equal(200);
                    const $ = cheerio.load(res.text);
                    expect($('#user_details').text()).to.equal("Logged in as admin for 'MC'");
                    expect($('#get-new-closing').get().length).to.equal(1);
                    if (err) {
                        return done(err);
                    }
                    done();
                });
        });
    });

    describe("Users : List", function() {
        it("USERS POST", function(done) {
            this.timeout(10000);
            userRequest
                .post(localAddress + '/users')
                .send('m_user_name_0=mc_manager&m_user_username_0=mc_manager&m_user_role_0=Cashier')
                .end((err, res) => {
                    console.warn("RESPONSE FOR USERS POST " + JSON.stringify(res));
                    expect(res.status).to.equal(200);
                    const $ = cheerio.load(res.text);
                    const userRows = $('tbody tr');

                    console.warn(userRows[1].children[1].children[0].data);

                    expect(userRows[1].children.length).to.equal(5);
                    expect(userRows[1].children[1].children.length).to.equal(1);
                    expect(userRows[1].children[1].children[0].data).to.equal('mc_manager');
                    expect(userRows[1].children[2].children.length).to.equal(1);
                    expect(userRows[1].children[2].children[0].data).to.equal('mc_manager');
                    expect(userRows[1].children[3].children.length).to.equal(1);
                    expect(userRows[1].children[3].children[0].data).to.equal('Cashier');
                    if (err) {
                        return done(err);
                    }
                    done();
                });
        });

        it("USERS GET", function(done) {
            userRequest
                .get(localAddress + '/users')
                .end((err, res) => {
                    console.warn("RESPONSE FOR USERS GET " + JSON.stringify(res));
                    const $ = cheerio.load(res.text);
                    expect($('#users-add-new').length).to.equal(1);
                    expect($('#users-save').length).to.equal(1);
                    expect(res.status).to.equal(200);
                    if (err) {
                        return done(err);
                    }
                    done();
                });
        });

        it("USERS POST Duplicate", function(done) {
            userRequest
                .post(localAddress + '/users')
                .send('m_user_name_0=mc_manager&m_user_username_0=mc_manager&m_user_role_0=Cashier')
                .end((err, res) => {
                    console.warn("RESPONSE FOR USERS POST " + JSON.stringify(res));
                    expect(res.status).to.equal(400);
                    done();
                });
        });
    })
});



