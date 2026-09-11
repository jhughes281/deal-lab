/* =============================================================
   Deal Lab — interface layer
   Builds the panels, binds the inputs, redraws the results.
   All state lives in one `deal` object and in localStorage.
   ============================================================= */
(function () {
  'use strict';

  var E = window.DealLab.Engine;

  var KEY_CURRENT = 'deallab.current.v1';
  var KEY_PIPE = 'deallab.pipeline.v1';

  /* ---------------------------------------------------------
     Formatting
     --------------------------------------------------------- */

  var fUsd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fUsd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function money(n) { return isFinite(n) ? fUsd0.format(Math.round(n)) : '—'; }
  function money2(n) { return isFinite(n) ? fUsd2.format(n) : '—'; }
  function signed(n) { return isFinite(n) ? (n >= 0 ? '+' : '−') + fUsd0.format(Math.abs(Math.round(n))) : '—'; }
  function pct(n, dp) { return isFinite(n) ? n.toFixed(dp === undefined ? 1 : dp) + '%' : '—'; }
  function mult(n) { return isFinite(n) ? n.toFixed(2) + '×' : (n === Infinity ? 'no debt' : '—'); }
  function count(n) { return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—'; }

  function fmt(v, unit) {
    switch (unit) {
      case 'usd': return money(v);
      case 'usd2': return money2(v);
      case 'pct': return pct(v);
      case 'pct2': return pct(v, 2);
      case 'pctLow': return pct(v);
      case 'x': return mult(v);
      case 'n': return count(v);
      default: return String(v);
    }
  }

  function tone(n) { return !isFinite(n) ? '' : n >= 0 ? 'pos' : 'neg'; }

  /* ---------------------------------------------------------
     Tiny DOM helper
     --------------------------------------------------------- */

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function mount(name) { return document.querySelector('[data-mount="' + name + '"]'); }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------------------------------------------------
     State
     --------------------------------------------------------- */

  var deal = loadCurrent();
  var pipeline = loadPipeline();
  var result = null;
  var compareSet = {};

  function loadCurrent() {
    try {
      var raw = localStorage.getItem(KEY_CURRENT);
      if (raw) return merge(E.defaults(), JSON.parse(raw));
    } catch (e) { /* fall through to defaults */ }
    return E.defaults();
  }

  function loadPipeline() {
    try {
      var raw = localStorage.getItem(KEY_PIPE);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  /* Shallow-deep merge so a saved deal from an older version still opens. */
  function merge(base, over) {
    Object.keys(over || {}).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        merge(base[k], v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    });
    return base;
  }

  function persist() {
    try { localStorage.setItem(KEY_CURRENT, JSON.stringify(deal)); } catch (e) { /* private mode */ }
  }
  function persistPipe() {
    try { localStorage.setItem(KEY_PIPE, JSON.stringify(pipeline)); } catch (e) { /* private mode */ }
  }

  function get(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, deal);
  }
  function set(path, value) {
    var parts = path.split('.');
    var last = parts.pop();
    var target = parts.reduce(function (o, k) { return o[k]; }, deal);
    target[last] = value;
  }

  /* ---------------------------------------------------------
     Field builder
     --------------------------------------------------------- */

  function field(path, label, unit, hint, opts) {
    opts = opts || {};
    var id = 'f-' + path.replace(/\./g, '-');
    var cls = 'field' + (unit === 'usd' ? ' field--usd' : unit === 'pct' ? ' field--pct' : '') +
              (opts.wide ? ' field--wide' : '');

    var input;
    if (opts.choices) {
      input = h('select', { id: id, 'data-path': path },
        opts.choices.map(function (c) {
          return h('option', { value: c[0], selected: String(get(path)) === String(c[0]) }, [c[1]]);
        }));
    } else if (opts.text) {
      input = h('input', { id: id, type: 'text', 'data-path': path, value: get(path) || '', autocomplete: 'off' });
    } else {
      input = h('input', {
        id: id, type: 'number', 'data-path': path,
        value: get(path), step: opts.step || (unit === 'pct' ? '0.05' : '1'),
        min: opts.min === undefined ? null : opts.min,
        inputmode: 'decimal', autocomplete: 'off'
      });
    }

    return h('div', { class: cls }, [
      h('label', { for: id }, [label]),
      h('div', { class: 'field__in' }, [input]),
      hint ? h('p', { class: 'field__hint' }, [hint]) : null
    ]);
  }

  function checkField(path, label) {
    var id = 'f-' + path.replace(/\./g, '-');
    return h('label', { class: 'check', for: id }, [
      h('input', { id: id, type: 'checkbox', 'data-path': path, 'data-bool': true, checked: !!get(path) }),
      h('span', {}, [label])
    ]);
  }

  function card(title, tag, kids, note) {
    return h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, [title]),
        tag ? h('p', { class: 'label' }, [tag]) : null
      ])
    ].concat(kids).concat([
      note ? h('p', { class: 'card__note' }, [note]) : null
    ]));
  }

  function fieldset(kids) { return h('div', { class: 'fields' }, kids); }

  /* ---------------------------------------------------------
     Panels
     --------------------------------------------------------- */

  var PANELS = [
    { id: 'import', n: '', label: 'Import a listing', group: 'start' },
    { id: 'deal', n: '01', label: 'Property', group: 'assess' },
    { id: 'market', n: '02', label: 'Market', group: 'assess' },
    { id: 'comps', n: '03', label: 'Comps', group: 'assess' },
    { id: 'income', n: '04', label: 'Income', group: 'assess' },
    { id: 'financing', n: '05', label: 'Financing', group: 'assess' },
    { id: 'returns', n: '06', label: 'Year one', group: 'results' },
    { id: 'projection', n: '07', label: 'The hold', group: 'results' },
    { id: 'stress', n: '08', label: 'What breaks it', group: 'results' },
    { id: 'diligence', n: '09', label: 'Diligence', group: 'decide' },
    { id: 'box', n: '10', label: 'Buy box', group: 'decide' },
    { id: 'pipeline', n: '11', label: 'Pipeline', group: 'decide' }
  ];

  var active = 'deal';

  function buildRail() {
    ['start', 'assess', 'results', 'decide'].forEach(function (g) {
      var ul = document.querySelector('[data-rail-group="' + g + '"]');
      clear(ul);
      PANELS.filter(function (p) { return p.group === g; }).forEach(function (p) {
        ul.appendChild(h('li', {}, [
          h('button', {
            class: 'rail__btn', type: 'button', 'data-goto': p.id,
            'aria-current': String(p.id === active),
            onclick: function () { show(p.id); }
          }, [
            /* Only the five assessment steps are genuinely a sequence — they are
               Mashvisor's five. Numbering the results and decision panels too
               would claim an order that does not exist. */
            g === 'assess' ? h('span', { class: 'rail__n' }, [p.n]) : null,
            h('span', {}, [p.label])
          ])
        ]));
      });
    });
  }

  function show(id) {
    active = id;
    PANELS.forEach(function (p) {
      var el = document.getElementById('p-' + p.id);
      if (el) el.classList.toggle('is-on', p.id === id);
    });
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.setAttribute('aria-current', String(b.getAttribute('data-goto') === id));
    });
    if (id === 'pipeline') renderPipeline();
    if (id === 'diligence') renderDiligence();
    try { localStorage.setItem('deallab.panel', id); } catch (e) { /* ignore */ }
    var main = document.getElementById('main');
    if (main && window.scrollY > 160) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- 0. Import ---------- */

  var IM = window.DealLab.Import;
  var KEY_RC = 'deallab.rentcast.key';
  var KEY_RC_USE = 'deallab.rentcast.usage';
  var importPlan = null;          // rows awaiting the user's approval
  var importExtras = null;        // comps that came back with a lookup

  var rates = { taxRate: 2.2, insRate: 0.8, rentRule: 0 };

  function rcUsage() {
    var month = new Date().toISOString().slice(0, 7);
    try {
      var raw = JSON.parse(localStorage.getItem(KEY_RC_USE) || '{}');
      if (raw.month === month) return raw;
    } catch (e) { /* ignore */ }
    return { month: month, count: 0 };
  }
  function rcSpend(n) {
    var u = rcUsage();
    u.count += n;
    try { localStorage.setItem(KEY_RC_USE, JSON.stringify(u)); } catch (e) { /* ignore */ }
    return u;
  }

  function buildImport() {
    var m = mount('import');
    clear(m);

    /* --- A. paste a listing --- */
    var box = h('textarea', {
      id: 'imp-paste', rows: 7, spellcheck: 'false',
      placeholder: 'Paste the listing URL here — or open the listing, select the whole page (Ctrl+A), copy, and paste it here for the full set of numbers.',
      style: 'width:100%;padding:.6rem;border:1px solid var(--rule);border-radius:var(--radius);' +
             'background:var(--paper);font-family:var(--mono);font-size:.85rem;line-height:1.5;resize:vertical'
    });

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['From a listing']),
        h('p', { class: 'label' }, ['No key needed'])
      ]),
      h('label', { for: 'imp-paste', style: 'display:block;font-size:.8rem;font-weight:500;margin-bottom:.3rem' },
        ['Listing link, or the copied listing page']),
      box,
      h('div', { class: 'pipe__acts' }, [
        h('button', {
          class: 'btn btn--sm', type: 'button',
          onclick: function () { readListing(box.value); }
        }, ['Read it']),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: function () { box.value = ''; box.focus(); renderImportPlan(null); }
        }, ['Clear'])
      ]),
      h('p', { class: 'card__note' }, [
        'A link on its own only carries the address — that is all a URL contains. Copying the ' +
        'page itself gets the price, size, year, taxes, HOA and the site’s rent estimate, because ' +
        'by then your browser has already loaded it.'
      ])
    ]));

    /* --- B. gap-filling rates --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Filling the gaps']),
        h('p', { class: 'label' }, ['Only where nothing was found'])
      ]),
      h('div', { class: 'fields' }, [
        rateField('taxRate', 'Property tax rate', 'Of price, a year. Texas runs roughly 2.0–2.8%.'),
        rateField('insRate', 'Insurance rate', 'Of price, a year.'),
        rateField('rentRule', 'Rent as % of price', 'Monthly. Leave at 0 and no rent will be guessed.')
      ]),
      h('p', { class: 'card__note' }, [
        'Anything filled this way is marked as an estimate in the table below, never as a found ' +
        'figure. A guessed rent is the fastest way to talk yourself into a bad deal, which is why ' +
        'that one starts switched off.'
      ])
    ]));

    /* --- C. address lookup --- */
    var u = rcUsage();
    var addrInput = h('input', {
      id: 'imp-addr', type: 'text', autocomplete: 'off',
      placeholder: '4218 Cedar Post Ln, Houston, TX 77053',
      value: deal.meta.address || '',
      style: 'width:100%;min-height:44px;padding:.5rem .6rem;border:1px solid var(--rule);' +
             'border-radius:var(--radius);background:var(--paper);font-family:var(--mono);font-size:.9rem'
    });
    var keyInput = h('input', {
      id: 'imp-key', type: 'password', autocomplete: 'off', placeholder: 'RentCast API key',
      value: (function () { try { return localStorage.getItem(KEY_RC) || ''; } catch (e) { return ''; } })(),
      style: 'width:100%;min-height:44px;padding:.5rem .6rem;border:1px solid var(--rule);' +
             'border-radius:var(--radius);background:var(--paper);font-family:var(--mono);font-size:.9rem'
    });

    var want = { record: true, value: true, rent: true };
    function wantBox(k, label) {
      var id = 'imp-want-' + k;
      return h('label', { class: 'check', for: id, style: 'grid-column:auto' }, [
        h('input', {
          id: id, type: 'checkbox', checked: true,
          onchange: function (e) { want[k] = e.target.checked; }
        }),
        h('span', {}, [label])
      ]);
    }

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['From an address']),
        h('p', { class: 'label' }, ['Needs your own key'])
      ]),
      h('div', { class: 'fields' }, [
        h('div', { class: 'field field--wide' }, [
          h('label', { for: 'imp-addr' }, ['Property address']),
          h('div', { class: 'field__in' }, [addrInput])
        ]),
        h('div', { class: 'field field--wide' }, [
          h('label', { for: 'imp-key' }, ['RentCast API key']),
          h('div', { class: 'field__in' }, [keyInput]),
          h('p', { class: 'field__hint' }, [
            'Free tier is 50 requests a month. Get one at ',
            h('a', { href: IM.RENTCAST_SIGNUP, target: '_blank', rel: 'noopener noreferrer' }, ['app.rentcast.io']),
            '. Stored only in this browser and sent only to RentCast.'
          ])
        ])
      ]),
      h('div', { style: 'display:flex;gap:1.1rem;flex-wrap:wrap;margin:.4rem 0' }, [
        wantBox('record', 'Property record'),
        wantBox('value', 'Value estimate and sale comps'),
        wantBox('rent', 'Rent estimate and rent comps')
      ]),
      h('div', { class: 'pipe__acts' }, [
        h('button', {
          class: 'btn btn--sm', type: 'button', 'data-lookup': true,
          onclick: function (e) { runLookup(addrInput.value, keyInput.value, want, e.target); }
        }, ['Look it up']),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: function () {
            try {
              if (keyInput.value) localStorage.setItem(KEY_RC, keyInput.value);
              else localStorage.removeItem(KEY_RC);
              toast(keyInput.value ? 'Key saved in this browser.' : 'Key removed.');
            } catch (err) { toast('This browser will not let the page store anything.'); }
          }
        }, ['Remember key'])
      ]),
      h('p', { class: 'card__note' }, [
        'Each ticked box is one request. ',
        h('b', {}, [String(u.count)]),
        ' used so far in ' + u.month + '. A lookup also fills the comparables tables, so the ' +
        'valuation and rent sections have real evidence behind them rather than your guess.'
      ])
    ]));

    /* --- D. results --- */
    m.appendChild(h('div', { 'data-import-out': true }));

    /* --- E. why not the link alone --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Why a link alone is not enough']),
        h('p', { class: 'label' }, ['The honest answer'])
      ]),
      h('p', { style: 'margin:0;font-size:.88rem;line-height:1.6' }, [
        'This page would have to fetch the listing itself, and the listing sites do not allow that. ' +
        'Zillow and Redfin refuse cross-origin requests outright; Realtor.com answers automated ' +
        'callers with a 429. That is their decision and working around it would mean disguising ' +
        'the request, so the tool does not try. Copying the page works because your browser has ' +
        'already been served it, and an address lookup works because RentCast licenses the data ' +
        'and publishes an API for exactly this.'
      ])
    ]));

    renderImportPlan(importPlan);
  }

  function rateField(key, label, hint) {
    var id = 'rate-' + key;
    return h('div', { class: 'field field--pct' }, [
      h('label', { for: id }, [label]),
      h('div', { class: 'field__in' }, [
        h('input', {
          id: id, type: 'number', step: '0.05', min: 0, value: rates[key], inputmode: 'decimal',
          oninput: function (e) { rates[key] = parseFloat(e.target.value) || 0; }
        })
      ]),
      h('p', { class: 'field__hint' }, [hint])
    ]);
  }

  function readListing(raw) {
    if (!String(raw || '').trim()) return toast('Paste a link or a listing page first.');
    var parsed = IM.parse(raw);
    var derived = IM.derive(parsed.fields, rates);

    if (!Object.keys(parsed.fields).length) {
      importPlan = null;
      renderImportPlan(null, 'Nothing recognisable in that. If you pasted a link, try copying the listing page itself.');
      return;
    }

    if (parsed.source && parsed.source.url) deal.meta.sourceUrl = parsed.source.url;

    importExtras = null;
    importPlan = {
      rows: IM.plan(deal, parsed.fields, derived, parsed.evidence),
      source: parsed.source
        ? (parsed.source.bareUrl
            ? 'Read the address out of a ' + parsed.source.site + ' link. Copy the page itself for the rest.'
            : 'Read from a ' + parsed.source.site + ' listing.')
        : 'Read from pasted text.',
      selected: {}
    };
    importPlan.rows.forEach(function (r) {
      if (r.status !== 'missing') importPlan.selected[r.key] = true;
    });
    renderImportPlan(importPlan);
  }

  function runLookup(address, key, want, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Looking…';

    IM.lookup(address, key, want).then(function (res) {
      rcSpend(res.calls);
      var derived = IM.derive(res.fields, rates);

      if (!Object.keys(res.fields).length) {
        importPlan = null;
        renderImportPlan(null, res.errors.length
          ? 'RentCast returned nothing usable — ' + res.errors.join('; ')
          : 'RentCast has no record for that address. Check the spelling, or include the ZIP.');
        return;
      }

      importExtras = { comps: res.comps, rentComps: res.rentComps };
      importPlan = {
        rows: IM.plan(deal, res.fields, derived, res.evidence),
        source: 'Looked up through RentCast (' + res.calls +
                (res.calls === 1 ? ' request' : ' requests') + ').' +
                (res.errors.length ? ' Some parts failed: ' + res.errors.join('; ') : ''),
        selected: {},
        extras: importExtras
      };
      importPlan.rows.forEach(function (r) {
        if (r.status !== 'missing') importPlan.selected[r.key] = true;
      });
      renderImportPlan(importPlan);
    }).catch(function (e) {
      importPlan = null;
      renderImportPlan(null, e.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = label;
    });
  }

  function renderImportPlan(plan, message) {
    var out = document.querySelector('[data-import-out]');
    if (!out) return;
    clear(out);

    if (message) {
      out.appendChild(h('section', { class: 'card' }, [
        h('p', { class: 'pipe__empty', style: 'border-color:var(--neg);color:var(--neg)' }, [message])
      ]));
      return;
    }
    if (!plan) return;

    var usable = plan.rows.filter(function (r) { return r.status !== 'missing'; });
    var missing = plan.rows.filter(function (r) { return r.status === 'missing'; });

    var body = h('tbody', {}, usable.map(function (r) {
      return h('tr', {}, [
        h('td', {}, [h('input', {
          type: 'checkbox', checked: !!plan.selected[r.key],
          'aria-label': 'Apply ' + r.label,
          style: 'width:1.1rem;height:1.1rem;accent-color:var(--brass)',
          onchange: function (e) { plan.selected[r.key] = e.target.checked; }
        })]),
        h('td', {}, [
          h('b', { style: 'font-weight:500' }, [r.label]),
          r.evidence ? h('br') : null,
          r.evidence ? h('span', { style: 'font-size:.74rem;color:var(--slate)' }, [r.evidence]) : null
        ]),
        h('td', { class: 'n', style: 'color:var(--slate)' }, [fmtImport(r.key, r.from)]),
        h('td', { class: 'n' }, [fmtImport(r.key, r.to)]),
        h('td', {}, [h('span', {
          class: 'flag ' + (r.status === 'found' ? 'flag--pass' : 'flag--na')
        }, [r.status])])
      ]);
    }));

    out.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['What it read']),
        h('p', { class: 'label' }, [usable.length + ' of ' + plan.rows.length + ' fields'])
      ]),
      h('p', { style: 'margin:0 0 .8rem;font-size:.87rem;color:var(--slate)' }, [plan.source]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, ['Use', 'Field', 'Now', 'New', ''].map(function (t) {
            return h('th', {}, [t]);
          }))]),
          body
        ])
      ]),
      plan.extras && (plan.extras.comps.length || plan.extras.rentComps.length)
        ? h('p', { style: 'margin:.9rem 0 0;font-size:.85rem' }, [
            'Also came back: ' + plan.extras.comps.length + ' sale comps and ' +
            plan.extras.rentComps.length + ' rent comps, which will replace what is in the ' +
            'comparables tables.'
          ])
        : null,
      h('div', { class: 'pipe__acts' }, [
        h('button', {
          class: 'btn btn--sm', type: 'button',
          onclick: function () { applyImport(plan); }
        }, ['Apply to the sheet']),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: function () {
            usable.forEach(function (r) { plan.selected[r.key] = (r.status === 'found'); });
            renderImportPlan(plan);
          }
        }, ['Found only'])
      ]),
      missing.length
        ? h('p', { class: 'card__note' }, [
            'Not found, so left alone: ' +
            missing.map(function (r) { return r.label.toLowerCase(); }).join(', ') + '.'
          ])
        : null
    ]));
  }

  function fmtImport(key, v) {
    if (v === undefined || v === null || v === '') return '—';
    if (key === 'address' || key === 'propType' || key === 'yearBuilt') return String(v);
    if (key === 'units' || key === 'sqft') return count(v);
    if (key === 'rent') return money(v) + '/mo';
    return money(v);
  }

  function applyImport(plan) {
    var applied = 0;
    plan.rows.forEach(function (r) {
      if (r.status === 'missing' || !plan.selected[r.key]) return;
      set(r.path, r.to);
      applied++;
    });

    if (plan.extras) {
      if (plan.extras.comps.length) { deal.comps = plan.extras.comps.slice(); applied++; }
      if (plan.extras.rentComps.length) { deal.rentComps = plan.extras.rentComps.slice(); applied++; }
    }

    if (!applied) return toast('Nothing was ticked, so nothing changed.');

    if (!deal.meta.name && deal.meta.address) {
      deal.meta.name = deal.meta.address.split(',')[0];
    }

    persist();
    rebuildAll();
    toast(applied + ' field' + (applied === 1 ? '' : 's') + ' applied. Check the operating expenses before you trust the verdict.');
    show('returns');
  }

  /* ---------- 1. Property ---------- */

  function buildDeal() {
    var m = mount('deal');
    clear(m);

    m.appendChild(card('Identification', 'What it is', [
      fieldset([
        field('meta.address', 'Address', null, null, { text: true, wide: true }),
        field('meta.propType', 'Property type', null, null, {
          choices: [
            ['sfr', 'Single-family house'],
            ['duplex', 'Duplex / small multi'],
            ['multifamily', 'Apartment (5+ units)'],
            ['retail', 'Retail'],
            ['office', 'Office'],
            ['industrial', 'Industrial'],
            ['land', 'Land']
          ]
        }),
        field('meta.strategy', 'Strategy', null, null, {
          choices: [
            ['rental', 'Buy and hold'],
            ['flip', 'Rehab and resell'],
            ['str', 'Short-term rental'],
            ['commercial', 'Commercial / leased']
          ]
        }),
        field('meta.units', 'Units', null, null, { min: 0 }),
        field('meta.sqft', 'Building sq ft', null, null, { min: 0 }),
        field('meta.yearBuilt', 'Year built', null, null, { min: 0 })
      ])
    ], 'Property type drives the depreciation schedule: residential recovers over 27.5 years, commercial over 39. Strategy decides which tests the verdict scores against.'));

    m.appendChild(card('Acquisition', 'Cost to enter', [
      fieldset([
        field('buy.price', 'Purchase price', 'usd', null, { min: 0 }),
        field('buy.rehab', 'Rehab / make-ready', 'usd', null, { min: 0 }),
        field('buy.closingPct', 'Buying closing costs', 'pct', 'Share of purchase price', { min: 0 }),
        field('buy.otherUpfront', 'Other upfront', 'usd', 'Inspections, survey, opening reserves', { min: 0 }),
        field('buy.arv', 'Value when stabilised', 'usd', 'After-repair value', { min: 0 }),
        field('buy.landPct', 'Land share of value', 'pct', 'Land does not depreciate', { min: 0 })
      ])
    ]));

    m.appendChild(card('Resale path', 'Flip only', [
      fieldset([
        field('flip.holdMonths', 'Holding period', null, 'Months, purchase to closing', { min: 0 }),
        field('flip.carryMonthly', 'Monthly carry', 'usd', 'Taxes, insurance, utilities, security', { min: 0 }),
        field('flip.sellPct', 'Selling costs', 'pct', 'Commission plus closing, on ARV', { min: 0 }),
        field('flip.ltcPct', 'Loan to cost', 'pct', 'Share of purchase plus rehab', { min: 0 }),
        field('flip.hardRatePct', 'Bridge rate', 'pct', 'Interest only', { min: 0 })
      ])
    ], 'Carry runs for the whole holding period, including the months the house sits on the market after the work is finished. That is the month people forget.'));
  }

  /* ---------- 2. Market ---------- */

  function buildMarket() {
    var m = mount('market');
    clear(m);

    var gauge = h('div', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Market score']), h('p', { class: 'label' }, ['Weighted'])]),
      h('div', { class: 'gauge' }, [
        h('span', { class: 'gauge__pct', 'data-mkt-pct': true }, ['—']),
        h('span', { class: 'gauge__grade', 'data-mkt-grade': true }, ['—'])
      ]),
      h('div', { class: 'gauge__bar' }, [h('div', { class: 'gauge__fill', 'data-mkt-fill': true, style: 'width:0%' })]),
      h('p', { class: 'card__note', 'data-mkt-note': true }, ['Score each factor from 1 (bad) to 5 (excellent).'])
    ]);
    m.appendChild(gauge);

    ['macro', 'micro'].forEach(function (group) {
      var rows = E.MARKET_FACTORS.filter(function (f) { return f.group === group; }).map(function (f) {
        var pips = h('div', { class: 'pips', role: 'group', 'aria-label': f.label + ', score 1 to 5' },
          [1, 2, 3, 4, 5].map(function (v) {
            return h('button', {
              type: 'button', class: 'pip', 'data-mkt': f.key, 'data-val': v,
              'aria-pressed': String(deal.market[f.key] === v),
              'aria-label': f.label + ', score ' + v,
              onclick: function () {
                deal.market[f.key] = (deal.market[f.key] === v) ? null : v;
                syncPips();
                recalc();
              }
            }, [String(v)]);
          }));

        return h('div', { class: 'score__row' }, [
          h('div', { class: 'score__lab' }, [
            h('b', {}, [f.label, ' ', h('span', { class: 'score__w' }, ['×' + f.weight])]),
            h('i', {}, [f.hint])
          ]),
          pips
        ]);
      });

      m.appendChild(card(
        group === 'macro' ? 'The region' : 'The block',
        group === 'macro' ? 'Macro factors' : 'Micro factors',
        [h('div', { class: 'score' }, rows)],
        group === 'macro'
          ? 'Population and job growth set the demand: roughly one new dwelling per three people added, and one new household per 1.5 jobs created. Employer diversity is weighted heavily because a market carried by one employer has one point of failure.'
          : 'Micro factors decide which tenant you get inside a market you have already accepted. Score the property tax burden low anywhere a sale triggers reassessment — Texas runs about 3% of 80% of the purchase price.'
      ));
    });
  }

  function syncPips() {
    document.querySelectorAll('[data-mkt]').forEach(function (b) {
      var key = b.getAttribute('data-mkt');
      var v = parseInt(b.getAttribute('data-val'), 10);
      b.setAttribute('aria-pressed', String(deal.market[key] === v));
    });
  }

  /* ---------- 3. Comps ---------- */

  function buildComps() {
    var m = mount('comps');
    clear(m);

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Sold comparables']),
        h('p', { class: 'label' }, ['Value'])
      ]),
      h('div', { class: 'tbl-wrap', 'data-comp-table': true }),
      h('div', { class: 'pipe__acts' }, [
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () {
          deal.comps.push({ addr: '', price: 0, sqft: 0, adjust: 0, distressed: false });
          buildComps(); recalc();
        } }, ['Add a comp']),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () {
          if (!result || !isFinite(result.comps.indicated)) return toast('Add at least one comp with a price and a size.');
          deal.buy.arv = Math.round(result.comps.indicated);
          buildDeal(); recalc();
          toast('Stabilised value set to ' + money(deal.buy.arv) + '.');
        } }, ['Use as stabilised value'])
      ]),
      h('div', { 'data-comp-out': true })
    ]));

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Rent comparables']),
        h('p', { class: 'label' }, ['Income'])
      ]),
      h('div', { class: 'tbl-wrap', 'data-rent-table': true }),
      h('div', { class: 'pipe__acts' }, [
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () {
          deal.rentComps.push({ addr: '', rent: 0, sqft: 0 });
          buildComps(); recalc();
        } }, ['Add a rent comp']),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: function () {
          if (!result || !isFinite(result.rentComps.indicated)) return toast('Add at least one rent comp.');
          deal.inc.rentMonthly = Math.round(result.rentComps.indicated);
          buildIncome(); recalc();
          toast('Gross rent set to ' + money(deal.inc.rentMonthly) + ' a month.');
        } }, ['Use as gross rent'])
      ]),
      h('div', { 'data-rent-out': true }),
      h('p', { class: 'card__note' }, [
        'Short sales and foreclosures are marked distressed and left out of the average — they are ' +
        'evidence of a forced seller, not of market value. Adjustments are entered as a dollar ' +
        'change to the comp: negative if the comp is better than your property, positive if worse.'
      ])
    ]));

    renderCompTables();
  }

  function renderCompTables() {
    var wrap = document.querySelector('[data-comp-table]');
    if (!wrap) return;
    clear(wrap);

    if (!deal.comps.length) {
      wrap.appendChild(h('p', { class: 'pipe__empty' }, ['No sold comps yet. Add three to six that match on age, size, condition and location.']));
    } else {
      var body = h('tbody', {}, deal.comps.map(function (c, i) {
        return h('tr', {}, [
          h('td', {}, [h('input', {
            type: 'text', value: c.addr || '', 'aria-label': 'Comp ' + (i + 1) + ' address',
            placeholder: 'Address', style: 'width:100%;min-height:38px;padding:.3rem .4rem;border:1px solid var(--rule);border-radius:2px;background:var(--paper)',
            oninput: function (e) { c.addr = e.target.value; }
          })]),
          numCell(c, 'price', 'Sold price', i),
          numCell(c, 'sqft', 'Square feet', i),
          numCell(c, 'adjust', 'Adjustment', i),
          h('td', {}, [h('input', {
            type: 'checkbox', checked: !!c.distressed, 'aria-label': 'Comp ' + (i + 1) + ' is distressed',
            style: 'width:1.1rem;height:1.1rem;accent-color:var(--brass)',
            onchange: function (e) { c.distressed = e.target.checked; recalc(); }
          })]),
          h('td', {}, [h('button', {
            class: 'btn btn--ghost btn--sm btn--danger', type: 'button',
            'aria-label': 'Remove comp ' + (i + 1),
            onclick: function () { deal.comps.splice(i, 1); buildComps(); recalc(); }
          }, ['Remove'])])
        ]);
      }));

      wrap.appendChild(h('table', { class: 'tbl tbl--wide' }, [
        h('thead', {}, [h('tr', {}, ['Address', 'Sold price', 'Sq ft', 'Adjustment', 'Distressed', ''].map(function (t) {
          return h('th', {}, [t]);
        }))]),
        body
      ]));
    }

    var rwrap = document.querySelector('[data-rent-table]');
    clear(rwrap);
    if (!deal.rentComps.length) {
      rwrap.appendChild(h('p', { class: 'pipe__empty' }, ['No rent comps yet. Use what is actually leasing, not what is listed.']));
    } else {
      rwrap.appendChild(h('table', { class: 'tbl' }, [
        h('thead', {}, [h('tr', {}, ['Address', 'Monthly rent', 'Sq ft', ''].map(function (t) { return h('th', {}, [t]); }))]),
        h('tbody', {}, deal.rentComps.map(function (c, i) {
          return h('tr', {}, [
            h('td', {}, [h('input', {
              type: 'text', value: c.addr || '', placeholder: 'Address',
              'aria-label': 'Rent comp ' + (i + 1) + ' address',
              style: 'width:100%;min-height:38px;padding:.3rem .4rem;border:1px solid var(--rule);border-radius:2px;background:var(--paper)',
              oninput: function (e) { c.addr = e.target.value; }
            })]),
            numCell(c, 'rent', 'Monthly rent', i),
            numCell(c, 'sqft', 'Square feet', i),
            h('td', {}, [h('button', {
              class: 'btn btn--ghost btn--sm btn--danger', type: 'button',
              'aria-label': 'Remove rent comp ' + (i + 1),
              onclick: function () { deal.rentComps.splice(i, 1); buildComps(); recalc(); }
            }, ['Remove'])])
          ]);
        }))
      ]));
    }
  }

  function numCell(obj, key, label, i) {
    return h('td', {}, [h('input', {
      type: 'number', value: obj[key], 'aria-label': label + ' for row ' + (i + 1),
      inputmode: 'decimal',
      style: 'width:7rem;min-height:38px;padding:.3rem .4rem;border:1px solid var(--rule);border-radius:2px;background:var(--paper);font-family:var(--mono);text-align:right',
      oninput: function (e) { obj[key] = parseFloat(e.target.value) || 0; recalc(); }
    })]);
  }

  /* ---------- 4. Income ---------- */

  function buildIncome() {
    var m = mount('income');
    clear(m);

    m.appendChild(card('Income', 'Top of the sheet', [
      fieldset([
        field('inc.rentMonthly', 'Gross monthly rent', 'usd', 'All units, fully occupied', { min: 0 }),
        field('inc.otherMonthly', 'Other monthly income', 'usd', 'Laundry, pet, storage, late fees', { min: 0 }),
        field('inc.vacPct', 'Vacancy', 'pct', 'Share of gross scheduled rent', { min: 0 }),
        field('inc.creditPct', 'Credit loss', 'pct', 'Non-payment you never collect', { min: 0 }),
        field('inc.concPct', 'Concessions', 'pct', 'One free month is 8.3% of the year', { min: 0 })
      ])
    ], 'A 0% vacancy factor is not conservative, it is fiction. One lost month per twelve — 8.3% — is the realistic floor for residential, before you add anything for credit loss.'));

    m.appendChild(card('Operating expenses', 'Never includes debt', [
      fieldset([
        field('ops.taxes', 'Property taxes', 'usd', 'Annual, at your basis not the seller’s', { min: 0 }),
        field('ops.insurance', 'Insurance', 'usd', 'Annual', { min: 0 }),
        field('ops.utilities', 'Utilities you pay', 'usd', 'Annual', { min: 0 }),
        field('ops.hoa', 'HOA / condo dues', 'usd', 'Annual', { min: 0 }),
        field('ops.groundsPest', 'Grounds and pest', 'usd', 'Annual', { min: 0 }),
        field('ops.payroll', 'On-site payroll', 'usd', 'Annual', { min: 0 }),
        field('ops.marketing', 'Marketing and turnover', 'usd', 'Annual', { min: 0 }),
        field('ops.otherFixed', 'Other fixed', 'usd', 'Annual', { min: 0 }),
        field('ops.mgmtPct', 'Management', 'pct', 'Of effective gross income', { min: 0 }),
        field('ops.maintPct', 'Repairs and maintenance', 'pct', 'Of gross scheduled rent', { min: 0 }),
        field('ops.capexPct', 'Capital reserve', 'pct', 'Roof, HVAC, appliances, flooring', { min: 0 }),
        checkField('ops.capexInNoi', 'Count the capital reserve as an operating expense. Leave this on to be conservative — lenders and brokers usually take it out, which lifts NOI and the cap rate without changing what the roof actually costs.')
      ])
    ], 'Put a management fee in even if you plan to self-manage. Your time has an opportunity cost, and if you hire out later your projections will not suddenly collapse.'));

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Where it lands']), h('p', { class: 'label' }, ['Year one'])]),
      h('div', { 'data-income-mini': true })
    ]));
  }

  /* ---------- 5. Financing ---------- */

  function buildFinancing() {
    var m = mount('financing');
    clear(m);

    m.appendChild(card('The loan', 'Permanent debt', [
      fieldset([
        field('loan.downPct', 'Down payment', 'pct', 'Of purchase price', { min: 0 }),
        field('loan.ratePct', 'Interest rate', 'pct', null, { min: 0 }),
        field('loan.termYears', 'Amortisation', null, 'Years', { min: 1 }),
        field('loan.ioMonths', 'Interest-only period', null, 'Months, 0 for none', { min: 0 }),
        field('loan.pointsPct', 'Points', 'pct', 'Of loan, paid at closing', { min: 0 }),
        field('loan.fees', 'Lender fees', 'usd', 'Flat, paid at closing', { min: 0 })
      ])
    ], 'Taxes and insurance are handled as operating expenses here rather than escrowed into the payment, so the payment line is principal and interest only.'));

    m.appendChild(card('Hold assumptions', 'Drives the projection', [
      fieldset([
        field('proj.holdYears', 'Hold period', null, 'Years, 1 to 30', { min: 1 }),
        field('proj.rentGrowth', 'Rent growth', 'pct', 'A year', { min: 0 }),
        field('proj.expGrowth', 'Expense growth', 'pct', 'A year', { min: 0 }),
        field('proj.apprec', 'Appreciation', 'pct', 'Cross-check only', { min: 0 }),
        field('proj.exitCapPct', 'Exit cap rate', 'pct', 'What a buyer pays you on', { min: 0 }),
        field('proj.sellCostPct', 'Selling costs', 'pct', 'Of sale price', { min: 0 }),
        field('proj.marketCapPct', 'Submarket cap rate', 'pct', 'The going rate nearby', { min: 0 })
      ])
    ], 'Expense growth is set above rent growth on purpose. Taxes, insurance and utilities have historically climbed faster than rents, and a projection where they grow in lockstep flatters every deal.'));

    m.appendChild(card('Tax position', 'Yours, not the property’s', [
      fieldset([
        field('tax.marginalPct', 'Marginal income rate', 'pct', null, { min: 0 }),
        field('tax.capGainsPct', 'Capital gains rate', 'pct', 'At sale', { min: 0 }),
        field('tax.recapturePct', 'Depreciation recapture', 'pct', 'Usually 25%', { min: 0 }),
        checkField('tax.applyTax', 'Apply tax to the projection. Turn this off to see the deal before tax only.')
      ])
    ], 'The after-tax figures assume you can actually use any paper loss in the year it arises. Passive activity rules often defer that, so treat after-tax cash flow as a ceiling and take it to your CPA before you rely on it.'));
  }

  /* ---------- 6. Year one ---------- */

  function renderReturns() {
    var m = mount('returns');
    clear(m);
    var r = result, is = r.is, cap = r.cap, mt = r.metrics;
    var isFlip = deal.meta.strategy === 'flip';

    if (isFlip) {
      var f = r.flip;
      m.appendChild(h('section', { class: 'card' }, [
        h('div', { class: 'card__head' }, [h('h3', {}, ['Resale result']), h('p', { class: 'label' }, ['Flip'])]),
        tiles([
          ['Net profit', money(f.profit), tone(f.profit), 'ARV less every cost of the project'],
          ['Cash in', money(f.cashIn), '', 'Down payment, closing, points, interest, carry'],
          ['Return on cash', pct(f.roi), tone(f.roi), 'Over ' + count(deal.flip.holdMonths) + ' months'],
          ['Annualised', pct(f.annualized), tone(f.annualized), 'Return on cash scaled to a year'],
          ['Margin on ARV', pct(f.margin), tone(f.margin), 'Profit as a share of the sale'],
          ['Max allowable offer', money(f.mao), '', '70% of ARV less rehab']
        ]),
        h('div', { class: 'tbl-wrap' }, [table(
          ['Line', 'Amount'],
          [
            ['Purchase price', money(deal.buy.price)],
            ['Rehab budget', money(deal.buy.rehab)],
            ['Buying closing costs', money(f.buyClose)],
            ['Points', money(f.points)],
            ['Bridge interest, ' + count(deal.flip.holdMonths) + ' months', money(f.interest)],
            ['Carry, ' + count(deal.flip.holdMonths) + ' months', money(f.carry)],
            ['Other upfront', money(deal.buy.otherUpfront)],
            ['Selling costs', money(f.sellCosts)],
            ['__total', 'Total project cost', money(f.totalCost)],
            ['After-repair value', money(deal.buy.arv)],
            ['__total', 'Net profit', money(f.profit), tone(f.profit)]
          ]
        )]),
        h('p', { class: 'card__note' }, [
          f.spread >= 0
            ? 'The offer sits ' + money(f.spread) + ' under the 70% rule.'
            : 'The offer is ' + money(-f.spread) + ' over the 70% rule. That is a screen, not a law — but going over it means every other assumption has to be right.'
        ])
      ]));
    }

    /* --- the waterfall --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Where the rent goes']),
        h('p', { class: 'label' }, ['Annual'])
      ]),
      waterfall(is, cap, mt),
      h('p', { class: 'card__note' }, [
        'Debt service is never an operating expense, which is why net operating income does not move ' +
        'when you change the loan. That is the whole point of the measure: it describes the building, ' +
        'not the buyer.'
      ])
    ]));

    /* --- headline metrics --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Returns']), h('p', { class: 'label' }, ['Year one'])]),
      tiles([
        ['Net operating income', money(mt.noi), tone(mt.noi), 'Effective gross income less operating expenses'],
        ['Cap rate on price', pct(mt.capOnPrice, 2), '', 'NOI ÷ purchase price'],
        ['Cap rate on all-in', pct(mt.capOnBasis, 2), '', 'NOI ÷ price + rehab + costs'],
        ['Cash flow', money(mt.cfMonthly) + '/mo', tone(mt.cfMonthly), money(mt.cfbt) + ' a year'],
        ['Cash-on-cash', pct(mt.coc, 2), tone(mt.coc), 'On ' + money(cap.cash) + ' out of pocket'],
        ['Debt coverage', mult(mt.dscr), '', 'NOI ÷ annual debt service'],
        ['Debt yield', pct(mt.debtYield, 2), '', 'NOI ÷ loan amount'],
        ['Break-even occupancy', pct(mt.beOcc), mt.beOcc <= 80 ? 'pos' : 'neg', 'Below this you are feeding it'],
        ['Break-even rent', money(mt.beRent) + '/mo', '', 'Where cash flow turns zero'],
        ['Expense ratio', pct(mt.oer), '', 'Operating expenses ÷ effective gross'],
        ['Debt service share', pct(mt.dsShare), (mt.dsShare > 90 ? 'neg' : ''), 'Of NOI. 75–90% is normal early'],
        ['Payback', isFinite(mt.payback) ? mt.payback.toFixed(1) + ' yrs' : '—', '', 'Cash back from cash flow alone']
      ]),
      h('p', { class: 'card__note' }, [
        'Cap rate on the all-in basis is the honest one. Cap rate on price alone is what the ' +
        'listing quotes, and it quietly ignores the rehab and closing costs you also had to fund.'
      ])
    ]));

    /* --- broker gap --- */
    if (deal.ops.capexInNoi) {
      m.appendChild(h('section', { class: 'card' }, [
        h('div', { class: 'card__head' }, [
          h('h3', {}, ['The broker’s version of this deal']),
          h('p', { class: 'label' }, ['Same building'])
        ]),
        tiles([
          ['NOI without the reserve', money(mt.noiBroker), '', 'Capital reserve taken out'],
          ['Cap rate that produces', pct(mt.capBroker, 2), '', 'On the same purchase price'],
          ['The gap', pct(mt.capBroker - mt.capOnPrice, 2), 'warn', 'Points of cap rate, from one line']
        ]),
        h('p', { class: 'card__note' }, [
          'Nothing about the building changed. Taking a ' + pct(deal.ops.capexPct) + ' capital reserve ' +
          'out of the expense list moves the cap rate by ' + pct(mt.capBroker - mt.capOnPrice, 2) +
          '. This is the single most common way a marketing pro forma looks better than the property is. ' +
          'When you receive one, the first question is which reserves it left out.'
        ])
      ]));
    }

    /* --- screens --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Screens']), h('p', { class: 'label' }, ['Rules of thumb'])]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, ['Screen', 'This deal', 'Target', ''].map(function (t) { return h('th', {}, [t]); }))]),
          h('tbody', {}, r.screens.map(function (s) {
            return h('tr', {}, [
              h('td', {}, [h('b', { style: 'font-weight:500' }, [s.key]), h('br'), h('span', { style: 'font-size:.78rem;color:var(--slate)' }, [s.note])]),
              h('td', { class: 'n' }, [fmt(s.value, s.unit)]),
              h('td', { class: 'n', style: 'color:var(--slate);font-size:.78rem' }, [s.target]),
              h('td', {}, [h('span', {
                class: 'flag ' + (s.pass === null ? 'flag--na' : s.pass ? 'flag--pass' : 'flag--fail')
              }, [s.pass === null ? 'n/a' : s.pass ? 'pass' : 'miss'])])
            ]);
          }))
        ])
      ]),
      h('p', { class: 'card__note' }, [
        'These are filters for a list of fifty properties, not a verdict on one. A deal that misses ' +
        'the 1% rule can still work; a deal that passes every screen can still be in the wrong market.'
      ])
    ]));

    /* --- max offer solver --- */
    var targets = [
      ['coc', 'Cash-on-cash of ' + pct(deal.box.minCoC), deal.box.minCoC],
      ['cap', 'Cap rate of ' + pct(deal.box.minCap), deal.box.minCap],
      ['dscr', 'Coverage of ' + mult(deal.box.minDSCR), deal.box.minDSCR],
      ['debtYield', 'Debt yield of ' + pct(deal.box.minDebtYield), deal.box.minDebtYield]
    ].map(function (t) {
      return { key: t[0], label: t[1], price: E.maxOffer(deal, t[0], t[2]) };
    });

    var binding = targets.filter(function (t) { return isFinite(t.price); })
                         .sort(function (a, b) { return a.price - b.price; })[0];

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['What you can actually pay']),
        h('p', { class: 'label' }, ['Solved backwards'])
      ]),
      h('div', { class: 'tbl-wrap' }, [table(
        ['To hit', 'Most you can pay', 'Against your ' + money(deal.buy.price)],
        targets.map(function (t) {
          var gap = t.price - deal.buy.price;
          return [t.label, money(t.price), isFinite(gap) ? signed(gap) : '—', isFinite(gap) ? tone(gap) : ''];
        })
      )]),
      h('p', { class: 'card__note' }, [
        binding
          ? 'The binding constraint is ' + binding.label.toLowerCase() + ', which caps the offer at ' +
            money(binding.price) + '. Every figure here holds rent, expenses and loan terms fixed and ' +
            'moves only the price, so it is the offer number — not a valuation.'
          : 'None of your buy-box targets is reachable at any price with these rents and expenses. ' +
            'Either the income assumptions are too low or the operating budget is too heavy.'
      ])
    ]));

    /* --- statement --- */
    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Operating statement']), h('p', { class: 'label' }, ['Year one'])]),
      h('div', { class: 'tbl-wrap' }, [table(
        ['Line', 'Annual', 'Monthly'],
        [
          ['Gross scheduled rent', money(is.gpi), money(is.gpi / 12)],
          ['Less vacancy', '−' + money(is.vac), '−' + money(is.vac / 12)],
          ['Less credit loss', '−' + money(is.credit), '−' + money(is.credit / 12)],
          ['Less concessions', '−' + money(is.conc), '−' + money(is.conc / 12)],
          ['Plus other income', '+' + money(is.other), '+' + money(is.other / 12)],
          ['__total', 'Effective gross income', money(is.egi), money(is.egi / 12)],
          ['Fixed expenses', '−' + money(is.fixed), '−' + money(is.fixed / 12)],
          ['Management', '−' + money(is.mgmt), '−' + money(is.mgmt / 12)],
          ['Repairs and maintenance', '−' + money(is.maint), '−' + money(is.maint / 12)],
          [(deal.ops.capexInNoi ? 'Capital reserve' : 'Capital reserve (below the line)'),
           (deal.ops.capexInNoi ? '−' : '') + money(is.capex), (deal.ops.capexInNoi ? '−' : '') + money(is.capex / 12)],
          ['__total', 'Net operating income', money(is.noi), money(is.noi / 12)],
          ['Debt service', '−' + money(cap.ds), '−' + money(cap.ds / 12)],
          ['__total', 'Cash flow before tax', money(mt.cfbt), money(mt.cfMonthly), tone(mt.cfbt)]
        ]
      )])
    ]));
  }

  /* --- the waterfall drawing --- */

  function waterfall(is, cap, mt) {
    var steps = [
      { label: 'Gross scheduled rent', value: is.gpi, kind: 'total' },
      { label: 'Vacancy, credit loss, concessions', value: -(is.vac + is.credit + is.conc), kind: 'out' },
      { label: 'Other income', value: is.other, kind: 'in' },
      { label: 'Effective gross income', value: is.egi, kind: 'total' },
      { label: 'Operating expenses', value: -is.opex, kind: 'out' },
      { label: 'Net operating income', value: is.noi, kind: 'total' },
      { label: 'Debt service', value: -cap.ds, kind: 'out' },
      { label: 'Cash flow before tax', value: mt.cfbt, kind: 'final' }
    ];

    var W = 420, rowH = 40, padT = 10;
    var Hgt = padT + steps.length * rowH + 6;
    var max = Math.max(is.gpi, is.egi, 1);
    var scale = function (v) { return Math.max(0, Math.abs(v) / max * W); };

    var ns = 'http://www.w3.org/2000/svg';
    function s(tag, attrs, kids) {
      var n = document.createElementNS(ns, tag);
      Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      (kids || []).forEach(function (kid) { n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); });
      return n;
    }

    var svg = s('svg', {
      class: 'fall__svg', viewBox: '0 0 ' + (W + 4) + ' ' + Hgt,
      role: 'img',
      'aria-label': 'Waterfall from gross scheduled rent of ' + money(is.gpi) +
                    ' down to cash flow before tax of ' + money(mt.cfbt) + ' a year.'
    });

    var running = 0;
    steps.forEach(function (st, i) {
      var y = padT + i * rowH;
      var barY = y + 12;
      var barH = 17;
      var x, w, fill, stroke;

      if (st.kind === 'total' || st.kind === 'final') {
        running = st.value;
        x = 0;
        w = scale(st.value);
        fill = st.kind === 'final'
          ? (st.value >= 0 ? '#a06a1f' : '#9d3226')
          : '#14191d';
        stroke = 'none';
      } else if (st.kind === 'out') {
        // sits at the right-hand end of what was there before it
        w = scale(st.value);
        x = Math.max(0, scale(running) - w);
        fill = '#f6e7e4';
        stroke = '#9d3226';
        running = running + st.value;
      } else {
        x = scale(running);
        w = scale(st.value);
        fill = '#e6efe9';
        stroke = '#2c6448';
        running = running + st.value;
      }

      // guide rule
      svg.appendChild(s('line', { x1: 0, y1: y + 0.5, x2: W, y2: y + 0.5, stroke: '#d7d1c4', 'stroke-width': .5 }));

      svg.appendChild(s('rect', {
        x: x.toFixed(1), y: barY, width: Math.max(w, 1).toFixed(1), height: barH,
        fill: fill, stroke: stroke, 'stroke-width': stroke === 'none' ? 0 : 1, rx: 1
      }));

      svg.appendChild(s('text', {
        x: 0, y: y + 9, 'font-size': 10.5, fill: '#4a545c', 'letter-spacing': '.01em'
      }, [st.label]));

      svg.appendChild(s('text', {
        x: W, y: y + 9, 'font-size': 10.5, 'text-anchor': 'end',
        fill: st.kind === 'out' ? '#9d3226' : st.kind === 'in' ? '#2c6448' : '#14191d',
        'font-weight': (st.kind === 'total' || st.kind === 'final') ? 600 : 400
      }, [(st.kind === 'out' ? '−' : st.kind === 'in' ? '+' : '') + money(Math.abs(st.value))]));
    });

    var key = h('ul', { class: 'fall__key' }, [
      keyRow('#14191d', 'Subtotals', money(is.noi) + ' NOI'),
      keyRow('#f6e7e4', 'Taken out', '−' + money(is.vac + is.credit + is.conc + is.opex + cap.ds)),
      keyRow('#e6efe9', 'Added', '+' + money(is.other)),
      keyRow(mt.cfbt >= 0 ? '#a06a1f' : '#9d3226', 'What is left', money(mt.cfbt))
    ]);

    return h('div', { class: 'fall' }, [svg, key]);

    function keyRow(colour, label, val) {
      return h('li', {}, [
        h('span', { class: 'fall__sw', style: 'background:' + colour + ';border:1px solid rgba(0,0,0,.2)' }),
        h('span', {}, [label]),
        h('b', {}, [val])
      ]);
    }
  }

  /* ---------- 7. Projection ---------- */

  function renderProjection() {
    var m = mount('projection');
    clear(m);
    var pf = result.proforma, ex = pf.exit, rt = pf.returns, cap = result.cap;

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Return over ' + pf.hold + ' years']),
        h('p', { class: 'label' }, ['Pre-tax unless marked'])
      ]),
      tiles([
        ['IRR', pct(rt.irrBT, 2), tone(rt.irrBT), 'Pre-tax, cash flow plus sale'],
        ['IRR after tax', pct(rt.irrAT, 2), tone(rt.irrAT), 'At your marginal rate'],
        ['Equity multiple', mult(rt.equityMultiple), '', 'Total back ÷ cash in'],
        ['Total profit', money(rt.totalProfit), tone(rt.totalProfit), 'Cash flow plus net sale, less cash in'],
        ['Cash flow over hold', money(rt.sumCfbt), tone(rt.sumCfbt), 'Before the sale'],
        ['Average cash-on-cash', pct(rt.avgCoC, 2), tone(rt.avgCoC), 'Mean of the hold']
      ])
    ]));

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['Year by year']), h('p', { class: 'label' }, ['Pro forma'])]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, ['Year', 'Effective gross', 'Op. expenses', 'NOI', 'Debt service', 'Cash flow', 'Loan balance', 'After tax'].map(function (t) {
            return h('th', {}, [t]);
          }))]),
          h('tbody', {}, pf.rows.slice(0, pf.hold).map(function (row) {
            return h('tr', {}, [
              h('td', {}, [String(row.year)]),
              h('td', { class: 'n' }, [money(row.egi)]),
              h('td', { class: 'n' }, ['−' + money(row.opex)]),
              h('td', { class: 'n' }, [money(row.noi)]),
              h('td', { class: 'n' }, ['−' + money(row.payment)]),
              h('td', { class: 'n ' + tone(row.cfbt) }, [money(row.cfbt)]),
              h('td', { class: 'n' }, [money(row.balance)]),
              h('td', { class: 'n ' + tone(row.cfat) }, [money(row.cfat)])
            ]);
          }))
        ])
      ]),
      h('p', { class: 'card__note' }, [
        'Depreciation of ' + money(pf.annualDep) + ' a year over ' + pf.depYears +
        ' years is what makes after-tax cash flow beat pre-tax in the early years. It is a deduction ' +
        'you never write a cheque for — and it is also what the taxman recaptures at 25% when you sell.'
      ])
    ]));

    var divergence = isFinite(ex.salePrice) && isFinite(ex.apprecValue) && ex.apprecValue > 0
      ? (ex.salePrice - ex.apprecValue) / ex.apprecValue * 100 : NaN;

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['The exit']), h('p', { class: 'label' }, ['End of year ' + pf.hold])]),
      h('div', { class: 'tbl-wrap' }, [table(
        ['Line', 'Amount'],
        [
          ['Forward NOI, year ' + (pf.hold + 1), money(ex.forwardNoi)],
          ['Priced at an exit cap of ' + pct(deal.proj.exitCapPct, 2), money(ex.salePrice)],
          ['Selling costs at ' + pct(deal.proj.sellCostPct), '−' + money(ex.sellCosts)],
          ['Loan payoff', '−' + money(ex.payoff)],
          ['__total', 'Net sale proceeds', money(ex.netProceeds), tone(ex.netProceeds)],
          ['Depreciation taken', money(ex.totalDep)],
          ['Recapture at ' + pct(deal.tax.recapturePct), '−' + money(ex.recapture)],
          ['Capital gains at ' + pct(deal.tax.capGainsPct), '−' + money(ex.capGainTax)],
          ['__total', 'Net of tax', money(ex.netProceedsAT), tone(ex.netProceedsAT)]
        ]
      )]),
      h('p', { class: 'card__note' }, [
        'The sale is priced off the year ' + (pf.hold + 1) + ' NOI, because that is the income a buyer ' +
        'is purchasing. Straight appreciation at ' + pct(deal.proj.apprec) + ' a year would instead put ' +
        'the property at ' + money(ex.apprecValue) + '. ' +
        (isFinite(divergence) && Math.abs(divergence) > 15
          ? 'Those two disagree by ' + pct(Math.abs(divergence)) + ', which is a lot. The cap-rate ' +
            'number is the one to trust for income property — but a gap this wide means one of your ' +
            'two assumptions is wrong, and it is worth knowing which before you buy.'
          : 'The two are close enough to be mutually corroborating, which is what you want to see.')
      ])
    ]));
  }

  /* ---------- 8. Stress ---------- */

  function renderStress() {
    var m = mount('stress');
    clear(m);
    var mt = result.metrics;

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['One assumption at a time']), h('p', { class: 'label' }, ['Year one'])]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, ['Scenario', 'Cash flow', 'Change', 'Cash-on-cash', 'Coverage', 'Break-even', ''].map(function (t) {
            return h('th', {}, [t]);
          }))]),
          h('tbody', {}, [
            h('tr', { style: 'background:var(--paper)' }, [
              h('td', {}, [h('b', { style: 'font-weight:600' }, ['Base case'])]),
              h('td', { class: 'n ' + tone(mt.cfMonthly) }, [money(mt.cfMonthly) + '/mo']),
              h('td', { class: 'n', style: 'color:var(--slate)' }, ['—']),
              h('td', { class: 'n ' + tone(mt.coc) }, [pct(mt.coc)]),
              h('td', { class: 'n' }, [mult(mt.dscr)]),
              h('td', { class: 'n' }, [pct(mt.beOcc)]),
              h('td', {}, [''])
            ])
          ].concat(result.stress.map(function (st) {
            return h('tr', {}, [
              h('td', {}, [st.label]),
              h('td', { class: 'n ' + tone(st.cfMonthly) }, [money(st.cfMonthly) + '/mo']),
              h('td', { class: 'n ' + tone(st.dCf) }, [signed(st.dCf)]),
              h('td', { class: 'n ' + tone(st.coc) }, [pct(st.coc)]),
              h('td', { class: 'n ' + (st.dscr < 1.2 ? 'neg' : '') }, [mult(st.dscr)]),
              h('td', { class: 'n' }, [pct(st.beOcc)]),
              h('td', {}, [h('span', {
                class: 'flag ' + (st.survives ? 'flag--pass' : 'flag--fail')
              }, [st.survives ? 'holds' : 'breaks'])])
            ]);
          })))
        ])
      ]),
      h('p', { class: 'card__note' }, [
        'Each row re-runs the entire sheet with one input moved against you and everything else held. ' +
        '"Breaks" means cash flow turns negative or coverage drops under 1.00 — the point at which the ' +
        'building stops paying for itself and starts drawing on you.'
      ])
    ]));

    /* sensitivity grid */
    var sg = result.sensitivity;
    var flat = [];
    sg.grid.forEach(function (row) { row.forEach(function (v) { if (isFinite(v)) flat.push(v); }); });
    var lo = flat.length ? Math.min.apply(null, flat) : 0;
    var hi = flat.length ? Math.max.apply(null, flat) : 1;
    var target = E.num(deal.box.minIRR);

    function cellStyle(v) {
      if (!isFinite(v)) return 'color:var(--slate)';
      if (v < 0) return 'background:#f6e7e4';
      if (v >= target) {
        var t = hi > target ? (v - target) / (hi - target) : 1;
        var alpha = (0.12 + t * 0.45).toFixed(2);
        return 'background:rgba(160,106,31,' + alpha + ')';
      }
      var u = target > lo ? (v - lo) / (target - lo) : 0;
      return 'background:rgba(215,209,196,' + (0.15 + (1 - u) * 0.4).toFixed(2) + ')';
    }

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Two at once']),
        h('p', { class: 'label' }, ['IRR surface'])
      ]),
      h('p', { style: 'margin:0 0 .3rem;font-size:.85rem;color:var(--slate)' }, [
        'Pre-tax IRR over ' + result.proforma.hold + ' years. Shaded cells clear your ' +
        pct(target) + ' target; the outlined cell is your current base case.'
      ]),
      h('div', { class: 'grid-wrap' }, [
        h('table', { class: 'sens' }, [
          h('thead', {}, [
            h('tr', {}, [
              h('th', { class: 'cnr' }, ['']),
              h('th', { class: 'sens__axis', colspan: sg.cols.length }, ['Rent growth'])
            ]),
            h('tr', {}, [h('th', { class: 'sens__axis' }, ['Exit cap'])].concat(
              sg.cols.map(function (c) { return h('th', {}, [pct(c, 2)]); })
            ))
          ]),
          h('tbody', {}, sg.grid.map(function (row, i) {
            return h('tr', {}, [h('th', {}, [pct(sg.rows[i], 2)])].concat(
              row.map(function (v, j) {
                return h('td', {
                  class: (i === sg.baseRow && j === sg.baseCol) ? 'is-base' : '',
                  style: cellStyle(v)
                }, [isFinite(v) ? v.toFixed(1) + '%' : '—']);
              })
            ));
          }))
        ])
      ]),
      h('p', { class: 'card__note' }, [
        'Read down a column to see what cap rate movement alone does to you. Most of the return on a ' +
        'levered hold is decided by the exit, not by the rent roll — which is why buying at a cap rate ' +
        'below where you expect to sell is the quiet way to lose money on a property that never missed ' +
        'a rent payment.'
      ])
    ]));
  }

  /* ---------- 9. Diligence ---------- */

  var DD = [
    {
      title: 'Physical',
      blurb: 'A walk-through with an inspector is a small part of this, not the whole of it.',
      items: [
        ['phys-plans', 'Site plans and specifications', 'Construction documents, building plans, floor plans, land use documents.'],
        ['phys-photos', 'Photographs, inside, outside and aerial', 'Shows where the property sits relative to neighbours, roads and whatever is coming next door.'],
        ['phys-struct', 'Structural inspection', 'Walls, roof, foundation. Hire someone who inspects this asset class specifically.'],
        ['phys-interior', 'Interior systems inspection', 'Doors, windows, weatherproofing, roof age, code violations, accessibility compliance.'],
        ['phys-mech', 'Mechanical and electrical inspection', 'Heating, ventilation, air conditioning, plumbing, all power systems and controls.'],
        ['phys-capex', 'Capital improvements performed, last five years', 'Receipts and documentation. Tells you what is due to fail next.'],
        ['phys-pest', 'Pest and termite inspection', 'Usually a lender requirement on residential income property.']
      ]
    },
    {
      title: 'Financial',
      blurb: 'Verify the seller’s record of performance rather than accepting it. Every number here should reconcile to another number.',
      items: [
        ['fin-ie', 'Income and expense statements, three years', 'Plus last year monthly, plus three years of balance sheets.'],
        ['fin-rentroll', 'Rent roll, reconciled to the leases', 'Tenant, space, rent, move-in, lease expiry, deposit. Total it and match it to the income statement.'],
        ['fin-tax', 'Tax returns, three years', 'Reconcile to the income and expense statements. If they disagree, believe the return.'],
        ['fin-leases', 'Every lease, plus estoppel letters', 'The estoppel confirms the lease you were shown is the only agreement that exists.'],
        ['fin-expiry', 'Lease expiry schedule mapped', 'If a large share rolls next year, can you carry the property through the re-let?'],
        ['fin-conc', 'Concessions identified', 'A thirteenth month free does not show up in the rent roll but it does show up in your bank account.'],
        ['fin-utils', 'Utility bills, two years actual', 'Compare each category against the seller expense statement.'],
        ['fin-taxbill', 'Property tax bills, two years', 'Then call the assessor and ask how it reassesses after a sale.'],
        ['fin-reassess', 'Post-sale reassessment modelled into the budget', 'The most common single reason a first-year budget misses.']
      ]
    },
    {
      title: 'Legal',
      blurb: 'This one takes a team. It also gets faster every time you do it.',
      items: [
        ['leg-env', 'Phase I environmental site assessment', 'Past use, neighbouring use, asbestos, underground storage tanks. Expensive to cure and a genuine deal-killer.'],
        ['leg-zoning', 'Zoning and land use verified by an attorney', 'Confirm your intended use is permitted — and look at what the neighbours are zoned for too.'],
        ['leg-title', 'Title commitment and survey', 'Easements, encroachments, restrictions, liens.'],
        ['leg-permits', 'Permits and certificates of occupancy', 'Unpermitted work becomes your unpermitted work at closing.'],
        ['leg-claims', 'Insurance loss-run history', 'Past claims predict both future claims and your future premium.'],
        ['leg-contracts', 'Service contracts and vendor agreements', 'Which ones survive the sale, and which can you cancel?'],
        ['leg-lit', 'Litigation, liens and code enforcement search', '']
      ]
    },
    {
      title: 'Red flags',
      blurb: 'Properties fail for a short list of repeated reasons. Tick each line only once you have confirmed it does not apply to you.',
      items: [
        ['rf-emotion', 'I am not emotionally committed to this deal', 'As emotions go up, judgement goes down. Wanting a first deal is how people overpay for one.'],
        ['rf-market', 'I know the rent levels, vacancy, crime trend and rent laws here', 'Insufficient market knowledge is a leading cause of failure, especially out of state.'],
        ['rf-price', 'I am not paying up out of fear of losing it', 'Overpaying locks in debt you cannot grow out of. Taxes, utilities and the mortgage do not fall.'],
        ['rf-debt', 'The property survives a 10% tenant loss without negative cash flow', 'Check the stress table.'],
        ['rf-deferred', 'Deferred maintenance is quantified, not assumed', 'Rehab budgets that turn out to be double are the classic short-term-hold failure.'],
        ['rf-tenant', 'No single tenant or employer can sink this', 'One tenant leaving, or one large local employer closing, should not end the deal.'],
        ['rf-exit', 'I have a second exit if the first one closes', 'Refinance, hold, lease-option, wholesale. A deal with one exit is a bet, not an investment.']
      ]
    }
  ];

  function renderDiligence() {
    var m = mount('diligence');
    clear(m);

    var total = DD.reduce(function (a, g) { return a + g.items.length; }, 0);
    var done = DD.reduce(function (a, g) {
      return a + g.items.filter(function (it) { return deal.dd[it[0]]; }).length;
    }, 0);

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'dd__bar' }, [
        h('span', { class: 'dd__count num' }, [done + ' of ' + total]),
        h('div', { class: 'dd__track' }, [
          h('div', { class: 'dd__fill', style: 'width:' + (total ? (done / total * 100) : 0) + '%' })
        ]),
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button',
          onclick: function () { deal.dd = {}; persist(); renderDiligence(); toast('Checklist cleared.'); }
        }, ['Clear'])
      ]),
      h('p', { style: 'margin:0;font-size:.87rem;color:var(--slate)' }, [
        'Ticks are saved with the deal. Work the list with a detective’s eye rather than an anxious ' +
        'buyer’s — the things people miss are the obvious ones they assumed somebody else had checked.'
      ])
    ]));

    DD.forEach(function (g) {
      m.appendChild(h('section', { class: 'card dd__group' }, [
        h('h4', {}, [g.title]),
        h('p', {}, [g.blurb])
      ].concat(g.items.map(function (it) {
        var id = 'dd-' + it[0];
        return h('label', { class: 'dd__item', for: id }, [
          h('input', {
            id: id, type: 'checkbox', checked: !!deal.dd[it[0]],
            onchange: function (e) {
              deal.dd[it[0]] = e.target.checked;
              persist();
              renderDiligence();
            }
          }),
          h('span', {}, [it[1], it[2] ? h('em', {}, [it[2]]) : null])
        ]);
      }))));
    });
  }

  /* ---------- 10. Buy box ---------- */

  function buildBox() {
    var m = mount('box');
    clear(m);

    m.appendChild(card('Your thresholds', 'What counts as a yes', [
      fieldset([
        field('box.minCoC', 'Minimum cash-on-cash', 'pct', null, { min: 0 }),
        field('box.minCap', 'Minimum cap rate', 'pct', 'On purchase price', { min: 0 }),
        field('box.minDSCR', 'Minimum coverage', null, 'NOI ÷ debt service', { step: '0.05', min: 0 }),
        field('box.maxBreakEven', 'Maximum break-even occupancy', 'pct', null, { min: 0 }),
        field('box.minDebtYield', 'Minimum debt yield', 'pct', null, { min: 0 }),
        field('box.minIRR', 'Minimum IRR', 'pct', 'Over the hold', { min: 0 }),
        field('box.minFlipProfit', 'Minimum flip profit', 'usd', null, { min: 0 })
      ])
    ], 'Set these once and stop renegotiating with yourself deal by deal. A break-even occupancy of 70% or less marks a genuinely good cash-flow deal; most commercial lenders want coverage of 1.20 to 1.30 or better.'));

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [h('h3', {}, ['How each figure is calculated']), h('p', { class: 'label' }, ['Method'])]),
      h('ul', { class: 'notes' }, [
        ['Effective gross income', 'Gross scheduled rent less vacancy, credit loss and concessions, plus other income. Vacancy, maintenance and the capital reserve are taken against gross scheduled rent; management is taken against effective gross income, since that is what a manager actually collects on.'],
        ['Net operating income', 'Effective gross income less operating expenses. Debt service is never an operating expense, so NOI does not move when financing changes.'],
        ['Cap rate', 'NOI divided by price, and separately by the all-in basis of price plus rehab plus closing. The all-in figure is the one that reflects what you actually funded.'],
        ['Cash-on-cash', 'Annual pre-tax cash flow divided by total cash out of pocket — down payment, rehab, closing costs, points, fees and opening reserves.'],
        ['Debt service coverage', 'NOI divided by annual debt service.'],
        ['Debt yield', 'NOI divided by the loan amount. Lenders use it because, unlike coverage, it cannot be flattered by a low rate or a long amortisation.'],
        ['Break-even occupancy', 'Operating expenses plus annual debt service, divided by potential gross revenue. Below this point the property runs at negative cash flow.'],
        ['Break-even rent', 'Solved directly: the gross rent at which cash flow before tax is exactly zero, accounting for the expense lines that scale with rent.'],
        ['Max allowable offer', 'Seventy percent of after-repair value less the rehab budget. A screening number for resale, never a valuation.'],
        ['Gross rent multiplier', 'Price divided by annual gross rent. The income multiplier is the same idea across every income line.'],
        ['Submarket value', 'NOI divided by the going cap rate nearby. Rearranged, that same relationship gives you an opening offer: the NOI you believe, divided by the return you require.'],
        ['Pro forma', 'Rent and other income grow at the rent growth rate; fixed expenses grow at the expense rate; percentage-based expenses follow their base. The loan amortises monthly and is rolled up by year.'],
        ['Depreciation', 'The improvable share of the basis — everything except land — recovered straight-line over 27.5 years for residential and 39 for commercial.'],
        ['The exit', 'Priced off the NOI of the year after the hold ends, because that is the income a buyer is purchasing. Selling costs and the loan payoff come out, then recapture at your recapture rate and capital gains on the rest.'],
        ['IRR', 'Solved by bisection on the annual cash flows, with the net sale proceeds added to the final year. Shown pre-tax and after tax.'],
        ['Market score', 'Twelve factors, each scored 1 to 5 and weighted 1 to 3. Any factor weighted 3 that scores 2 or below is raised as a flag, and a market scoring under 50 downgrades an otherwise passing deal.'],
        ['Comparables', 'Each comp is adjusted, reduced to a price per square foot, and averaged. Distressed sales are excluded by default because they evidence a forced seller, not market value.']
      ].map(function (n, i) {
        return h('li', { 'data-n': String(i + 1).padStart(2, '0') }, [
          h('b', {}, [n[0]]), ' — ', n[1]
        ]);
      })),
      h('p', { class: 'card__note' }, [
        'Formulas follow Conti and Harris, ', h('i', {}, ['Commercial Real Estate Investing For Dummies']),
        '; Tyson and Griswold, ', h('i', {}, ['Real Estate Investing For Dummies']),
        '; and the five-step deal analysis published by Mashvisor. Every figure on this sheet is an ' +
        'estimate. Verify taxes with the county, insurance with a carrier, rent with real comps, and ' +
        'rehab with a contractor who has walked the property. This is a calculator, not advice.'
      ])
    ]));
  }

  /* ---------- 11. Pipeline ---------- */

  function renderPipeline() {
    var m = mount('pipeline');
    clear(m);

    if (!pipeline.length) {
      m.appendChild(h('div', { class: 'card' }, [
        h('p', { class: 'pipe__empty' }, ['No saved deals yet. Fill in a deal and press Save deal in the header.'])
      ]));
      return;
    }

    var rows = pipeline.map(function (rec, i) {
      var r = E.analyze(merge(E.defaults(), JSON.parse(JSON.stringify(rec.deal))));
      var v = r.verdict.state;
      return h('tr', {}, [
        h('td', {}, [h('input', {
          type: 'checkbox', checked: !!compareSet[rec.id],
          'aria-label': 'Compare ' + (rec.deal.meta.name || 'deal'),
          style: 'width:1.1rem;height:1.1rem;accent-color:var(--brass)',
          onchange: function (e) { compareSet[rec.id] = e.target.checked; refreshCompare(); }
        })]),
        h('td', {}, [
          h('b', { style: 'font-weight:500' }, [rec.deal.meta.name || 'Untitled']),
          rec.deal.meta.address ? h('br') : null,
          rec.deal.meta.address ? h('span', { style: 'font-size:.76rem;color:var(--slate)' }, [rec.deal.meta.address]) : null
        ]),
        h('td', {}, [h('span', { class: 'chip chip--' + (v === 'pass' ? 'pass' : v === 'watch' ? 'watch' : 'fail') }, [
          v === 'pass' ? 'buy' : v === 'watch' ? 'watch' : 'pass on'
        ])]),
        h('td', { class: 'n' }, [money(rec.deal.buy.price)]),
        h('td', { class: 'n' }, [pct(r.metrics.capOnPrice, 2)]),
        h('td', { class: 'n ' + tone(r.metrics.coc) }, [pct(r.metrics.coc, 2)]),
        h('td', { class: 'n' }, [mult(r.metrics.dscr)]),
        h('td', { class: 'n ' + tone(r.metrics.cfMonthly) }, [money(r.metrics.cfMonthly)]),
        h('td', { class: 'n ' + tone(r.proforma.returns.irrBT) }, [pct(r.proforma.returns.irrBT, 1)]),
        h('td', {}, [
          h('button', {
            class: 'btn btn--ghost btn--sm', type: 'button',
            onclick: function () {
              deal = merge(E.defaults(), JSON.parse(JSON.stringify(rec.deal)));
              persist(); rebuildAll(); show('deal');
              toast('Loaded ' + (rec.deal.meta.name || 'deal') + '.');
            }
          }, ['Open']),
          ' ',
          h('button', {
            class: 'btn btn--ghost btn--sm btn--danger', type: 'button',
            onclick: function () {
              pipeline.splice(i, 1); persistPipe(); renderPipeline();
            }
          }, ['Delete'])
        ])
      ]);
    });

    m.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, [pipeline.length + (pipeline.length === 1 ? ' saved deal' : ' saved deals')]),
        h('p', { class: 'label' }, ['This browser only'])
      ]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, ['Cmp', 'Deal', 'Verdict', 'Price', 'Cap', 'CoC', 'DSCR', 'CF/mo', 'IRR', ''].map(function (t) {
            return h('th', {}, [t]);
          }))]),
          h('tbody', {}, rows)
        ])
      ]),
      h('div', { class: 'pipe__acts' }, [
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportCsv }, ['Download CSV']),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: exportJson }, ['Download JSON']),
        h('button', { class: 'btn btn--ghost btn--sm btn--danger', type: 'button', onclick: function () {
          pipeline = []; persistPipe(); compareSet = {}; renderPipeline(); toast('Pipeline cleared.');
        } }, ['Clear all'])
      ]),
      h('p', { class: 'card__note' }, [
        'Each row is recalculated from its stored inputs every time this table draws, so a comparison ' +
        'always uses the current formulas rather than whatever the figures happened to be on the day ' +
        'you saved it. Clearing your browser data clears this list.'
      ])
    ]));

    m.appendChild(h('div', { 'data-compare': true }));
    refreshCompare();
  }

  /* Redrawn on its own so ticking a compare box never rebuilds the table
     underneath the checkbox you just clicked. */
  function refreshCompare() {
    var slot = document.querySelector('[data-compare]');
    if (!slot) return;
    clear(slot);
    var picked = pipeline.filter(function (rec) { return compareSet[rec.id]; });
    if (picked.length >= 2) slot.appendChild(renderCompare(picked));
    else if (picked.length === 1) {
      slot.appendChild(h('p', { class: 'pipe__empty' }, ['Tick one more deal to stand them side by side.']));
    }
  }

  function renderCompare(picked) {
    var analyses = picked.map(function (rec) {
      return { name: rec.deal.meta.name || 'Untitled', r: E.analyze(merge(E.defaults(), JSON.parse(JSON.stringify(rec.deal)))), d: rec.deal };
    });

    var lines = [
      ['Purchase price', function (a) { return a.d.buy.price; }, 'usd', 'low'],
      ['Cash in', function (a) { return a.r.cap.cash; }, 'usd', 'low'],
      ['Net operating income', function (a) { return a.r.metrics.noi; }, 'usd', 'high'],
      ['Cap rate on price', function (a) { return a.r.metrics.capOnPrice; }, 'pct2', 'high'],
      ['Cash-on-cash', function (a) { return a.r.metrics.coc; }, 'pct2', 'high'],
      ['Monthly cash flow', function (a) { return a.r.metrics.cfMonthly; }, 'usd', 'high'],
      ['Coverage', function (a) { return a.r.metrics.dscr; }, 'x', 'high'],
      ['Break-even occupancy', function (a) { return a.r.metrics.beOcc; }, 'pct', 'low'],
      ['IRR over hold', function (a) { return a.r.proforma.returns.irrBT; }, 'pct2', 'high'],
      ['Equity multiple', function (a) { return a.r.proforma.returns.equityMultiple; }, 'x', 'high'],
      ['Market score', function (a) { return a.r.market.pct; }, 'pct', 'high']
    ];

    return h('section', { class: 'card' }, [
      h('div', { class: 'card__head' }, [
        h('h3', {}, ['Side by side']),
        h('p', { class: 'label' }, [picked.length + ' deals'])
      ]),
      h('div', { class: 'tbl-wrap' }, [
        h('table', { class: 'tbl tbl--wide' }, [
          h('thead', {}, [h('tr', {}, [h('th', {}, ['Measure'])].concat(
            analyses.map(function (a) { return h('th', {}, [a.name]); })
          ))]),
          h('tbody', {}, lines.map(function (ln) {
            var vals = analyses.map(ln[1]);
            var finite = vals.filter(isFinite);
            var best = finite.length
              ? (ln[3] === 'high' ? Math.max.apply(null, finite) : Math.min.apply(null, finite))
              : null;
            return h('tr', {}, [h('td', {}, [ln[0]])].concat(
              vals.map(function (v) {
                var isBest = finite.length > 1 && isFinite(v) && v === best;
                return h('td', { class: 'n', style: isBest ? 'font-weight:600;background:var(--brass-wash)' : '' },
                  [fmt(v, ln[2])]);
              })
            ));
          }))
        ])
      ]),
      h('p', { class: 'card__note' }, ['The highlighted cell in each row is the better figure on that measure alone. No single row decides a deal.'])
    ]);
  }

  /* ---------------------------------------------------------
     Shared table builder
     row = [label, ...cells] or ['__total', label, ...cells]
     an optional trailing string that is 'pos' or 'neg' tints the last cell
     --------------------------------------------------------- */

  function table(headers, rows) {
    return h('table', { class: 'tbl' }, [
      h('thead', {}, [h('tr', {}, headers.map(function (t) { return h('th', {}, [t]); }))]),
      h('tbody', {}, rows.map(function (r) {
        var total = r[0] === '__total';
        var cells = total ? r.slice(1) : r.slice(0);
        var last = cells[cells.length - 1];
        var tint = (last === 'pos' || last === 'neg' || last === '') ? cells.pop() : '';
        return h('tr', { class: total ? 'is-total' : '' }, cells.map(function (c, i) {
          return h('td', { class: i === 0 ? '' : ('n ' + (i === cells.length - 1 ? tint : '')) }, [String(c)]);
        }));
      }))
    ]);
  }

  function tiles(list) {
    return h('div', { class: 'tiles' }, list.map(function (t) {
      return h('div', { class: 'tile' }, [
        h('span', { class: 'tile__k' }, [t[0]]),
        h('span', { class: 'tile__v ' + (t[2] || '') }, [t[1]]),
        t[3] ? h('span', { class: 'tile__n' }, [t[3]]) : null
      ]);
    }));
  }

  /* ---------------------------------------------------------
     Readout rail
     --------------------------------------------------------- */

  function renderReadout() {
    var r = result, mt = r.metrics, v = r.verdict;
    var stamp = document.querySelector('[data-stamp]');
    stamp.setAttribute('data-state', v.state);

    var words = { pass: 'Buy box', watch: 'Watch it', fail: 'Pass on it', idle: 'Working' };
    document.querySelector('[data-verdict-word]').textContent = words[v.state] || 'Working';
    document.querySelector('[data-verdict-sub]').textContent =
      v.total ? v.passed + ' of ' + v.total + ' tests clear' : 'awaiting inputs';

    var isFlip = deal.meta.strategy === 'flip';
    var rows = isFlip
      ? [
          ['Net profit', money(r.flip.profit), tone(r.flip.profit), true],
          ['Cash in', money(r.flip.cashIn), '', false],
          ['Return on cash', pct(r.flip.roi), tone(r.flip.roi), false],
          ['Annualised', pct(r.flip.annualized), tone(r.flip.annualized), false],
          ['Max offer', money(r.flip.mao), '', false],
          ['Market', isFinite(r.market.pct) ? pct(r.market.pct, 0) + ' ' + r.market.grade : '—', '', false]
        ]
      : [
          ['Cash flow', money(mt.cfMonthly) + '/mo', tone(mt.cfMonthly), true],
          ['Net operating income', money(mt.noi), '', false],
          ['Cap rate', pct(mt.capOnPrice, 2), '', false],
          ['Cash-on-cash', pct(mt.coc, 2), tone(mt.coc), false],
          ['Coverage', mult(mt.dscr), mt.dscr >= E.num(deal.box.minDSCR) ? 'pos' : 'neg', false],
          ['Break-even occ.', pct(mt.beOcc), mt.beOcc <= E.num(deal.box.maxBreakEven) ? 'pos' : 'neg', false],
          ['IRR, ' + r.proforma.hold + ' yr', pct(r.proforma.returns.irrBT, 1), tone(r.proforma.returns.irrBT), false],
          ['Cash needed', money(r.cap.cash), '', false],
          ['Market', isFinite(r.market.pct) ? pct(r.market.pct, 0) + ' ' + r.market.grade : '—', '', false]
        ];

    var out = document.querySelector('[data-readout]');
    clear(out);
    rows.forEach(function (row) {
      out.appendChild(h('div', { class: 'rr' + (row[3] ? ' rr--major' : '') }, [
        h('span', { class: 'rr__k' }, [row[0]]),
        h('span', { class: 'rr__v ' + (row[2] || '') }, [row[1]])
      ]));
    });

    var why = document.querySelector('[data-verdict-why]');
    clear(why);
    v.why.slice(0, 5).forEach(function (w) { why.appendChild(h('li', {}, [w])); });
  }

  function renderIncomeMini() {
    var el = document.querySelector('[data-income-mini]');
    if (!el) return;
    var is = result.is, mt = result.metrics;
    clear(el);
    el.appendChild(tiles([
      ['Effective gross', money(is.egi), '', 'After vacancy and credit loss'],
      ['Operating expenses', money(is.opex), '', pct(mt.oer) + ' of effective gross'],
      ['Net operating income', money(is.noi), tone(is.noi), 'Before any debt'],
      ['Expenses vs rent', pct(is.opex / is.gpi * 100), (is.opex / is.gpi * 100) <= 50 ? 'pos' : 'warn', 'The 50% rule']
    ]));
  }

  /* ---------------------------------------------------------
     Recalculate
     --------------------------------------------------------- */

  /* Debounced with a timer rather than requestAnimationFrame: rAF is paused in a
     background tab, which would silently stall the sheet mid-edit. */
  var pending = null;
  function recalc() {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = null;
      result = E.analyze(deal);
      renderReadout();
      renderReturns();
      renderProjection();
      renderStress();
      renderIncomeMini();
      renderCompsOut();
      renderMarketGauge();
      persist();
    }, 16);
  }

  function renderMarketGauge() {
    var pctEl = document.querySelector('[data-mkt-pct]');
    if (!pctEl) return;
    var mk = result.market;
    pctEl.textContent = isFinite(mk.pct) ? Math.round(mk.pct) + '%' : '—';
    document.querySelector('[data-mkt-grade]').textContent = mk.grade;
    document.querySelector('[data-mkt-fill]').style.width = (isFinite(mk.pct) ? mk.pct : 0) + '%';
    document.querySelector('[data-mkt-note]').textContent =
      mk.missing
        ? mk.missing + (mk.missing === 1 ? ' factor is' : ' factors are') + ' unscored and left out of the weighting.'
        : mk.flags.length
          ? 'Heavily weighted factors scoring low: ' + mk.flags.join(', ') + '.'
          : 'No heavily weighted factor is scoring below 3.';
  }

  function renderCompsOut() {
    var el = document.querySelector('[data-comp-out]');
    if (!el) return;
    var c = result.comps;
    clear(el);
    if (c.count) {
      var left = [];
      if (c.distressed) left.push(c.distressed + ' distressed');
      if (c.incomplete) left.push(c.incomplete + ' incomplete');
      el.appendChild(tiles([
        ['Comps used', String(c.count), '', left.length ? 'Left out: ' + left.join(', ') : 'None left out'],
        ['Average adjusted', money2(c.avgPsf) + '/sf', '', 'After your adjustments'],
        ['Indicated value', money(c.indicated), '', 'At ' + count(deal.meta.sqft) + ' sq ft'],
        ['Range', money(c.low) + ' – ' + money(c.high), '', 'Lowest to highest comp']
      ]));
    }

    var rel = document.querySelector('[data-rent-out]');
    clear(rel);
    var rc = result.rentComps;
    if (rc.count) {
      rel.appendChild(tiles([
        ['Rent comps', String(rc.count), '', 'Actually leasing'],
        ['Average rent', money(rc.avgRent), '', 'Straight average'],
        ['Per square foot', isFinite(rc.avgPsf) ? money2(rc.avgPsf) : '—', '', 'Where sizes were given'],
        ['Indicated rent', money(rc.indicated), '', 'At ' + count(deal.meta.sqft) + ' sq ft']
      ]));
    }
  }

  /* ---------------------------------------------------------
     Input binding
     --------------------------------------------------------- */

  document.addEventListener('input', function (e) {
    var el = e.target;
    var path = el.getAttribute && el.getAttribute('data-path');
    if (!path) return;

    if (el.type === 'checkbox') set(path, el.checked);
    else if (el.type === 'number') set(path, el.value === '' ? 0 : parseFloat(el.value));
    else set(path, el.value);

    if (path === 'meta.strategy') { renderReadout(); }
    recalc();
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    var path = el.getAttribute && el.getAttribute('data-path');
    if (!path) return;
    if (el.type === 'checkbox') { set(path, el.checked); recalc(); }
    else if (el.tagName === 'SELECT') { set(path, el.value); recalc(); }
  });

  var nameInput = document.getElementById('deal-name');
  nameInput.addEventListener('input', function () {
    deal.meta.name = nameInput.value;
    persist();
  });

  /* ---------------------------------------------------------
     Header actions
     --------------------------------------------------------- */

  function toast(msg) {
    var t = document.querySelector('[data-toast]');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 2600);
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var head = ['Name', 'Address', 'Type', 'Strategy', 'Price', 'Rehab', 'Cash in', 'Gross rent/mo',
                'NOI', 'Cap on price %', 'Cap all-in %', 'CoC %', 'DSCR', 'Debt yield %',
                'Break-even occ %', 'CF/mo', 'IRR %', 'Equity multiple', 'Market %', 'Verdict', 'Saved'];

    var body = pipeline.map(function (rec) {
      var d = merge(E.defaults(), JSON.parse(JSON.stringify(rec.deal)));
      var r = E.analyze(d);
      function n(x, dp) { return isFinite(x) ? x.toFixed(dp === undefined ? 2 : dp) : ''; }
      return [
        d.meta.name, d.meta.address, d.meta.propType, d.meta.strategy,
        n(d.buy.price, 0), n(d.buy.rehab, 0), n(r.cap.cash, 0), n(d.inc.rentMonthly, 0),
        n(r.metrics.noi, 0), n(r.metrics.capOnPrice), n(r.metrics.capOnBasis), n(r.metrics.coc),
        n(r.metrics.dscr), n(r.metrics.debtYield), n(r.metrics.beOcc), n(r.metrics.cfMonthly, 0),
        n(r.proforma.returns.irrBT), n(r.proforma.returns.equityMultiple),
        n(r.market.pct, 0), r.verdict.state, rec.saved
      ].map(csvCell).join(',');
    });

    if (!body.length) return toast('Nothing saved to export yet.');
    download('deal-lab-pipeline.csv', head.map(csvCell).join(',') + '\n' + body.join('\n'), 'text/csv;charset=utf-8');
    toast('CSV downloaded.');
  }

  function exportJson() {
    download('deal-lab-export.json',
      JSON.stringify({ exported: new Date().toISOString(), current: deal, pipeline: pipeline }, null, 2),
      'application/json');
    toast('JSON downloaded.');
  }

  document.querySelector('[data-act="save"]').addEventListener('click', function () {
    if (!deal.meta.name || deal.meta.name === 'Untitled deal') {
      deal.meta.name = deal.meta.address || ('Deal ' + (pipeline.length + 1));
      nameInput.value = deal.meta.name;
    }
    pipeline.unshift({
      id: 'd' + Date.now() + Math.random().toString(36).slice(2, 7),
      saved: new Date().toISOString().slice(0, 10),
      deal: JSON.parse(JSON.stringify(deal))
    });
    persistPipe();
    toast('Saved "' + deal.meta.name + '" to the pipeline.');
    if (active === 'pipeline') renderPipeline();
  });

  document.querySelector('[data-act="export"]').addEventListener('click', exportJson);

  document.querySelector('[data-act="print"]').addEventListener('click', function () {
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.add('is-on'); });
    renderDiligence();
    renderPipeline();
    window.print();
    setTimeout(function () { show(active); }, 400);
  });

  document.querySelector('[data-act="reset"]').addEventListener('click', function () {
    if (!window.confirm('Reset this deal to the starting figures? Saved pipeline deals are not affected.')) return;
    deal = E.defaults();
    persist();
    rebuildAll();
    toast('Reset to the starting figures.');
  });

  /* ---------------------------------------------------------
     Boot
     --------------------------------------------------------- */

  function rebuildAll() {
    nameInput.value = deal.meta.name || '';
    buildDeal();
    buildMarket();
    buildComps();
    buildIncome();
    buildFinancing();
    buildBox();
    buildImport();
    recalc();
  }

  buildRail();
  rebuildAll();

  var last = null;
  try { last = localStorage.getItem('deallab.panel'); } catch (e) { /* ignore */ }
  show(PANELS.some(function (p) { return p.id === last; }) ? last : 'deal');

})();
