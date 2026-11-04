const { buildStockStatement } = require("../../utils/bowser-stock-statement");
const { expect } = require("chai");

const move = (movement_date, fill_qty, credit_qty = 0, cash_qty = 0, digital_qty = 0, status = null, bowser_closing_id = null) =>
    ({ movement_date, fill_qty, credit_qty, cash_qty, digital_qty, status, bowser_closing_id });

describe("Bowser stock statement", function () {

    it("carries earlier movements into the opening and runs the balance per day", function () {
        const s = buildStockStatement([
            move('2026-10-03', '2100.000'),
            move('2026-10-25', '941.650'),
            move('2026-10-26', '0', '2595.010', '0', '0', 'CLOSED', 202)
        ], '2026-10-25', '2026-10-27', 6000);

        expect(s.opening).to.equal(2100);
        expect(s.days.map(d => d.date)).to.eql(['2026-10-25', '2026-10-26', '2026-10-27']);
        expect(s.days.map(d => d.closing)).to.eql([3041.65, 446.64, 446.64]);
        expect(s.days[1].bowser_closing_id).to.equal(202);
        expect(s.days[2].has_movement).to.equal(false);
        expect(s.totals.fill).to.equal(941.65);
        expect(s.totals.out).to.equal(2595.01);
        expect(s.closing).to.equal(446.64);
    });

    it("adds credit, cash and digital litres into out", function () {
        const s = buildStockStatement([move('2026-10-24', '1000', '100', '551.3179', '10.5', 'DRAFT', 1)], '2026-10-24', '2026-10-24', 6000);
        expect(s.days[0].out).to.equal(661.818);
        expect(s.closing).to.equal(338.182);
        expect(s.draftDays).to.equal(1);
    });

    it("starts at the bowser's first entry, not at the start of a longer period", function () {
        const s = buildStockStatement([move('2026-10-03', '50')], '2000-01-01', '2026-10-04', 6000);
        expect(s.opening).to.equal(0);
        expect(s.days.map(d => d.date)).to.eql(['2026-10-03', '2026-10-04']);
    });

    it("starts from the opening balance and ignores entries before its date", function () {
        const movements = [
            move('2026-10-03', '2100'),
            move('2026-10-10', '500'),
            move('2026-10-12', '0', '200')
        ];
        const opening = { qty: '1000.000', date: '2026-10-10' };

        const fromStart = buildStockStatement(movements, '2026-10-01', '2026-10-12', 6000, opening);
        expect(fromStart.opening).to.equal(1000);
        expect(fromStart.days.map(d => d.date)).to.eql(['2026-10-10', '2026-10-11', '2026-10-12']);
        expect(fromStart.closing).to.equal(1300);

        const later = buildStockStatement(movements, '2026-10-11', '2026-10-12', 6000, opening);
        expect(later.opening).to.equal(1500);
        expect(later.closing).to.equal(1300);
    });

    it("shows days from the opening date even with no entries, and a zero opening is valid", function () {
        const s = buildStockStatement([], '2026-10-01', '2026-10-02', 6000, { qty: '0.000', date: '2026-10-01' });
        expect(s.days.length).to.equal(2);
        expect(s.closing).to.equal(0);
    });

    it("shows nothing for a period that ends before the opening date", function () {
        const s = buildStockStatement([move('2026-09-01', '100')], '2026-09-01', '2026-09-30', 6000, { qty: '1000', date: '2026-10-01' });
        expect(s.beforeOpeningDate).to.equal(true);
        expect(s.days).to.eql([]);
        expect(s.opening).to.equal(0);
        expect(s.closing).to.equal(0);
    });

    it("flags balances that cannot be real", function () {
        const s = buildStockStatement([
            move('2026-10-01', '0', '10'),
            move('2026-10-02', '7000')
        ], '2026-10-01', '2026-10-02', 6000);
        expect(s.negativeDays).to.equal(1);
        expect(s.days[0].is_negative).to.equal(true);
        expect(s.overCapacityDays).to.equal(1);
        expect(s.days[1].is_over_capacity).to.equal(true);
    });

    it("ignores capacity when none is set, and handles no movements", function () {
        expect(buildStockStatement([move('2026-10-01', '7000')], '2026-10-01', '2026-10-01', 0).overCapacityDays).to.equal(0);
        const empty = buildStockStatement([], '2026-10-01', '2026-10-31', 6000);
        expect(empty.days).to.eql([]);
        expect(empty.closing).to.equal(0);
    });
});
