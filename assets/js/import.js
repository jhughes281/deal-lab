/* =============================================================
   Deal Lab — listing import

   Two routes into the sheet:

     1. parse()  — reads a listing you have pasted, or a listing URL.
                   Works with no key and no network. A listing page your
                   browser already loaded is yours to copy; this only
                   reads text you hand it.

     2. lookup() — queries RentCast with a key you supply, which returns
                   a property record, a value estimate and a rent estimate
                   for an address. RentCast permits browser requests, so
                   this runs from the page with no server in between.

   Fetching a Zillow or Redfin URL directly is not one of the routes:
   both refuse cross-origin requests outright, and Realtor.com answers
   automated callers with 429. That is their call to make, so the paste
   route exists instead.

   Pure functions plus one fetch. Exposed as window.DealLab.Import.
   ============================================================= */
(function (root) {
  'use strict';

  var I = {};

  function toNumber(s) {
    var n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : 0;
  }

  function titleCase(s) {
    return String(s).replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  /* ---------------------------------------------------------
     URL parsing — the address is in the slug on every major site
     --------------------------------------------------------- */

  var SITES = [
    { name: 'Zillow', host: /zillow\.com/i },
    { name: 'Redfin', host: /redfin\.com/i },
    { name: 'Realtor.com', host: /realtor\.com/i },
    { name: 'HAR', host: /har\.com/i },
    { name: 'Homes.com', host: /homes\.com/i },
    { name: 'Trulia', host: /trulia\.com/i },
    { name: 'Movoto', host: /movoto\.com/i }
  ];

  /* Street types, so "4218-Cedar-Post-Ln-San-Antonio-TX-78209" splits at "Ln"
     rather than guessing that the city is one word (it often is not). */
  var STREET_TYPE = new RegExp('^(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|' +
    'boulevard|ct|court|cir|circle|way|pl|place|ter|terrace|trl|trail|pkwy|parkway|hwy|' +
    'highway|loop|run|path|pass|pt|point|ridge|rdg|xing|crossing|bend|bnd|cv|cove|crk|' +
    'creek|walk|row|sq|square|plaza|expy|fwy|tpke|aly|alley|gln|glen|grn|green|hts|' +
    'heights|hl|hls|hill|hills|jct|knl|lk|lake|mdw|meadow|mnr|manor|ml|mill|mt|orch|' +
    'pne|pines|rnch|ranch|shr|shore|spg|springs|sta|vw|view|vlg|village|vly|valley|wls|' +
    'wells|is|island|bay|bch|beach|cyn|canyon|fls|falls|frst|forest|gdn|garden|hbr|' +
    'harbor|hvn|haven|lndg|landing|mdws|meadows|pkw|prk|park|rst|rest|trce|trace|' +
    'vis|vista|wood|woods)$', 'i');

  /* Split "4218-cedar-post-ln-houston-tx-77053" (with any trailing listing id)
     into street / city / state / zip. Returns null when it does not fit. */
  function splitSlug(seg) {
    var cleaned = String(seg)
      .replace(/--\d+$/, '')          // Trulia's trailing property id
      .replace(/_[a-z]*zpid$/i, '');  // Zillow, when the id shares the segment

    var tokens = cleaned.split('-').filter(Boolean);
    if (tokens.length < 4) return null;

    var zip = tokens[tokens.length - 1];
    var state = tokens[tokens.length - 2];
    if (!/^\d{5}$/.test(zip) || !/^[A-Za-z]{2}$/.test(state)) return null;

    var rest = tokens.slice(0, -2);
    if (!/\d/.test(rest[0])) return null;   // a street address starts with a number

    var cut = -1;
    for (var i = rest.length - 2; i >= 1; i--) {
      if (STREET_TYPE.test(rest[i])) { cut = i; break; }
    }
    if (cut === -1) cut = rest.length - 2;  // no street type: assume a one-word city

    return {
      street: titleCase(rest.slice(0, cut + 1).join(' ')),
      city: titleCase(rest.slice(cut + 1).join(' ')),
      state: state.toUpperCase(),
      zip: zip
    };
  }

  I.parseUrl = function (url) {
    var out = { site: null, address: '', city: '', state: '', zip: '', url: url };
    var u;
    try { u = new URL(String(url).trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;

    SITES.forEach(function (s) { if (s.host.test(u.hostname)) out.site = s.name; });
    if (!out.site) out.site = u.hostname.replace(/^www\./, '');

    var path = decodeURIComponent(u.pathname);

    /* Realtor.com: /realestateandhomes-detail/1234-Main-St_Houston_TX_77002_M00-00 */
    var m = path.match(/realestateandhomes-detail\/([^/]+)/i);
    if (m) {
      var parts = m[1].split('_');
      if (parts.length >= 4) {
        out.address = parts[0].replace(/-/g, ' ');
        out.city = parts[1].replace(/-/g, ' ');
        out.state = parts[2];
        out.zip = (parts[3].match(/\d{5}/) || [''])[0];
      }
    }

    /* Redfin: /TX/Houston/1234-Main-St-77002/home/12345678 */
    if (!out.address) {
      m = path.match(/^\/([A-Z]{2})\/([^/]+)\/([^/]+?)-(\d{5})\/home\//);
      if (m) {
        out.state = m[1];
        out.city = m[2].replace(/-/g, ' ');
        out.address = m[3].replace(/-/g, ' ');
        out.zip = m[4];
      }
    }

    /* Zillow / HAR / Trulia and friends: a slug ending ...-City-ST-ZIP */
    if (!out.address) {
      var segs = path.split('/').filter(Boolean);
      for (var i = segs.length - 1; i >= 0; i--) {
        var split = splitSlug(segs[i]);
        if (split) {
          out.address = split.street;
          out.city = split.city;
          out.state = split.state;
          out.zip = split.zip;
          break;
        }
      }
    }

    if (!out.address) return out.site ? out : null;

    out.address = titleCase(out.address);
    out.city = titleCase(out.city);
    out.state = out.state.toUpperCase();
    out.full = [out.address, out.city, (out.state + ' ' + out.zip).trim()]
      .filter(Boolean).join(', ');
    return out;
  };

  /* ---------------------------------------------------------
     Text parsing — what you get from selecting a listing page
     --------------------------------------------------------- */

  var MONTHLY = /(\/\s*mo|per month|monthly|a month|\/month)/i;

  /* Find "<keyword> ... $value", then fall back to "$value ... <keyword>". */
  function grabMoney(text, keywords) {
    var i, m, re;

    for (i = 0; i < keywords.length; i++) {
      re = new RegExp(keywords[i] + '[^$\\d\\n]{0,40}\\$\\s?([\\d,]+(?:\\.\\d+)?)([^\\n]{0,20})', 'i');
      m = text.match(re);
      if (m && toNumber(m[1]) > 0) {
        return { value: toNumber(m[1]), monthly: MONTHLY.test(m[2] || ''), raw: m[0].replace(/\s+/g, ' ').trim().slice(0, 70) };
      }
    }

    for (i = 0; i < keywords.length; i++) {
      re = new RegExp('\\$\\s?([\\d,]+(?:\\.\\d+)?)([^\\n]{0,20}?)[^\\n$]{0,30}' + keywords[i], 'i');
      m = text.match(re);
      if (m && toNumber(m[1]) > 0) {
        return { value: toNumber(m[1]), monthly: MONTHLY.test(m[2] || ''), raw: m[0].replace(/\s+/g, ' ').trim().slice(0, 70) };
      }
    }

    return null;
  }

  function annualise(hit) {
    if (!hit) return null;
    return { value: hit.monthly ? hit.value * 12 : hit.value, monthly: hit.monthly, raw: hit.raw };
  }

  var TYPE_MAP = [
    [/\bfourplex|quadplex|4[\s-]?plex\b/i, 'multifamily', 4],
    [/\btriplex|3[\s-]?plex\b/i, 'multifamily', 3],
    [/\bduplex|2[\s-]?plex\b/i, 'duplex', 2],
    [/\bmulti[\s-]?family\b/i, 'multifamily', 0],
    [/\bapartment\b/i, 'multifamily', 0],
    [/\bretail|shopping cent(?:er|re)\b/i, 'retail', 1],
    [/\boffice\b/i, 'office', 1],
    [/\bindustrial|warehouse\b/i, 'industrial', 1],
    [/\b(?:vacant )?land|lot for sale\b/i, 'land', 0],
    [/\bcondo|condominium|townhouse|townhome\b/i, 'sfr', 1],
    [/\bsingle[\s-]?family\b/i, 'sfr', 1]
  ];

  I.parseText = function (text) {
    text = String(text || '');
    var f = {};
    var evidence = {};

    function note(key, value, raw) {
      if (value === null || value === undefined || value === '' || value === 0) return;
      f[key] = value;
      evidence[key] = raw;
    }

    /* --- price ---
       Prefer a labelled price. Otherwise take the first large standalone
       dollar figure that is not a monthly number, which is how every one of
       these pages leads. */
    var price = grabMoney(text, ['list(?:ing)? price', 'sale price', 'asking price', 'price']);
    if (!price || price.monthly) {
      var re = /\$\s?([\d,]{5,12})(?:\.\d+)?([^\n]{0,14})/g, m;
      while ((m = re.exec(text)) !== null) {
        var v = toNumber(m[1]);
        if (v >= 10000 && !MONTHLY.test(m[2] || '')) {
          price = { value: v, monthly: false, raw: m[0].replace(/\s+/g, ' ').trim().slice(0, 40) };
          break;
        }
      }
    }
    if (price && !price.monthly) note('price', price.value, price.raw);

    /* --- rent --- */
    var rent = grabMoney(text, [
      'rent zestimate', 'est(?:imated)?\\.? rent', 'rental estimate',
      'rent estimate', 'monthly rent', 'rent'
    ]);
    if (rent) {
      /* Rent is stored monthly. A figure this large that is not flagged per
         month is almost certainly an annual number. */
      var rentValue = (!rent.monthly && rent.value > 20000)
        ? Math.round(rent.value / 12) : rent.value;
      note('rent', rentValue, rent.raw + (rentValue !== rent.value ? '  (annual ÷ 12)' : ''));
    }

    /* --- value estimate (ARV / stabilised) --- */
    var est = grabMoney(text, ['zestimate', 'redfin estimate', 'home value', 'estimated value']);
    if (est && !est.monthly && est.value >= 10000) note('estimate', est.value, est.raw);

    /* --- taxes and HOA, normalised to annual --- */
    var tax = annualise(grabMoney(text, [
      'annual tax amount', 'tax annual amount', 'property tax(?:es)?', 'taxes'
    ]));
    if (tax) note('taxes', tax.value, tax.raw + (tax.monthly ? '  (monthly × 12)' : ''));

    var hoa = annualise(grabMoney(text, ['hoa (?:fee|dues)', 'association fee', 'hoa']));
    if (hoa) note('hoa', hoa.value, hoa.raw + (hoa.monthly ? '  (monthly × 12)' : ''));

    /* --- size, beds, baths, year --- */
    var m2 = text.match(/([\d,]{3,7})\s*(?:sq\.?\s?ft|sqft|square\s?f(?:ee)?t)\b/i);
    if (m2) note('sqft', toNumber(m2[1]), m2[0].trim());

    m2 = text.match(/(\d+(?:\.\d)?)\s*(?:bds?|beds?|bedrooms?)\b/i);
    if (m2) note('beds', parseFloat(m2[1]), m2[0].trim());

    m2 = text.match(/(\d+(?:\.\d)?)\s*(?:ba\b|baths?|bathrooms?)\b/i);
    if (m2) note('baths', parseFloat(m2[1]), m2[0].trim());

    m2 = text.match(/(?:year built|built in|yr\.? built)\D{0,20}((?:1[6-9]|20)\d{2})/i);
    if (m2) note('yearBuilt', parseInt(m2[1], 10), m2[0].replace(/\s+/g, ' ').trim());

    /* --- property type --- */
    for (var i = 0; i < TYPE_MAP.length; i++) {
      var hit = text.match(TYPE_MAP[i][0]);
      if (hit) {
        note('propType', TYPE_MAP[i][1], hit[0]);
        if (TYPE_MAP[i][2]) note('units', TYPE_MAP[i][2], hit[0]);
        break;
      }
    }

    /* --- address --- */
    m2 = text.match(/(\d+[\w .'#-]{2,40}),\s*([A-Za-z .'-]{2,30}),\s*([A-Z]{2})\s*(\d{5})/);
    if (m2) note('address', m2[0].replace(/\s+/g, ' ').trim(), m2[0].trim());

    return { fields: f, evidence: evidence };
  };

  /* ---------------------------------------------------------
     One entry point: hand it a URL, a pasted page, or both
     --------------------------------------------------------- */

  I.parse = function (input) {
    var text = String(input || '').trim();
    if (!text) return { fields: {}, evidence: {}, source: null };

    var urlMatch = text.match(/https?:\/\/[^\s"'<>)]+/);
    var fromUrl = urlMatch ? I.parseUrl(urlMatch[0]) : null;

    /* A bare URL and nothing else: the slug is all there is. */
    var bareUrl = urlMatch && urlMatch[0].length >= text.length - 2;

    var parsed = bareUrl ? { fields: {}, evidence: {} } : I.parseText(text);

    if (fromUrl) {
      if (fromUrl.full && !parsed.fields.address) {
        parsed.fields.address = fromUrl.full;
        parsed.evidence.address = 'from the link';
      }
      parsed.source = { site: fromUrl.site, url: fromUrl.url, bareUrl: !!bareUrl };
    } else {
      parsed.source = null;
    }

    return parsed;
  };

  /* ---------------------------------------------------------
     Fill the gaps the listing did not cover
     --------------------------------------------------------- */

  I.derive = function (fields, rates) {
    rates = rates || {};
    var added = {};
    var price = fields.price || fields.estimate;

    if (!fields.taxes && price && rates.taxRate > 0) {
      added.taxes = Math.round(price * rates.taxRate / 100);
    }
    if (!fields.insurance && price && rates.insRate > 0) {
      added.insurance = Math.round(price * rates.insRate / 100);
    }
    if (!fields.rent && price && rates.rentRule > 0) {
      added.rent = Math.round(price * rates.rentRule / 100);
    }
    return added;
  };

  /* ---------------------------------------------------------
     Turn parsed fields into a list of changes against a deal
     --------------------------------------------------------- */

  var MAP = [
    { key: 'address',   path: 'meta.address',     label: 'Address' },
    { key: 'propType',  path: 'meta.propType',    label: 'Property type' },
    { key: 'units',     path: 'meta.units',       label: 'Units' },
    { key: 'sqft',      path: 'meta.sqft',        label: 'Building sq ft' },
    { key: 'yearBuilt', path: 'meta.yearBuilt',   label: 'Year built' },
    { key: 'price',     path: 'buy.price',        label: 'Purchase price' },
    { key: 'estimate',  path: 'buy.arv',          label: 'Value when stabilised' },
    { key: 'rent',      path: 'inc.rentMonthly',  label: 'Gross monthly rent' },
    { key: 'taxes',     path: 'ops.taxes',        label: 'Property taxes' },
    { key: 'insurance', path: 'ops.insurance',    label: 'Insurance' },
    { key: 'hoa',       path: 'ops.hoa',          label: 'HOA dues' }
  ];

  I.MAP = MAP;

  function readPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  I.plan = function (deal, fields, derived, evidence) {
    derived = derived || {};
    evidence = evidence || {};
    var rows = [];

    MAP.forEach(function (entry) {
      var found = fields[entry.key];
      var guessed = derived[entry.key];
      var value = found !== undefined ? found : guessed;
      if (value === undefined || value === '' || value === null) {
        rows.push({
          key: entry.key, path: entry.path, label: entry.label,
          status: 'missing', from: readPath(deal, entry.path)
        });
        return;
      }
      rows.push({
        key: entry.key, path: entry.path, label: entry.label,
        status: found !== undefined ? 'found' : 'estimated',
        from: readPath(deal, entry.path),
        to: value,
        evidence: evidence[entry.key] || (found === undefined ? 'estimated from the price' : '')
      });
    });

    return rows;
  };

  /* ---------------------------------------------------------
     RentCast lookup
     --------------------------------------------------------- */

  I.RENTCAST_SIGNUP = 'https://app.rentcast.io/app/api';

  function rcType(t) {
    if (!t) return null;
    if (/multi/i.test(t)) return 'multifamily';
    if (/apartment/i.test(t)) return 'multifamily';
    if (/duplex/i.test(t)) return 'duplex';
    if (/land/i.test(t)) return 'land';
    return 'sfr';
  }

  function latest(record) {
    if (!record) return null;
    var years = Object.keys(record).filter(function (y) { return /^\d{4}$/.test(y); });
    if (!years.length) return null;
    years.sort();
    return record[years[years.length - 1]];
  }

  function call(path, address, key) {
    var url = 'https://api.rentcast.io/v1' + path +
              '?address=' + encodeURIComponent(address);
    return fetch(url, { headers: { 'X-Api-Key': key, 'Accept': 'application/json' } })
      .then(function (r) {
        return r.text().then(function (body) {
          var json = null;
          try { json = JSON.parse(body); } catch (e) { /* not json */ }
          if (!r.ok) {
            var msg = (json && (json.message || json.error)) || ('HTTP ' + r.status);
            var err = new Error(msg);
            err.status = r.status;
            throw err;
          }
          return json;
        });
      });
  }

  /**
   * Look an address up. Returns { fields, evidence, comps, rentComps, calls, errors }.
   * `want` selects which of the three endpoints to spend a request on.
   */
  I.lookup = function (address, key, want) {
    want = want || { record: true, value: true, rent: true };
    address = String(address || '').trim();

    if (!address) return Promise.reject(new Error('Enter an address first.'));
    if (!key) return Promise.reject(new Error('Enter your RentCast API key first.'));

    var jobs = [];
    if (want.record) jobs.push(['record', '/properties']);
    if (want.value) jobs.push(['value', '/avm/value']);
    if (want.rent) jobs.push(['rent', '/avm/rent/long-term']);

    if (!jobs.length) return Promise.reject(new Error('Pick at least one thing to look up.'));

    return Promise.all(jobs.map(function (job) {
      return call(job[1], address, key)
        .then(function (data) { return { which: job[0], data: data }; })
        .catch(function (e) { return { which: job[0], error: e.message, status: e.status }; });
    })).then(function (results) {
      var f = {}, ev = {}, errors = [], comps = [], rentComps = [];

      results.forEach(function (r) {
        if (r.error) { errors.push(r.which + ': ' + r.error); return; }
        var d = r.data;

        if (r.which === 'record') {
          var rec = Array.isArray(d) ? d[0] : d;
          if (!rec) { errors.push('record: no property found at that address'); return; }
          if (rec.formattedAddress) { f.address = rec.formattedAddress; ev.address = 'RentCast property record'; }
          if (rec.squareFootage) { f.sqft = rec.squareFootage; ev.sqft = 'RentCast property record'; }
          if (rec.yearBuilt) { f.yearBuilt = rec.yearBuilt; ev.yearBuilt = 'RentCast property record'; }
          if (rec.bedrooms) { f.beds = rec.bedrooms; }
          if (rec.bathrooms) { f.baths = rec.bathrooms; }
          var t = rcType(rec.propertyType);
          if (t) { f.propType = t; ev.propType = 'RentCast: ' + rec.propertyType; }

          var tax = latest(rec.propertyTaxes);
          if (tax && tax.total) { f.taxes = Math.round(tax.total); ev.taxes = 'RentCast tax record, ' + tax.year; }

          if (rec.hoa && rec.hoa.fee) { f.hoa = Math.round(rec.hoa.fee * 12); ev.hoa = 'RentCast HOA fee, monthly × 12'; }
          if (rec.lastSalePrice) { ev.lastSale = 'Last sold ' + (rec.lastSaleDate || '').slice(0, 10) + ' for ' + rec.lastSalePrice; }
        }

        if (r.which === 'value') {
          if (d && d.price) {
            f.price = Math.round(d.price);
            f.estimate = Math.round(d.price);
            ev.price = 'RentCast value estimate' +
              (d.priceRangeLow ? ' (range ' + Math.round(d.priceRangeLow) + '–' + Math.round(d.priceRangeHigh) + ')' : '');
            ev.estimate = ev.price;
          }
          (d && d.comparables || []).slice(0, 6).forEach(function (c) {
            if (c.price > 0 && c.squareFootage > 0) {
              comps.push({ addr: c.formattedAddress || '', price: Math.round(c.price), sqft: c.squareFootage, adjust: 0, distressed: false });
            }
          });
        }

        if (r.which === 'rent') {
          if (d && d.rent) {
            f.rent = Math.round(d.rent);
            ev.rent = 'RentCast rent estimate' +
              (d.rentRangeLow ? ' (range ' + Math.round(d.rentRangeLow) + '–' + Math.round(d.rentRangeHigh) + ')' : '');
          }
          (d && d.comparables || []).slice(0, 6).forEach(function (c) {
            if (c.price > 0) {
              rentComps.push({ addr: c.formattedAddress || '', rent: Math.round(c.price), sqft: c.squareFootage || 0 });
            }
          });
        }
      });

      return {
        fields: f, evidence: ev, comps: comps, rentComps: rentComps,
        /* Only requests that actually returned data count against the quota —
           a rejected key is not a billed lookup. */
        calls: results.filter(function (r) { return !r.error; }).length,
        attempted: jobs.length,
        errors: errors
      };
    });
  };

  root.DealLab = root.DealLab || {};
  root.DealLab.Import = I;

})(typeof window !== 'undefined' ? window : globalThis);
