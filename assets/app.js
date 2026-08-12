(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants (derived from full dataset scan; see PRD 6.2 / 6.3)
  // ---------------------------------------------------------------------
  var DEAL_TYPE_NAMES = { 0: '매매', 1: '전세', 2: '월세' };
  var BUDGET_RANGES = {
    0: { min: 6500, max: 2500000, def: 100000 },   // 매매, 만원
    1: { min: 1000, max: 1385000, def: 30000 },    // 전세, 만원
    2: { min: 500, max: 910000, def: 30000 }        // 월세 환산보증금, 만원
  };
  var AREA_PY_MIN = 3;
  var AREA_PY_MAX = 97;
  var PY_PER_M2 = 1 / 3.3058;
  var PAGE_SIZE = 50;
  var SLIDER_STEPS = 1000;
  var BLUE_LIGHT = [247, 251, 255];   // blue-99
  var BLUE_DARK = [0, 102, 255];      // blue-50
  var NO_DATA_COLOR = '#DCDCDC';      // neutral-95

  // ---------------------------------------------------------------------
  // Global data stores
  // ---------------------------------------------------------------------
  var summary = null;             // data/summary.json
  var mapData = null;             // data/seoul-map.json
  var summaryByCode = {};
  var rowsByDealType = { 0: [], 1: [], 2: [] };
  var loadedGuSet = new Set();
  var pathByCode = {};
  var lastFiltered = [];
  var lastGuStats = {};
  var rafPending = false;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  function defaultState() {
    return {
      dealType: 1,
      budget: BUDGET_RANGES[1].def,
      areaMin: AREA_PY_MIN,
      areaMax: AREA_PY_MAX,
      guCodes: new Set(),
      period: 12,
      excludeLowFloor: false,
      sort: 'priceAsc',
      mapMetric: 'count',
      page: 1
    };
  }
  var state = defaultState();

  // ---------------------------------------------------------------------
  // URL sync
  // ---------------------------------------------------------------------
  function parseStateFromURL() {
    var p = new URLSearchParams(location.search);
    var t = parseInt(p.get('t'), 10);
    if (t === 0 || t === 1 || t === 2) state.dealType = t;

    var range = BUDGET_RANGES[state.dealType];
    var b = parseInt(p.get('b'), 10);
    if (!isNaN(b)) state.budget = clamp(b, range.min, range.max);
    else state.budget = range.def;

    var amin = parseInt(p.get('amin'), 10);
    var amax = parseInt(p.get('amax'), 10);
    if (!isNaN(amin)) state.areaMin = clamp(amin, AREA_PY_MIN, AREA_PY_MAX);
    if (!isNaN(amax)) state.areaMax = clamp(amax, AREA_PY_MIN, AREA_PY_MAX);
    if (state.areaMin > state.areaMax) {
      var tmp = state.areaMin; state.areaMin = state.areaMax; state.areaMax = tmp;
    }

    var gu = p.get('gu');
    if (gu) {
      state.guCodes = new Set(gu.split(',').filter(Boolean));
    }

    var period = parseInt(p.get('p'), 10);
    if (period === 3 || period === 6 || period === 12) state.period = period;

    state.excludeLowFloor = p.get('f') === '1';

    var sort = p.get('s');
    if (['priceAsc', 'priceDesc', 'dateDesc', 'areaDesc'].indexOf(sort) !== -1) state.sort = sort;

    var metric = p.get('m');
    if (metric === 'count' || metric === 'median') state.mapMetric = metric;

    var pg = parseInt(p.get('pg'), 10);
    if (!isNaN(pg) && pg > 0) state.page = pg;
  }

  function updateURL() {
    var p = new URLSearchParams();
    p.set('t', state.dealType);
    p.set('b', state.budget);
    p.set('amin', state.areaMin);
    p.set('amax', state.areaMax);
    if (state.guCodes.size) p.set('gu', Array.from(state.guCodes).join(','));
    p.set('p', state.period);
    if (state.excludeLowFloor) p.set('f', '1');
    p.set('s', state.sort);
    p.set('m', state.mapMetric);
    if (state.page > 1) p.set('pg', state.page);
    var newUrl = location.pathname + '?' + p.toString();
    history.replaceState(null, '', newUrl);
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatEok(manwon) {
    if (manwon === null || manwon === undefined || isNaN(manwon)) return '-';
    if (Math.abs(manwon) >= 10000) {
      var eok = manwon / 10000;
      var rounded = Math.round(eok * 10) / 10;
      var str = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return str + '억';
    }
    return Math.round(manwon).toLocaleString('ko-KR') + '만';
  }

  function formatAmountForRow(row) {
    if (row.dealType === 2) {
      return formatEok(row.amount) + ' + ' + row.monthlyRent.toLocaleString('ko-KR') + '만';
    }
    return formatEok(row.amount);
  }

  function formatFloor(floor) {
    if (floor > 0) return floor + '층';
    if (floor < 0) return '지하' + (-floor) + '층';
    return '층 정보 없음';
  }

  function formatDate(yymmdd) {
    if (!yymmdd || yymmdd.length !== 6) return yymmdd;
    return '20' + yymmdd.slice(0, 2) + '-' + yymmdd.slice(2, 4) + '-' + yymmdd.slice(4, 6);
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
  }

  function computeCutoffDate(months) {
    if (months >= 12 || !summary) return '000000';
    var parts = summary.meta.periodEnd.split('-');
    var endY = parseInt(parts[0], 10), endM = parseInt(parts[1], 10);
    var m = endM - (months - 1);
    var y = endY;
    while (m <= 0) { m += 12; y -= 1; }
    var yy = String(y % 100).padStart(2, '0');
    var mm = String(m).padStart(2, '0');
    return yy + mm + '01';
  }

  // log-scale slider <-> budget value mapping
  function budgetToSlider(value, range) {
    var t = Math.log(value / range.min) / Math.log(range.max / range.min);
    return Math.round(clamp(t, 0, 1) * SLIDER_STEPS);
  }
  function sliderToBudget(sliderVal, range) {
    var t = sliderVal / SLIDER_STEPS;
    return Math.round(range.min * Math.pow(range.max / range.min, t));
  }

  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
  }
  function interpolateColor(rgbA, rgbB, t) {
    t = clamp(t, 0, 1);
    var c = rgbA.map(function (v, i) { return Math.round(v + (rgbB[i] - v) * t); });
    return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  }
  function colorScale(value, min, max) {
    if (value === null || value === undefined) return NO_DATA_COLOR;
    if (max <= min) return value > 0 ? interpolateColor(BLUE_LIGHT, BLUE_DARK, 1) : NO_DATA_COLOR;
    var t = (value - min) / (max - min);
    return interpolateColor(BLUE_LIGHT, BLUE_DARK, t);
  }

  // ---------------------------------------------------------------------
  // Data ingestion
  // ---------------------------------------------------------------------
  function ingestGuData(data) {
    var code = data.code, name = data.name;
    var dongs = data.dongs, complexes = data.complexes;
    var rows = data.rows;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var dealType = r[4];
      var amount = r[5];
      var monthlyRent = r[6];
      var areaM2 = r[2];
      rowsByDealType[dealType].push({
        gu: code,
        guName: name,
        dong: dongs[r[0]],
        complex: complexes[r[1]],
        areaM2: areaM2,
        areaPy: areaM2 * PY_PER_M2,
        floor: r[3],
        dealType: dealType,
        amount: amount,
        monthlyRent: monthlyRent,
        value: dealType === 2 ? amount + monthlyRent * 100 : amount,
        date: r[7]
      });
    }
  }

  function loadAllGuData() {
    var codes = mapData.districts.map(function (d) { return d.code; });
    var total = codes.length;
    var loaded = 0;
    updateLoadingNote(loaded, total);
    var promises = codes.map(function (code) {
      return fetch('data/gu/' + code + '.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          ingestGuData(data);
          loadedGuSet.add(code);
          loaded++;
          updateLoadingNote(loaded, total);
          scheduleRecompute();
        })
        .catch(function (err) {
          console.error('구 데이터 로드 실패:', code, err);
          loaded++;
          updateLoadingNote(loaded, total);
        });
    });
    return Promise.all(promises).then(function () {
      updateLoadingNote(total, total);
      recomputeAndRender();
    });
  }

  function updateLoadingNote(loaded, total) {
    var el = document.getElementById('map-loading-note');
    if (!el) return;
    if (loaded >= total) {
      el.textContent = '';
    } else {
      el.textContent = '구 데이터 불러오는 중 ' + loaded + '/' + total;
    }
  }

  // ---------------------------------------------------------------------
  // Filtering / aggregation core
  // ---------------------------------------------------------------------
  function scheduleRecompute() {
    // Recompute is a cheap single-pass scan (well under the 100ms budget),
    // so we run it synchronously. requestAnimationFrame was tried here but
    // browsers can stall rAF callbacks for backgrounded/non-visible tabs,
    // which delayed map/list/URL updates unpredictably.
    recomputeAndRender();
  }

  function recomputeAndRender() {
    var cutoff = computeCutoffDate(state.period);
    var rows = rowsByDealType[state.dealType];
    var budget = state.budget;
    var areaMin = state.areaMin, areaMax = state.areaMax;
    var guFilter = state.guCodes;
    var excludeLowFloor = state.excludeLowFloor;

    var filtered = [];
    var guStats = {};

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.value > budget) continue;
      if (r.areaPy < areaMin || r.areaPy > areaMax) continue;
      if (r.date < cutoff) continue;
      if (excludeLowFloor && r.floor < 2) continue;

      var gs = guStats[r.gu];
      if (!gs) { gs = guStats[r.gu] = { count: 0, values: [] }; guStats[r.gu] = gs; }
      gs.count++;
      gs.values.push(r.value);

      if (guFilter.size === 0 || guFilter.has(r.gu)) {
        filtered.push(r);
      }
    }

    lastFiltered = filtered;
    lastGuStats = guStats;

    renderMap(guStats);
    renderSummary(filtered);
    state.page = clampPage(state.page, filtered.length);
    renderListPage(filtered);
    updateURL();
  }

  function clampPage(page, total) {
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    return clamp(page, 1, totalPages);
  }

  function computeMinBudgetIgnoringBudget() {
    var rows = rowsByDealType[state.dealType];
    var cutoff = computeCutoffDate(state.period);
    var min = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.areaPy < state.areaMin || r.areaPy > state.areaMax) continue;
      if (r.date < cutoff) continue;
      if (state.excludeLowFloor && r.floor < 2) continue;
      if (state.guCodes.size > 0 && !state.guCodes.has(r.gu)) continue;
      if (r.value < min) min = r.value;
    }
    return min === Infinity ? null : min;
  }

  // ---------------------------------------------------------------------
  // Map rendering
  // ---------------------------------------------------------------------
  function buildMapPaths() {
    var svg = document.getElementById('seoul-map');
    svg.setAttribute('viewBox', mapData.viewBox);
    mapData.districts.forEach(function (d) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d.path);
      path.setAttribute('data-code', d.code);
      path.setAttribute('fill', NO_DATA_COLOR);
      svg.appendChild(path);
      pathByCode[d.code] = path;
    });
    mapData.districts.forEach(function (d) {
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', d.cx);
      text.setAttribute('y', d.cy);
      text.textContent = d.name.replace(/(구)$/, '');
      svg.appendChild(text);
    });
  }

  function renderMap(guStats) {
    if (!mapData) return;
    var typeName = DEAL_TYPE_NAMES[state.dealType];
    var values = {};
    var provisional = {};

    mapData.districts.forEach(function (d) {
      var code = d.code;
      var stat = guStats[code];
      var v;
      if (stat) {
        v = state.mapMetric === 'count' ? stat.count : median(stat.values);
      } else if (!loadedGuSet.has(code)) {
        var s = summaryByCode[code];
        v = s ? (state.mapMetric === 'count' ? s.counts[typeName] : s.median[typeName]) : null;
        provisional[code] = true;
      } else {
        v = 0;
      }
      values[code] = v;
    });

    var nums = Object.keys(values).map(function (k) { return values[k]; }).filter(function (v) { return v !== null && v !== undefined; });
    var min = nums.length ? Math.min.apply(null, nums) : 0;
    var max = nums.length ? Math.max.apply(null, nums) : 0;

    mapData.districts.forEach(function (d) {
      var el = pathByCode[d.code];
      if (!el) return;
      var v = values[d.code];
      el.setAttribute('fill', colorScale(v, min, max));
      el.style.opacity = provisional[d.code] ? '0.55' : '1';
      el.classList.toggle('selected', state.guCodes.has(d.code));
    });

    renderLegend(min, max);
  }

  function renderLegend(min, max) {
    var el = document.getElementById('map-legend');
    var steps = 5;
    var html = '';
    for (var i = 0; i < steps; i++) {
      var t = i / (steps - 1);
      var v = min + t * (max - min);
      var color = colorScale(v, min, max);
      var label = state.mapMetric === 'count'
        ? Math.round(v).toLocaleString('ko-KR') + '건'
        : formatEok(Math.round(v));
      html += '<span class="legend-item"><span class="legend-swatch" style="background:' + color + '"></span>' + label + '</span>';
    }
    html += '<span class="legend-item" style="margin-left:4px;"><span class="legend-swatch" style="background:' + NO_DATA_COLOR + '"></span>데이터 없음/0건</span>';
    el.innerHTML = html;
  }

  var tooltipEl = null;
  function setupMapInteractions() {
    var svg = document.getElementById('seoul-map');
    tooltipEl = document.getElementById('map-tooltip');

    svg.addEventListener('click', function (e) {
      var path = e.target.closest('path');
      if (!path) return;
      var code = path.getAttribute('data-code');
      toggleGu(code);
    });

    svg.addEventListener('mousemove', function (e) {
      var path = e.target.closest('path');
      if (!path) { hideTooltip(); return; }
      var code = path.getAttribute('data-code');
      showTooltip(code, e.clientX, e.clientY);
    });

    svg.addEventListener('mouseleave', hideTooltip);
  }

  function showTooltip(code, x, y) {
    var typeName = DEAL_TYPE_NAMES[state.dealType];
    var stat = lastGuStats[code];
    var name = (summaryByCode[code] && summaryByCode[code].name) || code;
    var count, med;
    if (stat) {
      count = stat.count;
      med = median(stat.values);
    } else if (!loadedGuSet.has(code) && summaryByCode[code]) {
      count = summaryByCode[code].counts[typeName];
      med = summaryByCode[code].median[typeName];
    } else {
      count = 0; med = 0;
    }
    tooltipEl.innerHTML = '<strong>' + esc(name) + '</strong>' +
      typeName + ' ' + count.toLocaleString('ko-KR') + '건 · 중앙값 ' + formatEok(med);
    tooltipEl.classList.remove('hidden');
    var left = x + 14, top = y + 14;
    tooltipEl.style.left = left + 'px';
    tooltipEl.style.top = top + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.add('hidden');
  }

  // ---------------------------------------------------------------------
  // Gu chips
  // ---------------------------------------------------------------------
  function buildGuChips() {
    var list = document.getElementById('gu-chip-list');
    summary.gu.slice().sort(function (a, b) { return a.code.localeCompare(b.code); }).forEach(function (g) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.code = g.code;
      btn.textContent = g.name;
      list.appendChild(btn);
    });
    list.addEventListener('click', function (e) {
      var btn = e.target.closest('button.chip');
      if (!btn) return;
      var code = btn.dataset.code;
      if (code === '') {
        state.guCodes.clear();
      } else {
        if (state.guCodes.has(code)) state.guCodes.delete(code);
        else state.guCodes.add(code);
      }
      state.page = 1;
      syncGuUI();
      scheduleRecompute();
    });
  }

  function toggleGu(code) {
    if (state.guCodes.has(code)) state.guCodes.delete(code);
    else state.guCodes.add(code);
    state.page = 1;
    syncGuUI();
    scheduleRecompute();
  }

  function syncGuUI() {
    var list = document.getElementById('gu-chip-list');
    var buttons = list.querySelectorAll('button.chip');
    buttons.forEach(function (btn) {
      var code = btn.dataset.code;
      if (code === '') {
        btn.classList.toggle('active', state.guCodes.size === 0);
      } else {
        btn.classList.toggle('active', state.guCodes.has(code));
      }
    });
    var countEl = document.getElementById('gu-selected-count');
    countEl.textContent = state.guCodes.size > 0 ? '(' + state.guCodes.size + '개 선택)' : '';
    mapData && mapData.districts.forEach(function (d) {
      var el = pathByCode[d.code];
      if (el) el.classList.toggle('selected', state.guCodes.has(d.code));
    });
  }

  // ---------------------------------------------------------------------
  // Summary card
  // ---------------------------------------------------------------------
  function renderSummary(filtered) {
    var el = document.getElementById('summary-body');
    if (filtered.length === 0) {
      var minBudget = computeMinBudgetIgnoringBudget();
      var hint;
      if (minBudget !== null && minBudget > state.budget) {
        hint = '예산을 <strong>' + formatEok(minBudget) + '</strong>까지 올리면 결과가 나옵니다.';
      } else if (minBudget === null) {
        hint = '면적 · 자치구 · 거래 시점 조건을 완화해보세요.';
      } else {
        hint = '다른 조건을 조정해보세요.';
      }
      el.innerHTML = '<div class="summary-empty">조건에 맞는 거래가 없습니다.<span class="hint">' + hint + '</span></div>';
      return;
    }

    var values = filtered.map(function (r) { return r.value; });
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var min = sorted[0];
    var med = median(values);

    var dongCounts = {};
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var key = r.gu + '|' + r.guName + '|' + r.dong;
      dongCounts[key] = (dongCounts[key] || 0) + 1;
    }
    var topKey = null, topCount = 0;
    Object.keys(dongCounts).forEach(function (k) {
      if (dongCounts[k] > topCount) { topCount = dongCounts[k]; topKey = k; }
    });
    var topGuName = '', topDong = '';
    if (topKey) {
      var parts = topKey.split('|');
      topGuName = parts[1]; topDong = parts[2];
    }

    el.innerHTML =
      '<div class="summary-headline">조건에 맞는 거래 <span class="accent">' + filtered.length.toLocaleString('ko-KR') + '건</span>' +
      ' · 최저 <span class="accent">' + formatEok(min) + '</span>' +
      ' · 중앙값 <span class="accent">' + formatEok(med) + '</span></div>' +
      (topKey ? '<div class="summary-sub">가장 매물이 많은 동네: <strong>' + esc(topGuName) + ' ' + esc(topDong) + '</strong> (' + topCount.toLocaleString('ko-KR') + '건)</div>' : '');
  }

  // ---------------------------------------------------------------------
  // Result list + pagination
  // ---------------------------------------------------------------------
  function sortRows(arr, sortKey) {
    var copy = arr.slice();
    switch (sortKey) {
      case 'priceAsc': copy.sort(function (a, b) { return a.value - b.value; }); break;
      case 'priceDesc': copy.sort(function (a, b) { return b.value - a.value; }); break;
      case 'dateDesc': copy.sort(function (a, b) { return b.date.localeCompare(a.date); }); break;
      case 'areaDesc': copy.sort(function (a, b) { return b.areaM2 - a.areaM2; }); break;
    }
    return copy;
  }

  function renderListPage(filtered) {
    var countEl = document.getElementById('list-count');
    var bodyEl = document.getElementById('list-body');
    var total = filtered.length;

    countEl.innerHTML = '조건에 맞는 거래 <span class="accent">' + total.toLocaleString('ko-KR') + '건</span>';

    if (total === 0) {
      bodyEl.innerHTML = '<div class="list-empty">조건에 맞는 거래가 없습니다. 위 요약의 안내를 참고해 조건을 완화해보세요.</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    var sorted = sortRows(filtered, state.sort);
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = clamp(state.page, 1, totalPages);
    var start = (state.page - 1) * PAGE_SIZE;
    var pageRows = sorted.slice(start, start + PAGE_SIZE);

    var html = pageRows.map(function (r) {
      return '<div class="result-row">' +
        '<div class="row-top">' +
        '<span class="complex-name">' + esc(r.complex) + '</span>' +
        '<span class="amount">' + formatAmountForRow(r) + '</span>' +
        '</div>' +
        '<div class="row-meta">' +
        '<span>' + esc(r.guName) + ' · ' + esc(r.dong) + '</span>' +
        '<span>' + r.areaM2.toFixed(1) + '㎡ (' + r.areaPy.toFixed(1) + '평)</span>' +
        '<span>' + formatFloor(r.floor) + '</span>' +
        '<span>' + formatDate(r.date) + '</span>' +
        '</div></div>';
    }).join('');
    bodyEl.innerHTML = html;

    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    var el = document.getElementById('pagination');
    if (totalPages <= 1) { el.innerHTML = ''; return; }
    var html = '';
    html += '<button data-page="' + (state.page - 1) + '" ' + (state.page <= 1 ? 'disabled' : '') + '>이전</button>';
    var windowSize = 5;
    var start = Math.max(1, state.page - 2);
    var end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    for (var i = start; i <= end; i++) {
      html += '<button data-page="' + i + '" class="' + (i === state.page ? 'active' : '') + '">' + i + '</button>';
    }
    html += '<button data-page="' + (state.page + 1) + '" ' + (state.page >= totalPages ? 'disabled' : '') + '>다음</button>';
    html += '<span class="page-info">' + state.page + ' / ' + totalPages + '</span>';
    el.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Filter UI wiring
  // ---------------------------------------------------------------------
  function setSegmentedActive(containerId, value) {
    var container = document.getElementById(containerId);
    container.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.value === String(value));
    });
  }

  function syncBudgetUI() {
    var range = BUDGET_RANGES[state.dealType];
    var slider = document.getElementById('budget-slider');
    var input = document.getElementById('budget-input');
    var label = document.getElementById('budget-value');
    slider.value = budgetToSlider(state.budget, range);
    input.value = (state.budget / 10000).toFixed(1).replace(/\.0$/, '');
    label.textContent = formatEok(state.budget) + ' 이하';
  }

  function syncAreaUI() {
    var minSlider = document.getElementById('area-min-slider');
    var maxSlider = document.getElementById('area-max-slider');
    var label = document.getElementById('area-value');
    var fill = document.getElementById('area-track-fill');
    minSlider.value = state.areaMin;
    maxSlider.value = state.areaMax;
    if (state.areaMin <= AREA_PY_MIN && state.areaMax >= AREA_PY_MAX) {
      label.textContent = '전체';
    } else {
      label.textContent = state.areaMin + '평 ~ ' + state.areaMax + '평 (' +
        Math.round(state.areaMin / PY_PER_M2) + '~' + Math.round(state.areaMax / PY_PER_M2) + '㎡)';
    }
    var total = AREA_PY_MAX - AREA_PY_MIN;
    var leftPct = ((state.areaMin - AREA_PY_MIN) / total) * 100;
    var rightPct = ((state.areaMax - AREA_PY_MIN) / total) * 100;
    fill.style.left = leftPct + '%';
    fill.style.width = (rightPct - leftPct) + '%';
  }

  function syncFloorCheckbox() {
    document.getElementById('floor-exclude-checkbox').checked = state.excludeLowFloor;
  }

  function syncSortSelect() {
    document.getElementById('sort-select').value = state.sort;
  }

  function syncMapMetricToggle() {
    setSegmentedActive('map-metric-toggle', state.mapMetric);
  }

  function syncAllUIFromState() {
    setSegmentedActive('deal-type-toggle', state.dealType);
    syncBudgetUI();
    syncAreaUI();
    syncGuUI();
    setSegmentedActive('period-toggle', state.period);
    syncFloorCheckbox();
    syncSortSelect();
    syncMapMetricToggle();
  }

  function setDealType(newType) {
    if (state.dealType === newType) return;
    state.dealType = newType;
    var range = BUDGET_RANGES[newType];
    state.budget = range.def;
    state.page = 1;
    setSegmentedActive('deal-type-toggle', newType);
    syncBudgetUI();
    scheduleRecompute();
  }

  function attachEventListeners() {
    document.getElementById('deal-type-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      setDealType(parseInt(btn.dataset.value, 10));
    });

    var budgetSlider = document.getElementById('budget-slider');
    budgetSlider.addEventListener('input', function () {
      var range = BUDGET_RANGES[state.dealType];
      state.budget = sliderToBudget(parseInt(budgetSlider.value, 10), range);
      state.page = 1;
      document.getElementById('budget-value').textContent = formatEok(state.budget) + ' 이하';
      document.getElementById('budget-input').value = (state.budget / 10000).toFixed(1).replace(/\.0$/, '');
      scheduleRecompute();
    });

    var budgetInput = document.getElementById('budget-input');
    budgetInput.addEventListener('change', function () {
      var range = BUDGET_RANGES[state.dealType];
      var eok = parseFloat(budgetInput.value);
      if (isNaN(eok)) eok = range.def / 10000;
      var manwon = clamp(Math.round(eok * 10000), range.min, range.max);
      state.budget = manwon;
      state.page = 1;
      syncBudgetUI();
      scheduleRecompute();
    });

    var areaMinSlider = document.getElementById('area-min-slider');
    var areaMaxSlider = document.getElementById('area-max-slider');
    areaMinSlider.addEventListener('input', function () {
      var v = parseInt(areaMinSlider.value, 10);
      if (v > state.areaMax) v = state.areaMax;
      state.areaMin = v;
      state.page = 1;
      syncAreaUI();
      scheduleRecompute();
    });
    areaMaxSlider.addEventListener('input', function () {
      var v = parseInt(areaMaxSlider.value, 10);
      if (v < state.areaMin) v = state.areaMin;
      state.areaMax = v;
      state.page = 1;
      syncAreaUI();
      scheduleRecompute();
    });

    document.getElementById('period-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      state.period = parseInt(btn.dataset.value, 10);
      state.page = 1;
      setSegmentedActive('period-toggle', state.period);
      scheduleRecompute();
    });

    document.getElementById('floor-exclude-checkbox').addEventListener('change', function (e) {
      state.excludeLowFloor = e.target.checked;
      state.page = 1;
      scheduleRecompute();
    });

    document.getElementById('map-metric-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('button'); if (!btn) return;
      state.mapMetric = btn.dataset.value;
      setSegmentedActive('map-metric-toggle', state.mapMetric);
      renderMap(lastGuStats);
      updateURL();
    });

    document.getElementById('sort-select').addEventListener('change', function (e) {
      state.sort = e.target.value;
      state.page = 1;
      renderListPage(lastFiltered);
      updateURL();
    });

    document.getElementById('pagination').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-page]'); if (!btn) return;
      var page = parseInt(btn.dataset.page, 10);
      if (isNaN(page)) return;
      state.page = page;
      renderListPage(lastFiltered);
      updateURL();
      document.getElementById('list-body').scrollIntoView({ block: 'nearest' });
    });

    document.getElementById('reset-filters').addEventListener('click', function () {
      state = defaultState();
      syncAllUIFromState();
      scheduleRecompute();
    });

    setupMapInteractions();
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  function init() {
    parseStateFromURL();

    Promise.all([
      fetch('data/summary.json').then(function (r) { return r.json(); }),
      fetch('data/seoul-map.json').then(function (r) { return r.json(); })
    ]).then(function (results) {
      summary = results[0];
      mapData = results[1];
      summary.gu.forEach(function (g) { summaryByCode[g.code] = g; });

      buildGuChips();
      buildMapPaths();
      syncAllUIFromState();
      renderMap({});
      attachEventListeners();

      return loadAllGuData();
    }).catch(function (err) {
      console.error('초기 데이터 로드 실패:', err);
      document.getElementById('list-body').innerHTML = '<div class="list-empty">데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</div>';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
