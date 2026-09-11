/* Node harness for the Deal Lab listing importer. */
global.window = global;
require('./assets/js/engine.js');
require('./assets/js/import.js');
const I = window.DealLab.Import;
const E = window.DealLab.Engine;

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log('  FAIL ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
  else console.log('  ok   ' + name + (extra !== undefined ? '  ' + extra : ''));
}

console.log('--- URL slugs ---');
const urls = {
  zillow: 'https://www.zillow.com/homedetails/4218-Cedar-Post-Ln-Houston-TX-77053/28024441_zpid/',
  redfin: 'https://www.redfin.com/TX/Houston/4218-Cedar-Post-Ln-77053/home/32004411',
  realtor: 'https://www.realtor.com/realestateandhomes-detail/4218-Cedar-Post-Ln_Houston_TX_77053_M70123-45678',
  har: 'https://www.har.com/homedetail/4218-cedar-post-ln-houston-tx-77053/1234567',
  trulia: 'https://www.trulia.com/p/tx/houston/4218-cedar-post-ln-houston-tx-77053--2081234567'
};
for (const [site, u] of Object.entries(urls)) {
  const r = I.parseUrl(u);
  const good = r && /cedar post/i.test(r.address || '') && r.zip === '77053' && r.state === 'TX';
  ok(site + ' slug', good, r ? (r.site + ' | ' + r.full) : 'null');
}
ok('non-url returns null', I.parseUrl('not a url') === null);
ok('non-http rejected', I.parseUrl('javascript:alert(1)') === null);
ok('unknown host still parses', (() => {
  const r = I.parseUrl('https://example.com/listing/4218-Cedar-Post-Ln-Houston-TX-77053');
  return r && r.zip === '77053';
})());

console.log('\n--- Zillow-shaped paste ---');
const zillow = `
Skip main navigation
$315,000
4218 Cedar Post Ln, Houston, TX 77053
3 bds 2 ba 1,780 sqft
Single Family Residence, Built in 1978
Est. payment: $2,104/mo
Zestimate®: $321,400
Rent Zestimate®: $2,395/mo
Get pre-qualified
Home value
Property taxes $487/mo
Home insurance $154/mo
HOA fees $35/mo
Days on Zillow: 21 days
Lot size: 7,405 sqft
`;
{
  const { fields: f, evidence: ev } = I.parseText(zillow);
  console.log('  fields:', JSON.stringify(f));
  ok('price', f.price === 315000, f.price);
  ok('sqft', f.sqft === 1780, f.sqft);
  ok('beds', f.beds === 3, f.beds);
  ok('baths', f.baths === 2, f.baths);
  ok('year built', f.yearBuilt === 1978, f.yearBuilt);
  ok('estimate (Zestimate)', f.estimate === 321400, f.estimate);
  ok('rent', f.rent === 2395, f.rent);
  ok('taxes annualised from /mo', f.taxes === 487 * 12, f.taxes + ' (' + ev.taxes + ')');
  ok('hoa annualised from /mo', f.hoa === 35 * 12, f.hoa);
  ok('property type', f.propType === 'sfr', f.propType);
  ok('address', /4218 Cedar Post Ln, Houston, TX 77053/.test(f.address || ''), f.address);
  ok('monthly payment not taken as price', f.price !== 2104);
}

console.log('\n--- Redfin-shaped paste ---');
const redfin = `
$289,900
4218 Cedar Post Ln, Houston, TX 77053
3 Beds
2 Baths
1,640 Sq Ft
About this home
Built in 1965. Duplex.
Redfin Estimate $294,112
Property Taxes $5,904 annually
HOA Dues $0
Est. Monthly Payment $1,940
`;
{
  const { fields: f } = I.parseText(redfin);
  console.log('  fields:', JSON.stringify(f));
  ok('price', f.price === 289900, f.price);
  ok('sqft', f.sqft === 1640, f.sqft);
  ok('estimate', f.estimate === 294112, f.estimate);
  ok('annual taxes kept annual', f.taxes === 5904, f.taxes);
  ok('duplex type + units', f.propType === 'duplex' && f.units === 2, f.propType + '/' + f.units);
  ok('year built', f.yearBuilt === 1965, f.yearBuilt);
}

console.log('\n--- Realtor-shaped paste, price label present ---');
const realtor = `
For sale
List Price $412,500
2119 Bayou Oaks Dr, Pearland, TX 77584
4 bed 3 bath 2,410 sqft
Property type Single family
Year built 2004
Annual tax amount $9,812
HOA fee $650 per year
`;
{
  const { fields: f } = I.parseText(realtor);
  console.log('  fields:', JSON.stringify(f));
  ok('labelled price wins', f.price === 412500, f.price);
  ok('sqft', f.sqft === 2410, f.sqft);
  ok('annual tax amount', f.taxes === 9812, f.taxes);
  ok('annual HOA not multiplied', f.hoa === 650, f.hoa);
  ok('year built', f.yearBuilt === 2004, f.yearBuilt);
}

console.log('\n--- multifamily paste ---');
{
  const { fields: f } = I.parseText('$745,000  Fourplex  4 units  3,900 sq ft  Built in 1985');
  ok('fourplex -> multifamily, 4 units', f.propType === 'multifamily' && f.units === 4, f.propType + '/' + f.units);
}

console.log('\n--- parse() entry point ---');
{
  const bare = I.parse(urls.zillow);
  ok('bare url: address filled', /Cedar Post/i.test(bare.fields.address || ''), bare.fields.address);
  ok('bare url: no invented price', bare.fields.price === undefined);
  ok('bare url: source flagged', bare.source && bare.source.bareUrl === true && bare.source.site === 'Zillow');

  const both = I.parse(urls.redfin + '\n' + zillow);
  ok('url + text: price from text', both.fields.price === 315000, both.fields.price);
  ok('url + text: address from text wins', /Cedar Post Ln, Houston/.test(both.fields.address), both.fields.address);
  ok('url + text: source recorded', both.source && both.source.site === 'Redfin');

  const empty = I.parse('');
  ok('empty input safe', Object.keys(empty.fields).length === 0);
  ok('garbage input safe', Object.keys(I.parse('hello there').fields).length === 0);
}

console.log('\n--- derive() fills only gaps ---');
{
  const f = { price: 300000 };
  const d = I.derive(f, { taxRate: 2.2, insRate: 0.8, rentRule: 0.9 });
  ok('taxes derived', d.taxes === 6600, d.taxes);
  ok('insurance derived', d.insurance === 2400, d.insurance);
  ok('rent derived', d.rent === 2700, d.rent);

  const d2 = I.derive({ price: 300000, taxes: 5000 }, { taxRate: 2.2 });
  ok('found taxes not overwritten', d2.taxes === undefined);

  const d3 = I.derive({}, { taxRate: 2.2 });
  ok('no price, no derivation', Object.keys(d3).length === 0);
}

console.log('\n--- plan() against a real deal ---');
{
  const deal = E.defaults();
  const p = I.parse(zillow);
  const derived = I.derive(p.fields, { taxRate: 2.2, insRate: 0.8, rentRule: 0 });
  const rows = I.plan(deal, p.fields, derived, p.evidence);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  ok('every mapped field has a row', rows.length === I.MAP.length, rows.length);
  ok('price row found', byKey.price.status === 'found' && byKey.price.to === 315000);
  ok('insurance row estimated', byKey.insurance.status === 'estimated', byKey.insurance.to);
  ok('taxes found not estimated', byKey.taxes.status === 'found', byKey.taxes.to);
  ok('rows carry the previous value', byKey.price.from === deal.buy.price, byKey.price.from);
  rows.filter(r => r.status !== 'missing').forEach(r => {
    console.log('    ' + r.status.padEnd(10) + r.label.padEnd(24) + String(r.from).padEnd(10) + ' -> ' + r.to);
  });

  // applying the plan must produce a deal the engine can analyse
  rows.filter(r => r.status !== 'missing').forEach(r => {
    const parts = r.path.split('.'); const last = parts.pop();
    parts.reduce((o, k) => o[k], deal)[last] = r.to;
  });
  const res = E.analyze(deal);
  ok('engine analyses the imported deal', isFinite(res.metrics.capOnPrice), 'cap ' + res.metrics.capOnPrice.toFixed(2) + '%');
  ok('verdict produced', ['pass','watch','fail','idle'].includes(res.verdict.state), res.verdict.state);
  console.log('    imported deal: cap ' + res.metrics.capOnPrice.toFixed(2) + '%  CoC ' +
              res.metrics.coc.toFixed(2) + '%  DSCR ' + res.metrics.dscr.toFixed(2) +
              '  CF ' + Math.round(res.metrics.cfMonthly) + '/mo  -> ' + res.verdict.state);
}

/* ---------------------------------------------------------
   lookup() — network stubbed, so this runs offline and free
   --------------------------------------------------------- */

function stubFetch(map) {
  global.fetch = async (url) => {
    for (const [fragment, resp] of Object.entries(map)) {
      if (url.includes(fragment)) {
        return { ok: resp.ok, status: resp.status, text: async () => JSON.stringify(resp.body) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"message":"not found"}' };
  };
}

const REJECT = { ok: false, status: 401, body: { message: 'The provided API key is not valid.' } };

(async () => {
  console.log('\n--- lookup() guards ---');
  const caught = [];
  await Promise.all([
    I.lookup('', 'key').catch(e => caught.push(e.message)),
    I.lookup('1 Main St', '').catch(e => caught.push(e.message)),
    I.lookup('1 Main St', 'key', {}).catch(e => caught.push(e.message))
  ]);
  ok('empty address rejected', caught.some(m => /address/i.test(m)));
  ok('missing key rejected', caught.some(m => /key/i.test(m)));
  ok('no endpoints selected rejected', caught.some(m => /at least one/i.test(m)));

  console.log('\n--- lookup() with a rejected key ---');
  stubFetch({ '/properties': REJECT, '/avm/value': REJECT, '/avm/rent': REJECT });
  let r = await I.lookup('4218 Cedar Post Ln, Houston, TX', 'bad-key');
  ok('failed calls do not spend quota', r.calls === 0, 'calls=' + r.calls + ' attempted=' + r.attempted);
  ok('all three errors surfaced', r.errors.length === 3);
  ok('nothing invented', Object.keys(r.fields).length === 0);

  console.log('\n--- lookup() with a full response ---');
  stubFetch({
    '/properties': { ok: true, status: 200, body: [{
      formattedAddress: '4218 Cedar Post Ln, Houston, TX 77053',
      propertyType: 'Multi-Family', bedrooms: 4, bathrooms: 2,
      squareFootage: 2100, yearBuilt: 1972,
      lastSalePrice: 180000, lastSaleDate: '2019-06-14T00:00:00.000Z',
      hoa: { fee: 45 },
      propertyTaxes: { '2022': { year: 2022, total: 5100 }, '2024': { year: 2024, total: 6240 } }
    }] },
    '/avm/value': { ok: true, status: 200, body: {
      price: 312000, priceRangeLow: 295000, priceRangeHigh: 330000,
      comparables: [
        { formattedAddress: 'A St', price: 305000, squareFootage: 2000 },
        { formattedAddress: 'B St', price: 320000, squareFootage: 2200 },
        { formattedAddress: 'C St', price: 0, squareFootage: 1900 }
      ] } },
    '/avm/rent': { ok: true, status: 200, body: {
      rent: 2480, rentRangeLow: 2300, rentRangeHigh: 2650,
      comparables: [{ formattedAddress: 'D St', price: 2400, squareFootage: 2050 }] } }
  });
  r = await I.lookup('4218 Cedar Post Ln, Houston, TX', 'good-key');
  console.log('  fields:', JSON.stringify(r.fields));
  ok('three calls counted', r.calls === 3, r.calls);
  ok('address', /Cedar Post/.test(r.fields.address));
  ok('sqft', r.fields.sqft === 2100);
  ok('year built', r.fields.yearBuilt === 1972);
  ok('Multi-Family mapped to multifamily', r.fields.propType === 'multifamily', r.fields.propType);
  ok('latest tax year wins', r.fields.taxes === 6240, r.fields.taxes);
  ok('HOA monthly fee annualised', r.fields.hoa === 540, r.fields.hoa);
  ok('price from the value model', r.fields.price === 312000);
  ok('rent from the rent model', r.fields.rent === 2480);
  ok('sale comps kept, zero-price dropped', r.comps.length === 2, r.comps.length);
  ok('rent comps kept', r.rentComps.length === 1 && r.rentComps[0].rent === 2400);
  ok('evidence names the source', /RentCast/.test(r.evidence.price) && /2024/.test(r.evidence.taxes), r.evidence.taxes);

  // the comps that come back must be shaped for the engine's CMA
  const cma = E.cma(r.comps, 2100);
  ok('returned comps feed the CMA', cma.count === 2 && isFinite(cma.indicated),
     'indicated ' + Math.round(cma.indicated));

  console.log('\n--- lookup() with one endpoint failing ---');
  stubFetch({
    '/properties': { ok: true, status: 200, body: [{ formattedAddress: 'X', squareFootage: 1500 }] },
    '/avm/value': { ok: false, status: 429, body: { message: 'rate limited' } },
    '/avm/rent': { ok: true, status: 200, body: { rent: 1900 } }
  });
  r = await I.lookup('X', 'k');
  ok('only the successes count', r.calls === 2, r.calls);
  ok('partial fields kept', r.fields.sqft === 1500 && r.fields.rent === 1900);
  ok('the failure is reported', r.errors.length === 1 && /rate limited/.test(r.errors[0]));

  console.log('\n--- lookup() with no record for the address ---');
  stubFetch({ '/properties': { ok: true, status: 200, body: [] } });
  r = await I.lookup('nowhere', 'k', { record: true });
  ok('empty result explained', /no property found/.test(r.errors[0] || ''), r.errors[0]);

  console.log('\n' + (fails === 0 ? 'ALL PASS' : fails + ' FAILURES'));
  process.exit(fails === 0 ? 0 : 1);
})();
