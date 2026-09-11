# Deal Lab

A real estate deal assessment and profit analysis tool. Underwrite a rental, a
flip, a short-term rental or a commercial property end to end — market, comps,
income, financing, returns, a multi-year projection, stress tests and a due
diligence checklist — and score it against a buy box you set yourself.

Everything runs in the browser. Nothing is uploaded anywhere; saved deals live in
`localStorage` on the machine that entered them.

## Run it

```bash
py -m http.server 8755 --directory C:/Users/JayHu/Sites/deal-lab
```

Registered in `~/.claude/launch.json` as **deal-lab** on port **8755**.

## Layout

```
index.html              the shell: masthead, step rail, panels, readout rail
assets/css/lab.css      the whole stylesheet
assets/js/engine.js     the calculation engine — pure functions, no DOM
assets/js/import.js     listing parser + RentCast lookup — pure functions plus one fetch
assets/js/app.js        the interface — builds panels, binds inputs, draws results
```

`engine.js` has no dependency on the page. It exposes `window.DealLab.Engine`
with `defaults()`, `analyze(deal)`, `maxOffer(deal, target, value)`, `pmt`,
`amortize`, `irr`, `npv`, `cma`, `rentCma` and `marketScore`. That separation is
deliberate: the maths can be tested in Node without a browser, which is how it
was verified. `import.js` is the same: the parser is pure, and the one network
call is stubbed in its test, so the suite runs offline and spends no quota.

### Testing

```bash
node test-engine.js
node test-import.js
```

Between them the two harnesses stub `window` and assert about a hundred things
— including the worked examples out of the source books (an NOI of $180,000 at an
8% cap valuing at $2,250,000; break-even occupancy of 55% and 70% from the two
published examples), an independently known amortisation schedule, IRR against a
hand-checked case, round trips such as "feed the calculated break-even rent back in
and cash flow must come out zero", and the listing parser against Zillow-,
Redfin- and Realtor-shaped pages.

## Getting a property in

Two routes, both on the **Import a listing** panel.

**Paste a listing.** Open the listing, select the whole page, copy, paste. The
parser pulls price, address, beds, baths, square footage, year built, property
type, property taxes, HOA dues, and the site's own value and rent estimates. It
knows a monthly figure from an annual one and normalises both. Tested against
Zillow-, Redfin- and Realtor-shaped pages. A bare link works too, but a URL only
carries the address — that really is all that is in it.

**Look up an address.** Needs a free [RentCast](https://app.rentcast.io/app/api)
key (50 requests a month), pasted into the panel and kept in `localStorage` on
that machine only. Returns the property record, a value estimate and a rent
estimate, and fills the comparables tables from the comps that come back. Each
ticked box is one request; a request that fails does not count against the month.

Nothing is applied until you press **Apply to the sheet**. The table shows the
current value, the new value, and where each figure came from, with every row
marked `found` or `estimated` — anything filled from a rate rather than read off
the listing says so.

### Why the link alone cannot do it

The page would have to fetch the listing itself and the listing sites do not
permit that. Verified from the deployed page: Zillow and Redfin refuse the
cross-origin request outright, and Realtor.com answers automated callers with
429. Working around that would mean disguising the request, so the tool does not.
Copying the page works because your browser has already been served it, and the
address lookup works because RentCast licenses the data and publishes an API.

## What it calculates

**Year one** — gross scheduled rent, vacancy, credit loss, concessions, other
income, effective gross income, operating expenses, NOI, debt service and cash
flow, drawn as a waterfall. Then cap rate on price and on the all-in basis,
cash-on-cash, DSCR, debt yield, operating expense ratio, break-even occupancy,
break-even rent, payback, and the submarket value implied by IRV.

**Screens** — the 1% rule, the 50% rule, the 70% rule and maximum allowable
offer, gross rent and gross income multipliers, price per square foot and per
door.

**Solved backwards** — the most you can pay and still clear each buy-box
threshold, and which threshold binds first.

**The hold** — a year-by-year pro forma with rent and expenses growing at
separate rates, monthly amortisation rolled up annually, straight-line
depreciation over 27.5 or 39 years, after-tax cash flow, an exit priced off
forward NOI, depreciation recapture and capital gains, IRR before and after tax,
and the equity multiple.

**What breaks it** — seven single-variable stress tests, each re-running the
whole sheet, plus a 5×5 IRR surface across exit cap rate and rent growth.

**Market** — twelve weighted factors, macro and micro, producing a score out of
100. A market under 50 downgrades an otherwise passing deal, because location is
the one input that cannot be renovated.

**Comps** — sold comparables adjusted and reduced to price per square foot, with
distressed sales excluded by default; rent comparables the same way. Either can
be pushed into the deal with one button.

**Diligence** — thirty items across physical, financial and legal, plus a red-flag
list drawn from the recorded reasons properties fail.

## Where the formulas come from

- Conti & Harris, *Commercial Real Estate Investing For Dummies* — cap rate, NOI,
  cash-on-cash, break-even occupancy, the three valuation approaches, the due
  diligence checklists, why properties fail.
- Tyson & Griswold, *Real Estate Investing For Dummies* — GRM and GIM, the IRV
  relationship, zero-based pro forma discipline, the 8.3% vacancy floor,
  27.5/39-year cost recovery, the 45/180-day exchange clock, the location and
  job-growth criteria behind the market scorecard.
- Mashvisor, *How to Analyze Real Estate Deals in 5 Steps* — the five-step order
  the assessment panels follow, the 1%/2% screen, and the comparative market
  analysis.

Every threshold in `E.BENCH` carries a note naming its source.

## Notes on the defaults

The starting figures are a $158,000 two-unit value-add: 9.4% cap on price, 1.5×
coverage, about $440 a month in cash flow, and a 9.1% seven-year IRR. It opens as
**Watch it** rather than a clean pass, on purpose — a demo deal that rubber-stamps
itself teaches the wrong reflex. The same property read as a flip clears the buy
box, which is the point of being able to switch strategies on one set of inputs.

## Caveats worth keeping

- After-tax figures assume paper losses are usable in the year they arise. Passive
  activity rules often defer that. Treat after-tax cash flow as a ceiling.
- The capital reserve toggle is on by default. Turning it off is what a marketing
  pro forma does, and the tool shows you exactly how many points of cap rate that
  one line is worth.
- This is an estimating tool, not advice. Verify taxes with the county, insurance
  with a carrier, rent with real comps, and rehab with a contractor who has
  walked the property.
