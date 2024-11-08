
module.exports = {
    loadPage: (url, waitInSeconds) => {
        var timeout = (waitInSeconds) ? (waitInSeconds * 1000) : DEFAULT_TIMEOUT;
        return driver.get(url).then(function() {
            return driver.wait(until.elementLocated(by.css('body')), timeout);
        });
    }

}