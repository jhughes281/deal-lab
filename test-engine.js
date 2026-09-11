/* Node harness for the Deal Lab engine. */
global.window = global;
require('./assets/js/engine.js');
const E = window.DealLab.Engine;

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
  else console.log('  ok   ' + name + (extra ? '  ' + extra : ''));
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 0.5 : tol); }

console.log('--- primitives ---');
// 200k at 6% for 30y = 1199.10
ok('pmt 200k/6%/30y ~ 1199.10', near(E.pmt(200000, 6, 30), 1199.10, 0.05), E.pmt(200000, 6, 30).toFixed(2));
ok('pmt zero rate', near(E.pmt(120000, 0, 10), 1000, 0.01));
ok('pmt zero principal', E.pmt(0, 6, 30) === 0);

// IRR: -1000 then 5 x 300 -> ~15.24%
ok('irr known case ~15.24%', near(E.irr([-1000, 300, 300, 300, 300, 300]) * 100, 15.24, 0.05),
   (E.irr([-1000,300,300,300,300,300])*100).toFixed(3));
ok('irr no sign change -> NaN', isNaN(E.irr([-100, -50, -20])));
ok('npv at irr is ~0', near(E.npv(E.irr([-1000,300,300,300,300,300]), [-1000,300,300,300,300,300]), 0, 1e-4));

console.log('--- amortisation ---');
const sch = E.amortize(200000, 6, 30, 0, 30);
ok('30 rows', sch.length === 30);
ok('balance hits 0 at term', near(sch[29].balance, 0, 1));
ok('yr1 payment = 12 x pmt', near(sch[0].payment, E.pmt(200000, 6, 30) * 12, 0.5));
ok('yr1 interest ~ 11933', near(sch[0].interest, 11933, 5), sch[0].interest.toFixed(0));
const ioSch = E.amortize(200000, 6, 30, 24, 5);
ok('IO yr1 principal = 0', ioSch[0].principal === 0);
ok('IO yr1 balance unchanged', near(ioSch[0].balance, 200000, 0.01));
ok('IO yr3 amortises', ioSch[2].principal > 0);

console.log('--- book worked examples ---');
// Conti & Harris: NOI 180,000 at 8% cap -> 2,250,000
ok('IRV: 180k / 8% = 2.25M', near(180000 / 0.08, 2250000, 1));
// Break-even: (75,000 + 35,000) / 200,000 = 55%
ok('break-even 55% example', near((75000 + 35000) / 200000 * 100, 55, 0.01));
// Break-even: (185,000 + 95,000) / 400,000 = 70%
ok('break-even 70% example', near((185000 + 95000) / 400000 * 100, 70, 0.01));

console.log('--- default deal end to end ---');
const d = E.defaults();
const r = E.analyze(d);

const is = r.is, cap = r.cap, m = r.metrics;
console.log('  GPI', is.gpi.toFixed(0), '| EGI', is.egi.toFixed(0), '| OpEx', is.opex.toFixed(0), '| NOI', is.noi.toFixed(0));
console.log('  price', cap.price, '| loan', cap.loan.toFixed(0), '| cash', cap.cash.toFixed(0), '| DS', cap.ds.toFixed(0));
console.log('  cap', m.capOnPrice.toFixed(2)+'%', '| CoC', m.coc.toFixed(2)+'%', '| DSCR', m.dscr.toFixed(3),
            '| BE occ', m.beOcc.toFixed(1)+'%', '| CF/mo', m.cfMonthly.toFixed(0));

ok('GPI = rent x 12', near(is.gpi, 2600 * 12, 0.01));
ok('EGI < GPI + other', is.egi < is.gpi + is.other);
ok('NOI = EGI - OpEx', near(is.noi, is.egi - is.opex, 0.01));
ok('broker NOI > true NOI', is.noiBroker > is.noi);
ok('loan = price - down', near(cap.loan, 158000 * 0.75, 0.01));
ok('cash = down+rehab+closing+other+points+fees',
   near(cap.cash, 39500 + 22000 + 3950 + 2500 + 1185 + 1200, 0.01), cap.cash.toFixed(2));
ok('cap rate = NOI/price', near(m.capOnPrice, is.noi / 158000 * 100, 1e-9));
ok('DSCR = NOI/DS', near(m.dscr, is.noi / cap.ds, 1e-9));
ok('CoC = CFBT/cash', near(m.coc, (is.noi - cap.ds) / cap.cash * 100, 1e-9));
ok('debt yield = NOI/loan', near(m.debtYield, is.noi / cap.loan * 100, 1e-9));
ok('LTV 75%', near(cap.ltv, 75, 1e-9));

console.log('--- break-even rent solves to zero cash flow ---');
{
  const c = JSON.parse(JSON.stringify(d));
  c.inc.rentMonthly = m.beRent;
  const r2 = E.analyze(c);
  console.log('  be rent', m.beRent.toFixed(2), '-> CF/mo', r2.metrics.cfMonthly.toFixed(4));
  ok('CF ~ 0 at break-even rent', near(r2.metrics.cfMonthly, 0, 0.02));
}

console.log('--- break-even occupancy cross-check ---');
{
  // At break-even occupancy, collected revenue should equal opex + debt service.
  const collected = is.pgr * (m.beOcc / 100);
  ok('collected at BE = opex + DS', near(collected, is.opex + cap.ds, 0.5),
     collected.toFixed(0) + ' vs ' + (is.opex + cap.ds).toFixed(0));
}

console.log('--- pro forma ---');
const pf = r.proforma;
ok('hold+1 rows', pf.rows.length === d.proj.holdYears + 1);
ok('yr1 NOI = statement NOI', near(pf.rows[0].noi, is.noi, 0.01));
ok('NOI grows', pf.rows[1].noi > pf.rows[0].noi);
ok('balance falls', pf.rows[1].balance < pf.rows[0].balance);
ok('dep = improvable/27.5', near(pf.annualDep, (158000 + 22000) * 0.8 / 27.5, 0.01), pf.annualDep.toFixed(2));
ok('dep years 27.5 for SFR', pf.depYears === 27.5);
ok('sale = forward NOI / exit cap', near(pf.exit.salePrice, pf.exit.forwardNoi / 0.09, 0.01));
ok('net proceeds = sale - costs - payoff',
   near(pf.exit.netProceeds, pf.exit.salePrice - pf.exit.sellCosts - pf.exit.payoff, 0.01));
console.log('  sale', pf.exit.salePrice.toFixed(0), '| payoff', pf.exit.payoff.toFixed(0),
            '| net', pf.exit.netProceeds.toFixed(0), '| IRR', pf.returns.irrBT.toFixed(2)+'%',
            '| EM', pf.returns.equityMultiple.toFixed(2)+'x');
ok('IRR finite', isFinite(pf.returns.irrBT));
ok('IRR consistent with flows', near(E.npv(pf.returns.irrBT/100, pf.flowsBT), 0, 1));
ok('equity multiple > 1 on a profitable deal',
   pf.returns.totalProfit > 0 ? pf.returns.equityMultiple > 1 : true);

console.log('--- commercial depreciation switch ---');
{
  const c = JSON.parse(JSON.stringify(d));
  c.meta.propType = 'retail';
  const r3 = E.analyze(c);
  ok('retail uses 39 years', r3.proforma.depYears === 39);
}

console.log('--- screens ---');
r.screens.forEach(s => console.log('  ' + s.key.padEnd(28), (isFinite(s.value) ? s.value.toFixed(2) : 'NaN'), s.pass === null ? '' : (s.pass ? 'PASS' : 'fail')));
ok('1% rule value = rent/price', near(r.screens[0].value, 2600/158000*100, 1e-9));
ok('70% MAO = .7*ARV - rehab', near(r.screens[2].value, 0.7*268000 - 22000, 0.01));
ok('GRM = price / annual rent', near(r.screens[3].value, 158000/(2600*12), 1e-9));

console.log('--- max offer solver ---');
['coc','dscr','cap','debtYield'].forEach(t => {
  const targets = {coc: 8, dscr: 1.25, cap: 6.5, debtYield: 9};
  const p = E.maxOffer(d, t, targets[t]);
  if (!isFinite(p)) { console.log('  ' + t + ': unreachable'); return; }
  const c = JSON.parse(JSON.stringify(d)); c.buy.price = p;
  const mm = E.analyze(c).metrics;
  const got = t==='coc'?mm.coc:t==='dscr'?mm.dscr:t==='cap'?mm.capOnPrice:mm.debtYield;
  console.log('  ' + t.padEnd(10), 'max offer', p.toFixed(0), '-> achieves', got.toFixed(4), 'target', targets[t]);
  ok('maxOffer/' + t + ' lands on target', near(got, targets[t], t==='dscr'?0.001:0.01));
});

console.log('--- stress ---');
r.stress.forEach(s => console.log('  ' + s.label.padEnd(34), 'CF/mo', s.cfMonthly.toFixed(0).padStart(7),
  'CoC', s.coc.toFixed(2)+'%', 'DSCR', s.dscr.toFixed(2), s.survives ? '' : ' <- breaks'));
ok('rent -10% lowers cash flow', r.stress[0].cfMonthly < m.cfMonthly);
ok('rate +200bp lowers DSCR', r.stress[5].dscr < m.dscr);

console.log('--- sensitivity grid ---');
const sg = r.sensitivity;
ok('5x5 grid', sg.grid.length === 5 && sg.grid[0].length === 5);
ok('centre = base IRR', near(sg.grid[2][2], pf.returns.irrBT, 0.01), sg.grid[2][2].toFixed(3));
ok('lower exit cap -> higher IRR', sg.grid[0][2] > sg.grid[4][2]);
ok('higher rent growth -> higher IRR', sg.grid[2][4] > sg.grid[2][0]);
console.log('  ' + sg.grid.map((row,i) => sg.rows[i].toFixed(2) + ': ' + row.map(v=>isFinite(v)?v.toFixed(1):'--').join(' ')).join('\n  '));

console.log('--- market score ---');
ok('all 3s = 60%', near(r.market.pct, 60, 1e-9), r.market.pct.toFixed(1));
{
  const c = JSON.parse(JSON.stringify(d));
  Object.keys(c.market).forEach(k => c.market[k] = 5);
  ok('all 5s = 100%', near(E.marketScore(c).pct, 100, 1e-9));
  Object.keys(c.market).forEach(k => c.market[k] = 1);
  ok('all 1s = 20%', near(E.marketScore(c).pct, 20, 1e-9));
  c.market.taxBurden = 2;
  ok('weight-3 low scores flagged', E.marketScore(c).flags.length > 0);
}

console.log('--- CMA ---');
{
  const comps = [
    { addr: 'A', price: 300000, sqft: 1500, adjust: 0 },
    { addr: 'B', price: 320000, sqft: 1600, adjust: -5000 },
    { addr: 'C', price: 280000, sqft: 1400, adjust: 0, distressed: true }
  ];
  const c1 = E.cma(comps, 1450);
  ok('distressed excluded', c1.count === 2 && c1.distressed === 1);
  const expected = ((300000/1500) + (315000/1600)) / 2;
  ok('avg adjusted psf', near(c1.avgPsf, expected, 1e-9), c1.avgPsf.toFixed(2));
  ok('indicated = psf x sqft', near(c1.indicated, expected * 1450, 1e-6), c1.indicated.toFixed(0));
  const rc = E.rentCma([{addr:'A', rent: 2000, sqft: 1400},{addr:'B', rent: 2200, sqft: 1500}], 1450);
  ok('rent comps average psf', near(rc.avgPsf, ((2000/1400)+(2200/1500))/2, 1e-9));
  ok('empty cma safe', E.cma([], 1450).count === 0 && isNaN(E.cma([], 1450).indicated));
}

console.log('--- flip path ---');
{
  const c = JSON.parse(JSON.stringify(d));
  c.meta.strategy = 'flip';
  const rf = E.analyze(c);
  const f = rf.flip;
  console.log('  profit', f.profit.toFixed(0), '| cash in', f.cashIn.toFixed(0), '| ROI', f.roi.toFixed(1)+'%',
              '| annualised', f.annualized.toFixed(1)+'%', '| MAO', f.mao.toFixed(0));
  ok('MAO = .7*ARV - rehab', near(f.mao, 0.7*268000 - 22000, 0.01));
  ok('profit = ARV - total cost', near(f.profit, 268000 - f.totalCost, 0.01));
  ok('annualised = roi * 12/months', near(f.annualized, f.roi * 2, 1e-9));
  ok('verdict uses flip tests', rf.verdict.tests.some(t => t.label === 'Net profit'));
}

console.log('--- edge cases ---');
{
  const z = E.defaults();
  z.buy.price = 0; z.inc.rentMonthly = 0; z.buy.arv = 0; z.meta.sqft = 0; z.meta.units = 0;
  let threw = null;
  try { E.analyze(z); } catch (e) { threw = e; }
  ok('zeroed deal does not throw', threw === null, threw ? threw.message : '');

  const allCash = E.defaults();
  allCash.loan.downPct = 100;
  const rc2 = E.analyze(allCash);
  ok('all cash: loan 0', rc2.cap.loan === 0);
  ok('all cash: DS 0', rc2.cap.ds === 0);
  ok('all cash: DSCR infinite', !isFinite(rc2.metrics.dscr));
  ok('all cash: debt yield NaN', isNaN(rc2.metrics.debtYield));
  ok('all cash: IRR still finite', isFinite(rc2.proforma.returns.irrBT), rc2.proforma.returns.irrBT.toFixed(2));

  const oneYear = E.defaults();
  oneYear.proj.holdYears = 1;
  ok('1-year hold works', isFinite(E.analyze(oneYear).proforma.returns.irrBT));

  const long = E.defaults();
  long.proj.holdYears = 30;
  const rl = E.analyze(long);
  ok('30-year hold works', rl.proforma.rows.length === 31);
  ok('depreciation stops after 27.5y', rl.proforma.rows[29].dep === 0);

  const negative = E.defaults();
  negative.inc.rentMonthly = 400;
  const rn = E.analyze(negative);
  ok('negative deal fails verdict', rn.verdict.state === 'fail', rn.verdict.state);
  ok('negative deal CF negative', rn.metrics.cfMonthly < 0);
}

console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAILURES'));
process.exit(fails === 0 ? 0 : 1);
