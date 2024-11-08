
const validateDivTabPromise = (divId, tabId) => {
    return new Promise(function (resolve, reject) {
        resolve(validateDivTab(divId, tabId));
    });
}

function validateDivTab(divId, tabId) {
    let isValid = true;
    if(document.getElementById(divId)) {
        const requiredObjs = document.getElementById(divId).querySelectorAll('[required]');
        requiredObjs.forEach((obj) => {
            const grandPaObj = obj.parentElement.parentElement;
            if (!obj.validity.valid && !grandPaObj.className.includes('d-md-none')) {
                obj.className = "form-control is-invalid";
                let msg = '\n' + obj.id + ' Is A Required Field..';
                obj.focus();
                isValid = false;
            }
        });
    }
    return isValid;
}

function undoInvokedValidation(divId) {
    if(divId) {
        const requiredObjs = document.getElementById(divId).querySelectorAll('[required]');
        requiredObjs.forEach((obj) => {
            if (obj.validity.valid) {
                obj.className = "form-control";
            }
        });
    }
}

function undoShowStaticErrorMessage() {
    const staticMessage = document.getElementById("static-snackbar");
    staticMessage.innerText = '';
    staticMessage.className = 'alert alert-danger d-md-none';
}

function minimumRequirementForTabbing() {
    return document.getElementById('closing_hiddenId').value;
}

function disableLink(link) {
    link.removeAttribute('data-toggle');
}

function enableLink(link) {
    link.setAttribute('data-toggle', 'tab');
}
