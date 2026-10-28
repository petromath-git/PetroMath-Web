// utils/amount-in-words.js — rupee amount in Indian words (lakh / crore), for invoices.
// 59000 -> "Rupees Fifty Nine Thousand Only"; 20768.50 -> "Rupees Twenty Thousand Seven Hundred Sixty Eight and Fifty Paise Only"

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n) {
    return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`.trim();
}

function belowThousand(n) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

function integerInWords(n) {
    if (n === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const rest = n % 1000;
    if (crore) parts.push(`${integerInWords(crore)} Crore`);
    if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
    if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
    if (rest) parts.push(belowThousand(rest));
    return parts.join(' ');
}

function amountInWords(amount) {
    const paiseTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
    const rupees = Math.floor(paiseTotal / 100);
    const paise = paiseTotal % 100;
    let words = `Rupees ${integerInWords(rupees)}`;
    if (paise) words += ` and ${belowHundred(paise)} Paise`;
    return `${words} Only`;
}

module.exports = { amountInWords };
