/* =============================================================
   Deal Lab — calculation engine
   Pure functions only. No DOM. Exposed as window.DealLab.Engine.

   Sources the formulas follow:
     - Conti & Harris, "Commercial Real Estate Investing For Dummies"
       (cap rate, NOI, cash-on-cash, break-even occupancy, IRV)
     - Tyson & Griswold, "Real Estate Investing For Dummies"
       (GRM/GIM, IRV, zero-based pro forma, 27.5/39-yr recovery)
     - Mashvisor, "How to Analyze Real Estate Deals in 5 Steps"
       (the five-step order, the 1%/2% screen, CMA)
   ============================================================= */
(function (root) {
  'use strict';

  var E = {};

  /* ---------------------------------------------------------
     Small numeric helpers
     --------------------------------------------------------- */

  function num(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function safeDiv(a, b) { return (b === 0 || !isFinite(b)) ? NaN : a / b; }

  E.num = num;
  E.clamp = clamp;

  /* Level payment on a fully amortising loan. */
  function pmt(principal, annualRatePct, years) {
    var n = Math.round(years * 12);
    if (principal <= 0 || n <= 0) return 0;
    var r = annualRatePct / 100 / 12;
    if (r === 0) return principal / n;
    return principal * r / (1 - Math.pow(1 + r, -n));
  }
  E.pmt = pmt;

  /* Monthly amortisation rolled up by year.
     ioMonths = interest-only period before amortisation begins. */
  function amortize(principal, annualRatePct, years, ioMonths, throughYears) {
    var out = [];
    var z;
    if (principal <= 0) {
      for (z = 1; z <= throughYears; z++) {
        out.push({ year: z, interest: 0, principal: 0, payment: 0, balance: 0 });
      }
      return out;
    }
    var r = annualRatePct / 100 / 12;
    var io = Math.max(0, Math.round(ioMonths || 0));
    var amortMonths = Math.max(1, Math.round(years * 12) - io);
    var level = pmt(principal, annualRatePct, amortMonths / 12);
    var bal = principal;

    for (var y = 1; y <= throughYears; y++) {
      var yi = 0, yp = 0, ypay = 0;
      for (var m = 1; m <= 12; m++) {
        var monthIndex = (y - 1) * 12 + m;
        var interest = bal * r;
        var payment, princ;
        if (monthIndex <= io) {
          payment = interest;
          princ = 0;
        } else {
          payment = level;
          princ = payment - interest;
          if (princ > bal) { princ = bal; payment = bal + interest; }
        }
        bal = Math.max(0, bal - princ);
        yi += interest; yp += princ; ypay += payment;
      }
      out.push({ year: y, interest: yi, principal: yp, payment: ypay, balance: bal });
    }
    return out;
  }
  E.amortize = amortize;

  function npv(rate, flows) {
    var v = 0;
    for (var i = 0; i < flows.length; i++) v += flows[i] / Math.pow(1 + rate, i);
    return v;
  }
  E.npv = npv;

  /* IRR by bisection. Robust for the sign pattern real estate produces
     (one negative up front, positives after). Returns NaN if no sign change. */
  function irr(flows) {
    if (!flows || flows.length < 2) return NaN;
    var hasNeg = false, hasPos = false;
    for (var i = 0; i < flows.length; i++) {
      if (flows[i] < 0) hasNeg = true;
      if (flows[i] > 0) hasPos = true;
    }
    if (!hasNeg || !hasPos) return NaN;

    var lo = -0.9999, hi = 10;
    var fLo = npv(lo, flows), fHi = npv(hi, flows);
    if (fLo * fHi > 0) return NaN;

    for (var k = 0; k < 200; k++) {
      var mid = (lo + hi) / 2;
      var fMid = npv(mid, flows);
      if (Math.abs(fMid) < 1e-7) return mid;
      if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
      else { lo = mid; fLo = fMid; }
    }
    return (lo + hi) / 2;
  }
  E.irr = irr;

  /* ---------------------------------------------------------
     Benchmarks — every threshold here traces to a source.
     --------------------------------------------------------- */

  E.BENCH = {
    vacancy: {
      value: 8.3,
      note: 'One lost month per twelve is the realistic floor for residential. Tyson and Griswold call a 0% vacancy factor unrealistic.'
    },
    debtServiceShare: {
      lo: 75, hi: 90,
      note: 'On conventionally financed property, debt service usually runs 75 to 90 percent of NOI in the early years.'
    },
    breakEvenOccupancy: {
      good: 70,
      note: 'Conti and Harris list a break-even occupancy of 70 percent or less as the mark of a good cash-flow deal.'
    },
    dscr: {
      floor: 1.20, strong: 1.30,
      note: 'Most commercial lenders want 1.20 to 1.30 or better.'
    },
    debtYield: {
      floor: 10,
      note: 'Debt yield is the lender view of risk. It ignores rate and amortisation, so it cannot be dressed up by cheap debt.'
    },
    householdsPerJob: 1.5,
    peoplePerDwelling: 3,
    depreciation: { residential: 27.5, commercial: 39 }
  };

  /* ---------------------------------------------------------
     Default deal
     --------------------------------------------------------- */

  E.defaults = function () {
    return {
      meta: {
        name: '',
        address: '',
        propType: 'duplex',
        strategy: 'rental',
        units: 2,
        sqft: 1780,
        yearBuilt: 1978
      },
      buy: {
        price: 158000,
        closingPct: 2.5,
        rehab: 22000,
        otherUpfront: 2500,
        landPct: 20,
        arv: 268000
      },
      loan: {
        downPct: 25,
        ratePct: 7.25,
        termYears: 30,
        ioMonths: 0,
        pointsPct: 1,
        fees: 1200
      },
      inc: {
        rentMonthly: 2600,
        otherMonthly: 45,
        vacPct: 8.3,
        creditPct: 2,
        concPct: 0
      },
      ops: {
        taxes: 3800,
        insurance: 2600,
        utilities: 0,
        hoa: 0,
        groundsPest: 720,
        payroll: 0,
        marketing: 400,
        otherFixed: 0,
        mgmtPct: 8,
        maintPct: 6,
        capexPct: 6,
        capexInNoi: true
      },
      proj: {
        holdYears: 7,
        rentGrowth: 2.5,
        expGrowth: 3.0,
        apprec: 3.0,
        exitCapPct: 9.0,
        sellCostPct: 7.0,
        marketCapPct: 8.75
      },
      tax: {
        marginalPct: 24,
        capGainsPct: 15,
        recapturePct: 25,
        applyTax: true
      },
      flip: {
        holdMonths: 6,
        carryMonthly: 750,
        sellPct: 8,
        ltcPct: 85,
        hardRatePct: 11.5
      },
      market: {
        popGrowth: 3, jobGrowth: 3, jobDiversity: 3, incomeLevel: 3,
        industryMix: 3, priceToRent: 3,
        crime: 3, schools: 3, walkability: 3, transit: 3,
        taxBurden: 3, regulation: 3
      },
      comps: [],
      rentComps: [],
      dd: {},
      box: {
        minCoC: 8,
        minCap: 6.5,
        minDSCR: 1.25,
        maxBreakEven: 80,
        minIRR: 13,
        minDebtYield: 9,
        minFlipProfit: 35000
      }
    };
  };

  /* ---------------------------------------------------------
     Year-one income statement
     --------------------------------------------------------- */

  function incomeStatement(d, opts) {
    opts = opts || {};
    var price = opts.price === undefined ? num(d.buy.price) : opts.price;

    var gpi = num(d.inc.rentMonthly) * 12;
    var other = num(d.inc.otherMonthly) * 12;
    var pgr = gpi + other;

    var vac = gpi * num(d.inc.vacPct) / 100;
    var credit = gpi * num(d.inc.creditPct) / 100;
    var conc = gpi * num(d.inc.concPct) / 100;
    var egi = gpi - vac - credit - conc + other;

    var fixed = num(d.ops.taxes) + num(d.ops.insurance) + num(d.ops.utilities) +
                num(d.ops.hoa) + num(d.ops.groundsPest) + num(d.ops.payroll) +
                num(d.ops.marketing) + num(d.ops.otherFixed);

    var mgmt = egi * num(d.ops.mgmtPct) / 100;
    var maint = gpi * num(d.ops.maintPct) / 100;
    var capex = gpi * num(d.ops.capexPct) / 100;

    var opexNoCapex = fixed + mgmt + maint;
    var opex = opexNoCapex + (d.ops.capexInNoi ? capex : 0);

    return {
      price: price, gpi: gpi, other: other, pgr: pgr,
      vac: vac, credit: credit, conc: conc, egi: egi,
      fixed: fixed, mgmt: mgmt, maint: maint, capex: capex,
      opex: opex, opexNoCapex: opexNoCapex,
      noi: egi - opex,
      noiBroker: egi - opexNoCapex
    };
  }
  E.incomeStatement = incomeStatement;

  /* Capital stack for a given purchase price. */
  function capitalStack(d, price) {
    price = price === undefined ? num(d.buy.price) : price;
    var rehab = num(d.buy.rehab);
    var closing = price * num(d.buy.closingPct) / 100;
    var otherUp = num(d.buy.otherUpfront);

    var down = price * num(d.loan.downPct) / 100;
    var loanAmt = Math.max(0, price - down);
    var points = loanAmt * num(d.loan.pointsPct) / 100;
    var fees = num(d.loan.fees);

    var basis = price + rehab;
    var allIn = price + rehab + closing + otherUp + points + fees;
    var cash = down + rehab + closing + otherUp + points + fees;

    var level = pmt(loanAmt, num(d.loan.ratePct), num(d.loan.termYears));
    var io = num(d.loan.ioMonths) > 0;
    var monthlyIO = loanAmt * num(d.loan.ratePct) / 100 / 12;
    var monthlyPayment = io ? monthlyIO : level;

    return {
      price: price, rehab: rehab, closing: closing, otherUp: otherUp,
      down: down, loan: loanAmt, points: points, fees: fees,
      basis: basis, allIn: allIn, cash: cash,
      monthlyPayment: monthlyPayment,
      levelPayment: level,
      ds: monthlyPayment * 12,
      ltv: safeDiv(loanAmt, price) * 100,
      ltc: safeDiv(loanAmt, price + rehab) * 100
    };
  }
  E.capitalStack = capitalStack;

  /* ---------------------------------------------------------
     Screens / rules of thumb
     --------------------------------------------------------- */

  function screens(d, is, cap) {
    var rows = [];
    var price = cap.price;
    var monthlyRent = num(d.inc.rentMonthly);

    var onePct = safeDiv(monthlyRent, price) * 100;
    rows.push({
      key: 'The 1% rule', value: onePct, unit: 'pct',
      pass: onePct >= 1, target: '1.00% or better',
      note: 'Monthly rent as a share of price. Mashvisor argues for 2% as the cash-flow ideal; 1% is the screen most investors actually use. Neither is a verdict.'
    });

    var opexShare = safeDiv(is.opex, is.gpi) * 100;
    rows.push({
      key: 'The 50% rule', value: opexShare, unit: 'pct',
      pass: opexShare <= 50, target: '50% or less',
      note: 'Operating expenses against gross scheduled rent. If your budget lands far below 50%, you have probably left a line out.'
    });

    var mao = 0.70 * num(d.buy.arv) - num(d.buy.rehab);
    rows.push({
      key: 'The 70% rule (max offer)', value: mao, unit: 'usd',
      pass: price <= mao, target: 'at or above your offer',
      note: 'Seventy percent of after-repair value less the rehab budget. A screening number for resale, not a valuation.'
    });

    var grm = safeDiv(price, is.gpi);
    rows.push({
      key: 'Gross rent multiplier', value: grm, unit: 'x',
      pass: grm > 0 && grm <= 12, target: 'lower is better',
      note: 'Price divided by annual gross rent. A GRM of 8 means eight years of gross rent to repay the price.'
    });

    var gim = safeDiv(price, is.pgr);
    rows.push({
      key: 'Gross income multiplier', value: gim, unit: 'x',
      pass: gim > 0 && gim <= 12, target: 'lower is better',
      note: 'The same idea counting every income line, which is why commercial deals are quoted this way.'
    });

    rows.push({
      key: 'Price per square foot', value: safeDiv(price, num(d.meta.sqft)), unit: 'usd2',
      pass: null, target: 'set by your comps',
      note: 'Commercial comparables lean on price per square foot.'
    });

    rows.push({
      key: 'Price per unit', value: safeDiv(price, num(d.meta.units, 1)), unit: 'usd',
      pass: null, target: 'set by your comps',
      note: 'Price per door. The number apartment brokers actually trade on.'
    });

    return rows;
  }

  /* ---------------------------------------------------------
     Core metrics
     --------------------------------------------------------- */

  function metrics(d, is, cap) {
    var noi = is.noi;
    var ds = cap.ds;
    var cfbt = noi - ds;

    var k = 1 - (num(d.inc.vacPct) + num(d.inc.creditPct) + num(d.inc.concPct)) / 100;
    var m = num(d.ops.mgmtPct) / 100;
    var p = (num(d.ops.maintPct) + (d.ops.capexInNoi ? num(d.ops.capexPct) : 0)) / 100;
    var denom = k * (1 - m) - p;
    var beGpi = denom > 0 ? (ds + is.fixed - is.other * (1 - m)) / denom : NaN;

    return {
      noi: noi, noiBroker: is.noiBroker, ds: ds, cfbt: cfbt,
      cfMonthly: cfbt / 12,
      capOnPrice: safeDiv(noi, cap.price) * 100,
      capOnBasis: safeDiv(noi, cap.allIn) * 100,
      capBroker: safeDiv(is.noiBroker, cap.price) * 100,
      coc: safeDiv(cfbt, cap.cash) * 100,
      dscr: safeDiv(noi, ds),
      debtYield: safeDiv(noi, cap.loan) * 100,
      oer: safeDiv(is.opex, is.egi) * 100,
      dsShare: safeDiv(ds, noi) * 100,
      beOcc: safeDiv(is.opex + ds, is.pgr) * 100,
      beRent: beGpi / 12,
      irvValue: safeDiv(noi, num(d.proj.marketCapPct) / 100),
      irvGap: safeDiv(noi, num(d.proj.marketCapPct) / 100) - cap.price,
      payback: cfbt > 0 ? cap.cash / cfbt : NaN
    };
  }

  /* ---------------------------------------------------------
     Multi-year pro forma, exit, and returns
     --------------------------------------------------------- */

  function proforma(d, is, cap) {
    var hold = clamp(Math.round(num(d.proj.holdYears, 7)), 1, 30);
    var rg = num(d.proj.rentGrowth) / 100;
    var eg = num(d.proj.expGrowth) / 100;

    // Amortise one year past the hold so the exit can be priced off a forward NOI.
    var sched = amortize(cap.loan, num(d.loan.ratePct), num(d.loan.termYears),
                         num(d.loan.ioMonths), hold + 1);

    var isCommercial = ['retail', 'office', 'industrial'].indexOf(d.meta.propType) !== -1;
    var depYears = isCommercial ? E.BENCH.depreciation.commercial : E.BENCH.depreciation.residential;
    var improvable = cap.basis * (1 - num(d.buy.landPct) / 100);
    var annualDep = improvable / depYears;

    var rows = [];
    for (var y = 1; y <= hold + 1; y++) {
      var g = Math.pow(1 + rg, y - 1);
      var e = Math.pow(1 + eg, y - 1);

      var gpi = is.gpi * g;
      var other = is.other * g;
      var vac = gpi * num(d.inc.vacPct) / 100;
      var credit = gpi * num(d.inc.creditPct) / 100;
      var conc = gpi * num(d.inc.concPct) / 100;
      var egi = gpi - vac - credit - conc + other;

      var fixed = is.fixed * e;
      var mgmt = egi * num(d.ops.mgmtPct) / 100;
      var maint = gpi * num(d.ops.maintPct) / 100;
      var capexRes = gpi * num(d.ops.capexPct) / 100;
      var opex = fixed + mgmt + maint + (d.ops.capexInNoi ? capexRes : 0);

      var noi = egi - opex;
      var s = sched[y - 1];
      var cfbt = noi - s.payment;

      var dep = y <= depYears ? annualDep : 0;
      var taxable = noi - s.interest - dep;
      var taxDue = d.tax.applyTax ? taxable * num(d.tax.marginalPct) / 100 : 0;

      rows.push({
        year: y, gpi: gpi, egi: egi, opex: opex, noi: noi,
        interest: s.interest, principal: s.principal, payment: s.payment,
        balance: s.balance, cfbt: cfbt, dep: dep, taxable: taxable,
        tax: taxDue, cfat: cfbt - taxDue
      });
    }

    var exitYear = rows[hold - 1];
    var forwardNoi = rows[hold].noi;
    var exitCap = num(d.proj.exitCapPct) / 100;
    var salePrice = exitCap > 0 ? forwardNoi / exitCap : NaN;
    var apprecValue = cap.allIn * Math.pow(1 + num(d.proj.apprec) / 100, hold);

    var sellCosts = salePrice * num(d.proj.sellCostPct) / 100;
    var payoff = exitYear.balance;
    var netProceeds = salePrice - sellCosts - payoff;

    var totalDep = rows.slice(0, hold).reduce(function (a, r) { return a + r.dep; }, 0);
    var adjBasis = cap.allIn - totalDep;
    var totalGain = salePrice - sellCosts - adjBasis;
    var recapturable = Math.max(0, Math.min(totalDep, totalGain));
    var recapture = recapturable * num(d.tax.recapturePct) / 100;
    var capGain = Math.max(0, totalGain - recapturable);
    var capGainTax = capGain * num(d.tax.capGainsPct) / 100;
    var exitTax = d.tax.applyTax ? recapture + capGainTax : 0;
    var netProceedsAT = netProceeds - exitTax;

    var flowsBT = [-cap.cash];
    var flowsAT = [-cap.cash];
    for (var i = 0; i < hold; i++) {
      var last = (i === hold - 1);
      flowsBT.push(rows[i].cfbt + (last ? netProceeds : 0));
      flowsAT.push(rows[i].cfat + (last ? netProceedsAT : 0));
    }

    var sumCfbt = rows.slice(0, hold).reduce(function (a, r) { return a + r.cfbt; }, 0);
    var sumCfat = rows.slice(0, hold).reduce(function (a, r) { return a + r.cfat; }, 0);

    return {
      hold: hold,
      rows: rows,
      depYears: depYears,
      annualDep: annualDep,
      exit: {
        forwardNoi: forwardNoi,
        salePrice: salePrice,
        apprecValue: apprecValue,
        sellCosts: sellCosts,
        payoff: payoff,
        netProceeds: netProceeds,
        totalDep: totalDep,
        totalGain: totalGain,
        recapture: recapture,
        capGainTax: capGainTax,
        exitTax: exitTax,
        netProceedsAT: netProceedsAT,
        equityAtExit: salePrice - payoff
      },
      returns: {
        sumCfbt: sumCfbt,
        sumCfat: sumCfat,
        totalProfit: sumCfbt + netProceeds - cap.cash,
        totalProfitAT: sumCfat + netProceedsAT - cap.cash,
        equityMultiple: safeDiv(sumCfbt + netProceeds, cap.cash),
        irrBT: irr(flowsBT) * 100,
        irrAT: irr(flowsAT) * 100,
        avgCoC: safeDiv(sumCfbt / hold, cap.cash) * 100
      },
      flowsBT: flowsBT
    };
  }

  /* ---------------------------------------------------------
     Flip / resale path
     --------------------------------------------------------- */

  function flipAnalysis(d) {
    var price = num(d.buy.price);
    var rehab = num(d.buy.rehab);
    var arv = num(d.buy.arv);
    var months = Math.max(0, num(d.flip.holdMonths));

    var cost = price + rehab;
    var loan = cost * num(d.flip.ltcPct) / 100;
    var downCash = Math.max(0, cost - loan);
    var buyClose = price * num(d.buy.closingPct) / 100;
    var points = loan * num(d.loan.pointsPct) / 100;
    var interest = loan * (num(d.flip.hardRatePct) / 100 / 12) * months;
    var carry = num(d.flip.carryMonthly) * months;
    var sellCosts = arv * num(d.flip.sellPct) / 100;
    var otherUp = num(d.buy.otherUpfront);

    var totalCost = price + rehab + buyClose + points + interest + carry + sellCosts + otherUp;
    var profit = arv - totalCost;
    var cashIn = downCash + buyClose + points + interest + carry + otherUp;
    var roi = safeDiv(profit, cashIn) * 100;
    var mao = 0.70 * arv - rehab;

    return {
      loan: loan, downCash: downCash, buyClose: buyClose, points: points,
      interest: interest, carry: carry, sellCosts: sellCosts,
      totalCost: totalCost, profit: profit, cashIn: cashIn,
      roi: roi,
      annualized: months > 0 ? roi * (12 / months) : NaN,
      mao: mao, spread: mao - price,
      margin: safeDiv(profit, arv) * 100
    };
  }

  /* ---------------------------------------------------------
     Stress tests and the sensitivity grid
     --------------------------------------------------------- */

  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  function stress(d, base) {
    var cases = [
      { label: 'Rent lands 10% below plan', mut: function (c) {
          c.inc.rentMonthly = num(c.inc.rentMonthly) * 0.9;
        } },
      { label: 'Vacancy doubles', mut: function (c) {
          c.inc.vacPct = num(c.inc.vacPct) * 2;
        } },
      { label: 'Operating expenses run 20% over', mut: function (c) {
          ['taxes', 'insurance', 'utilities', 'hoa', 'groundsPest', 'payroll', 'marketing', 'otherFixed']
            .forEach(function (key) { c.ops[key] = num(c.ops[key]) * 1.2; });
          c.ops.maintPct = num(c.ops.maintPct) * 1.2;
        } },
      { label: 'County reassesses to 2.6% of price', mut: function (c) {
          c.ops.taxes = num(c.buy.price) * 0.026;
        } },
      { label: 'Insurance renews 40% higher', mut: function (c) {
          c.ops.insurance = num(c.ops.insurance) * 1.4;
        } },
      { label: 'Rate resets 200 bps higher', mut: function (c) {
          c.loan.ratePct = num(c.loan.ratePct) + 2;
        } },
      { label: 'Rehab overruns by half', mut: function (c) {
          c.buy.rehab = num(c.buy.rehab) * 1.5;
        } }
    ];

    return cases.map(function (cse) {
      var c = clone(d);
      cse.mut(c);
      var m = metrics(c, incomeStatement(c), capitalStack(c));
      return {
        label: cse.label,
        cfMonthly: m.cfMonthly,
        coc: m.coc,
        dscr: m.dscr,
        beOcc: m.beOcc,
        dCf: m.cfMonthly - base.cfMonthly,
        dCoc: m.coc - base.coc,
        survives: m.cfbt >= 0 && m.dscr >= 1
      };
    });
  }

  /* IRR surface across exit cap (rows) and rent growth (cols). */
  function sensitivity(d) {
    var baseExit = num(d.proj.exitCapPct);
    var baseGrowth = num(d.proj.rentGrowth);
    var rowVals = [-1, -0.5, 0, 0.5, 1].map(function (s) { return +(baseExit + s).toFixed(2); });
    var colVals = [-1.5, -0.75, 0, 0.75, 1.5].map(function (s) { return +(baseGrowth + s).toFixed(2); });

    var grid = rowVals.map(function (ec) {
      return colVals.map(function (rg) {
        var c = clone(d);
        c.proj.exitCapPct = ec;
        c.proj.rentGrowth = rg;
        return proforma(c, incomeStatement(c), capitalStack(c)).returns.irrBT;
      });
    });

    return {
      rows: rowVals, cols: colVals, grid: grid,
      rowLabel: 'Exit cap rate', colLabel: 'Rent growth',
      baseRow: 2, baseCol: 2
    };
  }

  /* Largest price that still clears a target, found by bisection.
     Every one of these targets falls as price rises. */
  function maxOffer(d, target, value) {
    function score(price) {
      var c = clone(d);
      c.buy.price = price;
      var m = metrics(c, incomeStatement(c), capitalStack(c));
      if (target === 'coc') return m.coc;
      if (target === 'dscr') return m.dscr;
      if (target === 'cap') return m.capOnPrice;
      if (target === 'debtYield') return m.debtYield;
      return NaN;
    }

    var lo = 1000;
    var hi = Math.max(num(d.buy.price) * 3, 100000);
    if (!(score(lo) >= value)) return NaN;
    if (score(hi) >= value) return hi;

    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (score(mid) >= value) lo = mid; else hi = mid;
    }
    return lo;
  }
  E.maxOffer = maxOffer;

  /* ---------------------------------------------------------
     Market scorecard — Tyson ch.10 macro + Mashvisor micro
     --------------------------------------------------------- */

  E.MARKET_FACTORS = [
    { key: 'popGrowth', group: 'macro', label: 'Population growth', weight: 3,
      hint: 'Economists reckon one new dwelling is needed for every three people added.' },
    { key: 'jobGrowth', group: 'macro', label: 'Job growth', weight: 3,
      hint: 'One new household forms for roughly every 1.5 jobs created.' },
    { key: 'jobDiversity', group: 'macro', label: 'Employer diversity', weight: 3,
      hint: 'A market carried by one large employer is a market with one point of failure.' },
    { key: 'incomeLevel', group: 'macro', label: 'Income levels and wage trend', weight: 2,
      hint: 'Growth without income cannot support rent.' },
    { key: 'industryMix', group: 'macro', label: 'Industry mix and recession resistance', weight: 2,
      hint: 'Education, government and healthcare hold up. Single-sector manufacturing does not.' },
    { key: 'priceToRent', group: 'macro', label: 'Price-to-rent ratio', weight: 3,
      hint: 'A low ratio favours the landlord. A high one means you are buying appreciation, not cash flow.' },
    { key: 'crime', group: 'micro', label: 'Safety and crime trend', weight: 3,
      hint: 'Score the direction of travel, not only the level.' },
    { key: 'schools', group: 'micro', label: 'School ratings', weight: 2,
      hint: 'Drives family-tenant demand and the depth of your resale market.' },
    { key: 'walkability', group: 'micro', label: 'Walkability and amenities', weight: 1,
      hint: 'Weighs more for infill and short-term rental than for suburban houses.' },
    { key: 'transit', group: 'micro', label: 'Transit and commute access', weight: 1,
      hint: 'Distance to the employment centre people actually commute to.' },
    { key: 'taxBurden', group: 'micro', label: 'Property tax burden', weight: 3,
      hint: 'Score this low where a sale triggers reassessment. Texas runs about 3% of 80% of the price.' },
    { key: 'regulation', group: 'micro', label: 'Landlord and land-use rules', weight: 2,
      hint: 'Rent control, eviction timelines, short-term-rental bans, zoning that blocks your intended use.' }
  ];

  function marketScore(d) {
    var totalW = 0, got = 0, missing = 0;
    var detail = E.MARKET_FACTORS.map(function (f) {
      var v = d.market[f.key];
      var scored = typeof v === 'number' && v >= 1 && v <= 5;
      if (scored) { totalW += f.weight; got += v * f.weight; }
      else missing++;
      return {
        key: f.key, label: f.label, group: f.group,
        weight: f.weight, hint: f.hint, value: scored ? v : null
      };
    });

    var pct = totalW > 0 ? (got / (totalW * 5)) * 100 : NaN;
    var grade = !isFinite(pct) ? '—'
      : pct >= 80 ? 'Strong'
      : pct >= 60 ? 'Workable'
      : pct >= 45 ? 'Thin'
      : 'Avoid';

    var flags = detail.filter(function (x) {
      return x.weight === 3 && x.value !== null && x.value <= 2;
    }).map(function (x) { return x.label; });

    return { pct: pct, grade: grade, detail: detail, flags: flags, missing: missing };
  }
  E.marketScore = marketScore;

  /* ---------------------------------------------------------
     Comparable sales and rents
     --------------------------------------------------------- */

  function cma(list, subjectSqft, opts) {
    opts = opts || {};
    var excludeDistressed = opts.excludeDistressed !== false;
    var distressed = 0, incomplete = 0, used = [];

    (list || []).forEach(function (c) {
      if (excludeDistressed && c.distressed) { distressed++; return; }
      if (!(num(c.price) > 0 && num(c.sqft) > 0)) { incomplete++; return; }
      used.push(c);
    });

    if (!used.length) {
      return {
        count: 0, distressed: distressed, incomplete: incomplete,
        avgPsf: NaN, indicated: NaN, low: NaN, high: NaN, rows: []
      };
    }

    var rows = used.map(function (c) {
      var adj = num(c.adjust);
      var adjPrice = num(c.price) + adj;
      return {
        addr: c.addr || '—',
        price: num(c.price),
        sqft: num(c.sqft),
        adjust: adj,
        adjPrice: adjPrice,
        psf: adjPrice / num(c.sqft),
        distressed: !!c.distressed
      };
    });

    var psfs = rows.map(function (r) { return r.psf; }).sort(function (a, b) { return a - b; });
    var avgPsf = psfs.reduce(function (a, b) { return a + b; }, 0) / psfs.length;
    var sf = num(subjectSqft);

    return {
      count: rows.length,
      distressed: distressed,
      incomplete: incomplete,
      rows: rows,
      avgPsf: avgPsf,
      low: psfs[0] * sf,
      high: psfs[psfs.length - 1] * sf,
      indicated: avgPsf * sf
    };
  }
  E.cma = cma;

  function rentCma(list, subjectSqft) {
    var used = (list || []).filter(function (c) { return num(c.rent) > 0; });
    if (!used.length) return { count: 0, avgRent: NaN, avgPsf: NaN, indicated: NaN, rows: [] };

    var rows = used.map(function (c) {
      var sf = num(c.sqft);
      return { addr: c.addr || '—', rent: num(c.rent), sqft: sf, psf: sf > 0 ? num(c.rent) / sf : NaN };
    });
    var avgRent = rows.reduce(function (a, r) { return a + r.rent; }, 0) / rows.length;
    var withSf = rows.filter(function (r) { return isFinite(r.psf); });
    var avgPsf = withSf.length
      ? withSf.reduce(function (a, r) { return a + r.psf; }, 0) / withSf.length
      : NaN;
    var sf = num(subjectSqft);

    return {
      count: rows.length, rows: rows, avgRent: avgRent, avgPsf: avgPsf,
      indicated: (isFinite(avgPsf) && sf > 0) ? avgPsf * sf : avgRent
    };
  }
  E.rentCma = rentCma;

  /* ---------------------------------------------------------
     Verdict — scored against the user's own buy box
     --------------------------------------------------------- */

  function verdict(d, m, pf, mkt, flip) {
    var tests = [];
    var box = d.box;
    var isFlip = d.meta.strategy === 'flip';

    function test(label, actual, target, pass, fmt) {
      tests.push({ label: label, actual: actual, target: target, pass: pass, fmt: fmt });
    }

    if (isFlip) {
      test('Net profit', flip.profit, num(box.minFlipProfit), flip.profit >= num(box.minFlipProfit), 'usd');
      test('Offer against the 70% max', flip.spread, 0, flip.spread >= 0, 'usd');
      test('Margin on ARV', flip.margin, 10, flip.margin >= 10, 'pct');
      test('Annualised return on cash', flip.annualized, 25, flip.annualized >= 25, 'pct');
    } else {
      test('Cash-on-cash', m.coc, num(box.minCoC), m.coc >= num(box.minCoC), 'pct');
      test('Cap rate on price', m.capOnPrice, num(box.minCap), m.capOnPrice >= num(box.minCap), 'pct');
      test('Debt service coverage', m.dscr, num(box.minDSCR), m.dscr >= num(box.minDSCR), 'x');
      test('Break-even occupancy', m.beOcc, num(box.maxBreakEven), m.beOcc <= num(box.maxBreakEven), 'pctLow');
      test('Debt yield', m.debtYield, num(box.minDebtYield), m.debtYield >= num(box.minDebtYield), 'pct');
      if (pf) test('IRR over the hold', pf.returns.irrBT, num(box.minIRR), pf.returns.irrBT >= num(box.minIRR), 'pct');
      test('Monthly cash flow', m.cfMonthly, 0, m.cfMonthly > 0, 'usd');
    }

    var scored = tests.filter(function (t) { return isFinite(t.actual); });
    var passed = scored.filter(function (t) { return t.pass; }).length;
    var ratio = scored.length ? passed / scored.length : 0;

    var state;
    if (!scored.length) state = 'idle';
    else if (ratio === 1) state = 'pass';
    else if (ratio >= 0.6) state = 'watch';
    else state = 'fail';

    function say(v, f) {
      if (!isFinite(v)) return '—';
      if (f === 'usd') return '$' + Math.round(v).toLocaleString('en-US');
      if (f === 'x') return v.toFixed(2) + '×';
      return v.toFixed(1) + '%';
    }

    var why = [];
    if (state === 'idle') {
      why.push('Enter a price and a rent to score this deal.');
    } else {
      var fails = scored.filter(function (t) { return !t.pass; });
      if (!fails.length) why.push('Clears every line of your buy box.');
      else fails.forEach(function (t) {
        why.push(t.label + ': ' + say(t.actual, t.fmt) +
                 (t.fmt === 'pctLow' ? ' against a ceiling of ' : ' against ') +
                 say(t.target, t.fmt) + '.');
      });

      if (mkt && mkt.flags.length) {
        why.push('Market flags: ' + mkt.flags.join(', ').toLowerCase() + '.');
      }
      if (!isFlip && isFinite(m.dsShare) && m.dsShare > E.BENCH.debtServiceShare.hi) {
        why.push('Debt service takes ' + m.dsShare.toFixed(0) +
                 '% of NOI, above the 75 to 90 percent band that is normal early in a hold.');
      }
      // A market graded Avoid overrides a clean sheet of numbers.
      if (state === 'pass' && mkt && isFinite(mkt.pct) && mkt.pct < 50) {
        state = 'watch';
        why.push('The numbers work but the market scores below 50. Location is the one input you cannot fix later.');
      }
    }

    return { tests: tests, passed: passed, total: scored.length, ratio: ratio, state: state, why: why };
  }

  /* ---------------------------------------------------------
     Top level
     --------------------------------------------------------- */

  E.analyze = function (d) {
    var is = incomeStatement(d);
    var cap = capitalStack(d);
    var m = metrics(d, is, cap);
    var pf = proforma(d, is, cap);
    var fl = flipAnalysis(d);
    var mkt = marketScore(d);

    return {
      is: is,
      cap: cap,
      metrics: m,
      proforma: pf,
      flip: fl,
      market: mkt,
      screens: screens(d, is, cap),
      stress: stress(d, m),
      sensitivity: sensitivity(d),
      comps: cma(d.comps, num(d.meta.sqft)),
      rentComps: rentCma(d.rentComps, num(d.meta.sqft)),
      verdict: verdict(d, m, pf, mkt, fl)
    };
  };

  root.DealLab = root.DealLab || {};
  root.DealLab.Engine = E;

})(window);
