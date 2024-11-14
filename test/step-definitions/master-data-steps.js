const expect = require("chai").expect;
const {Given, When, Then} = require("cucumber");
const webdriver = require("selenium-webdriver");

module.exports = () => {
    this.Given(/^user logs in "([^"]*)$" as "([^"]*)" with "([^"]*)"/), (url, userName, password, next) => {
        this.webdriver.get(url).then(next);
    }

    this.When(/^/)
}