(function () {
  'use strict';

  var BRAND_NAMES = ['Medicube', 'COSRX', 'Beauty of Joseon', 'Anua', 'Torriden', 'Round Lab'];
  var TIER_ORDER = ['nano', 'micro', 'mid', 'macro', 'mega'];
  var TIER_LABEL = { nano: '나노', micro: '마이크로', mid: '미드', macro: '매크로', mega: '메가' };
  var MEDICUBE_ID = 0;

  // 콘텐츠 성향 — 고정 인덱스(데이터 계약). 성분·과학/피부고민/정직리뷰가 메디큐브(더모코스메틱)
  // 결에 맞는 성향이다.
  var THEME_LABELS = ['성분·과학', '피부고민', '정직리뷰', '하울·쇼핑', '루틴', '메이크업'];
  var DERMO_THEME_IDS = [0, 1, 2];

  var DATA_DIR = 'data/';

  // 메디큐브 현황 스탯 타일 -> 영상/채널 탭 필터 적용을 위한 공유 인터페이스.
  // initVideoExplorer/initChannelExplorer가 채워 넣고, renderBaseline의 타일
  // 클릭 핸들러가 사용한다 (서로 다른 클로저라 직접 호출할 수 없어 이 방식으로 연결).
  var explorerAPI = { video: null, channel: null };

  // -------------------------------------------------------------- helpers

  function tierOf(subs) {
    if (subs < 1000) return 'nano';
    if (subs < 10000) return 'micro';
    if (subs < 100000) return 'mid';
    if (subs < 500000) return 'macro';
    return 'mega';
  }

  function parseYYMMDD(s) {
    if (!s || s.length < 6) return null;
    var yy = parseInt(s.slice(0, 2), 10);
    var mm = parseInt(s.slice(2, 4), 10);
    var dd = parseInt(s.slice(4, 6), 10);
    return new Date(2000 + yy, mm - 1, dd);
  }

  function formatDate(s) {
    var d = parseYYMMDD(s);
    if (!d) return '-';
    return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  }

  function formatNum(n) {
    if (n === null || n === undefined) return '-';
    return Math.round(n).toLocaleString('ko-KR');
  }

  function formatPct(n) {
    if (n === null || n === undefined) return null;
    return n.toFixed(2) + '%';
  }

  function formatX(n) {
    if (n === null || n === undefined) return null;
    return n.toFixed(2) + '배';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  // 표 안 인라인 막대. ratio는 0~1로 미리 계산해서 넘긴다 (스케일 선택은 호출부 책임).
  function barCell(valueNode, ratio, isMedicube) {
    var wrap = el('span', { class: 'cell-bar' });
    var fill = el('span', { class: 'bar-fill ' + (isMedicube ? 'bar-accent' : 'bar-neutral') });
    fill.style.width = (Math.max(0, Math.min(1, ratio || 0)) * 100).toFixed(1) + '%';
    var text = el('span', { class: 'bar-text' }, [valueNode]);
    wrap.appendChild(fill);
    wrap.appendChild(text);
    return wrap;
  }

  function sqrtRatio(value, max) {
    if (!max || max <= 0) return 0;
    return Math.sqrt(Math.max(0, value)) / Math.sqrt(max);
  }

  function linearRatio(value, max) {
    if (!max || max <= 0) return 0;
    return Math.max(0, value) / max;
  }

  // 배경색 위 텍스트 대비를 실제로 계산해서 흰 글자/먹색 글자 중 4.5:1을 넘는 쪽을
  // 고른다. 둘 다 못 넘으면 null을 반환해 "숫자를 생략하고 툴팁으로" 처리한다.
  function relLumRGB(rgbStr) {
    var m = rgbStr.match(/\d+(\.\d+)?/g);
    if (!m) return null;
    function lin(c) { c = c / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  }
  function contrastOf(rgbA, rgbB) {
    var la = relLumRGB(rgbA), lb = relLumRGB(rgbB);
    if (la === null || lb === null) return 0;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function bestLabelColorOn(el) {
    var bg = getComputedStyle(el).backgroundColor;
    var white = contrastOf(bg, 'rgb(255,255,255)');
    var dark = contrastOf(bg, 'rgb(62,58,57)'); // --on-soft
    if (white >= 4.5 && white >= dark) return 'white';
    if (dark >= 4.5) return 'dark';
    return null;
  }

  function rankDesc(list, key) {
    // returns map id -> rank (1 = highest value). Ties share rank order by id for stability.
    var sorted = list.slice().sort(function (a, b) { return (b[key] || 0) - (a[key] || 0); });
    var ranks = {};
    sorted.forEach(function (item, i) { ranks[item.id] = i + 1; });
    return ranks;
  }

  // -------------------------------------------------------------- tooltip

  var tooltipEl = document.getElementById('tooltip');
  function showTooltip(x, y, html) {
    tooltipEl.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) tooltipEl.appendChild(wrap.firstChild);
    tooltipEl.style.left = (x + 14) + 'px';
    tooltipEl.style.top = (y + 14) + 'px';
    tooltipEl.classList.add('show');
  }
  function hideTooltip() { tooltipEl.classList.remove('show'); }

  // ------------------------------------------------------------- loading

  // no-cache: 데이터 파일이 재빌드될 때마다 갱신되므로 매번 서버에 재검증한다
  // (파일명이 고정이라 브라우저 캐시가 낡은 스냅샷을 계속 재사용하는 걸 막는다).
  var FETCH_OPTS = { cache: 'no-cache' };

  Promise.all([
    fetch(DATA_DIR + 'videos.json', FETCH_OPTS).then(function (r) { return r.json(); }),
    fetch(DATA_DIR + 'channels.json', FETCH_OPTS).then(function (r) { return r.json(); }),
    fetch(DATA_DIR + 'brands.json', FETCH_OPTS).then(function (r) { return r.json(); }),
    fetch(DATA_DIR + 'removed.json', FETCH_OPTS).then(function (r) { return r.json(); })
  ]).then(function (results) {
    boot(results[0], results[1], results[2], results[3]);
  }).catch(function (err) {
    document.getElementById('loading-state').textContent = '데이터를 불러오지 못했습니다: ' + err.message;
    console.error(err);
  });

  // ---------------------------------------------------------------- boot

  function boot(videosData, channelsData, brandsData, removedData) {
    var app = document.getElementById('app');
    var tpl = document.getElementById('tpl-main');
    app.innerHTML = '';
    app.appendChild(tpl.content.cloneNode(true));
    app.removeAttribute('aria-busy');

    var NOW = new Date(videosData.meta.builtAt);

    var channelsNames = videosData.channels;
    var titles = videosData.titles;
    var n = videosData.videos.length;

    // 데이터 팀이 videos.json에 순수 추가 중인 필드. 아직 없거나 길이가 안 맞으면
    // 해당 기능만 조용히 꺼진다 (화면이 깨지지 않게 방어적으로 처리).
    var titlesKo = Array.isArray(videosData.titlesKo) && videosData.titlesKo.length === n ? videosData.titlesKo : null;
    var hashtagsArr = Array.isArray(videosData.hashtags) && videosData.hashtags.length === n ? videosData.hashtags : null;
    var themesArr = Array.isArray(videosData.themes) && videosData.themes.length === n ? videosData.themes : null;
    var isPRArr = Array.isArray(videosData.isPR) && videosData.isPR.length === n ? videosData.isPR : null;

    var rows = videosData.videos.map(function (r, i) {
      return {
        videoId: r[0],
        channelIdx: r[1],
        channelName: channelsNames[r[1]],
        brand: r[2],
        subscribers: r[3],
        views: r[4],
        likes: r[5],
        comments: r[6],
        engagement: r[7],
        vsExpected: r[8],
        date: r[9],
        isShorts: r[10] === 1,
        title: titles[i],
        titleKo: titlesKo ? titlesKo[i] : null,
        hashtags: hashtagsArr ? hashtagsArr[i] : [],
        themes: themesArr ? themesArr[i] : [],
        isPR: isPRArr ? isPRArr[i] === 1 : false,
        tier: tierOf(r[3]),
        viewSubRatio: r[3] > 0 ? r[4] / r[3] : null,
        isRatioOutlier: r[3] > 0 && r[3] < 1000 && (r[4] / r[3]) > 300
      };
    });

    var DATA_FLAGS = {
      titlesKo: !!titlesKo,
      hashtags: !!hashtagsArr,
      themes: !!themesArr,
      isPR: !!isPRArr,
      channelDermo: channelsData.channels.length > 0 && typeof channelsData.channels[0].dermoRatio === 'number',
      channelThemeDist: channelsData.channels.length > 0 && Array.isArray(channelsData.channels[0].themeDist),
      channelTopTags: channelsData.channels.length > 0 && Array.isArray(channelsData.channels[0].topTags),
      channelPrCount: channelsData.channels.length > 0 && typeof channelsData.channels[0].prCount === 'number'
    };

    // 상위 해시태그 20개: meta.topHashtags가 있으면 쓰고, 없으면 클라이언트에서 직접 집계한다
    // (build_beauty.py는 건드리지 않는다).
    var topHashtags = [];
    if (videosData.meta && Array.isArray(videosData.meta.topHashtags) && videosData.meta.topHashtags.length) {
      topHashtags = videosData.meta.topHashtags;
    } else if (DATA_FLAGS.hashtags) {
      var tagCounts = {};
      rows.forEach(function (r) { r.hashtags.forEach(function (tag) { tagCounts[tag] = (tagCounts[tag] || 0) + 1; }); });
      topHashtags = Object.keys(tagCounts).map(function (tag) { return { tag: tag, count: tagCounts[tag] }; })
        .sort(function (a, b) { return b.count - a.count; });
    }

    document.getElementById('meta-period').textContent =
      videosData.meta.periodStart + '~' + videosData.meta.periodEnd + ', 정제 후 ' + videosData.meta.totalClean + '건 (원본 ' + videosData.meta.totalRaw + '건 중 ' + videosData.meta.removed + '건 제거)';

    var brandsList = brandsData.brands.map(function (b) {
      return {
        id: b.id,
        name: BRAND_NAMES[b.id] || b.name,
        videoCount: b.videoCount,
        channelCount: b.channelCount,
        engagementMedian: b.engagementMedian,
        viewsMedian: b.viewsMedian,
        tierDist: b.tierDist
      };
    });

    var newCandidateCount = channelsData.channels.filter(function (c) { return !c.medicubePartner; }).length;

    renderBaseline(brandsList, newCandidateCount);
    renderBrandTable(brandsList);
    renderScatter(brandsList);
    renderTierBars(brandsList);
    initStandardization(rows);
    initTabs();
    initVideoExplorer(rows, NOW, DATA_FLAGS, topHashtags);
    initChannelExplorer(channelsData.channels, NOW, DATA_FLAGS);
    initRemovedPanel(removedData.removed);
    initThemeToggle();
  }

  // -------------------------------------------------- 영상/채널 탭 전환

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#block-lists [role="tab"]'));

    function select(tab, focus) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute('aria-selected', selected ? 'true' : 'false');
        t.tabIndex = selected ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(tab, false); });
      tab.addEventListener('keydown', function (evt) {
        var targetIndex = null;
        if (evt.key === 'ArrowRight' || evt.key === 'ArrowDown') targetIndex = (i + 1) % tabs.length;
        else if (evt.key === 'ArrowLeft' || evt.key === 'ArrowUp') targetIndex = (i - 1 + tabs.length) % tabs.length;
        else if (evt.key === 'Home') targetIndex = 0;
        else if (evt.key === 'End') targetIndex = tabs.length - 1;
        if (targetIndex !== null) {
          evt.preventDefault();
          select(tabs[targetIndex], true);
        }
      });
    });
  }

  // --------------------------------------------------------- 5.1 baseline

  function renderBaseline(brandsList, newCandidateCount) {
    var medicube = brandsList.filter(function (b) { return b.id === MEDICUBE_ID; })[0];
    var rankVideo = rankDesc(brandsList, 'videoCount');
    var rankChannel = rankDesc(brandsList, 'channelCount');
    var rankEng = rankDesc(brandsList, 'engagementMedian');
    var rankViews = rankDesc(brandsList, 'viewsMedian');

    var stats = [
      { label: '협업 영상 수', value: formatNum(medicube.videoCount) + '건', rank: rankVideo[medicube.id], action: 'videoCount', hint: '해당 영상 보기' },
      { label: '협업 채널 수', value: formatNum(medicube.channelCount) + '개', rank: rankChannel[medicube.id], action: 'channelCount', hint: '해당 채널 보기' },
      { label: '참여율 중앙값', value: formatPct(medicube.engagementMedian), rank: rankEng[medicube.id], action: 'engagementMedian', hint: '해당 영상 보기' },
      { label: '조회수 중앙값', value: formatNum(medicube.viewsMedian) + '회', rank: rankViews[medicube.id], action: 'viewsMedian', hint: '해당 영상 보기' }
    ];

    var grid = document.getElementById('baseline-stats');
    stats.forEach(function (s) {
      var rankSpan = el('span', { class: 'rank' }, [
        document.createTextNode('6개 브랜드 중 '),
        el('span', { class: 'rank-num', text: String(s.rank) }),
        document.createTextNode('위')
      ]);
      var tile = el('button', {
        type: 'button',
        class: 'stat-tile',
        'aria-label': s.label + ' ' + s.value + '. ' + s.hint
      }, [
        el('span', { class: 'label', text: s.label }),
        el('span', { class: 'value', text: s.value }),
        rankSpan,
        el('span', { class: 'stat-tile-hint', 'aria-hidden': 'true', text: s.hint })
      ]);
      tile.addEventListener('click', function () { handleStatTileClick(s.action); });
      grid.appendChild(tile);
    });

    // 진단(강점) -> 처방(다음 레버) -> 행동(구체적 후보) 순서.
    // "~하지만 N위" 같은 역접 판정 구문은 쓰지 않는다. 순위 자체는 스탯 타일에
    // 그대로 남겨 숨기지 않는다. 짧은 문장, 마침표로 끊기, 대시/콜론 미사용.
    var reachText;
    if (rankChannel[medicube.id] === 1 && rankVideo[medicube.id] === 1) {
      reachText = '채널 ' + formatNum(medicube.channelCount) + '개, 영상 ' + formatNum(medicube.videoCount) + '건으로 모두 1위입니다.';
    } else if (rankChannel[medicube.id] === 1) {
      reachText = '채널 ' + formatNum(medicube.channelCount) + '개로 1위입니다. 영상은 ' + formatNum(medicube.videoCount) + '건으로 ' + rankVideo[medicube.id] + '위입니다.';
    } else if (rankVideo[medicube.id] === 1) {
      reachText = '영상 ' + formatNum(medicube.videoCount) + '건으로 1위입니다. 채널은 ' + formatNum(medicube.channelCount) + '개로 ' + rankChannel[medicube.id] + '위입니다.';
    } else {
      reachText = '채널 ' + formatNum(medicube.channelCount) + '개(' + rankChannel[medicube.id] + '위), 영상 ' + formatNum(medicube.videoCount) + '건(' + rankVideo[medicube.id] + '위)입니다.';
    }

    var engRank = rankEng[medicube.id];
    var leverText = engRank === 1
      ? '건당 참여율도 이미 1위입니다. 다음 레버는 폭을 유지하며 상위권을 지키는 것입니다.'
      : '다음 레버는 폭이 아니라 선택입니다. 건당 참여율은 채널 규모를 보정해도 개선 여지가 남습니다.';

    var summary = document.getElementById('baseline-summary');
    summary.innerHTML = '';
    summary.appendChild(document.createTextNode('메디큐브는 가장 넓게 협업합니다. '));
    var strong1 = document.createElement('strong');
    strong1.textContent = reachText;
    summary.appendChild(strong1);
    summary.appendChild(document.createTextNode(' ' + leverText + ' 경쟁사와만 일한 ' + formatNum(newCandidateCount) + '개 채널이 첫 후보입니다.'));
  }

  // 스탯 타일 클릭 -> 해당 탭으로 전환하고 필터를 적용한 뒤 그 위치로 스크롤한다.
  function switchToTab(tabId) {
    var tab = document.getElementById(tabId);
    if (!tab) return;
    if (tab.getAttribute('aria-selected') !== 'true') tab.click();
    var panel = document.getElementById(tab.getAttribute('aria-controls'));
    if (panel) panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function handleStatTileClick(action) {
    if (action === 'videoCount') {
      if (explorerAPI.video) explorerAPI.video.applyMedicubeOnly(null);
      switchToTab('tab-videos');
    } else if (action === 'channelCount') {
      if (explorerAPI.channel) explorerAPI.channel.applyPartnerOnly();
      switchToTab('tab-channels');
    } else if (action === 'engagementMedian') {
      if (explorerAPI.video) explorerAPI.video.applyMedicubeOnly('engagement');
      switchToTab('tab-videos');
    } else if (action === 'viewsMedian') {
      if (explorerAPI.video) explorerAPI.video.applyMedicubeOnly('views');
      switchToTab('tab-videos');
    }
  }

  // ----------------------------------------------------- 5.2 brand table

  function renderBrandTable(brandsList) {
    var tbody = document.querySelector('#brand-table tbody');
    brandsList.forEach(function (b) {
      var ratio = (b.videoCount / b.channelCount).toFixed(2);
      var tr = el('tr', { class: b.id === MEDICUBE_ID ? 'is-medicube' : '' }, [
        el('td', {}, [
          b.id === MEDICUBE_ID
            ? el('span', {}, [document.createTextNode(b.name + ' '), el('span', { class: 'badge badge-accent', text: '자사' })])
            : document.createTextNode(b.name)
        ]),
        el('td', { text: formatNum(b.videoCount) + '건' }),
        el('td', { text: formatNum(b.channelCount) + '개' }),
        el('td', { text: ratio }),
        el('td', { text: formatPct(b.engagementMedian) || '데이터 없음' }),
        el('td', { text: formatNum(b.viewsMedian) + '회' })
      ]);
      tbody.appendChild(tr);
    });
  }

  // -------------------------------------------------------- 5.2 scatter

  function renderScatter(brandsList) {
    var svg = document.getElementById('brand-scatter');
    var W = 760, H = 420;
    var padL = 64, padR = 36, padT = 28, padB = 56;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var xs = brandsList.map(function (b) { return b.channelCount; });
    var ys = brandsList.map(function (b) { return b.engagementMedian || 0; });
    var xMax = Math.max.apply(null, xs) * 1.15;
    var yMax = Math.max.apply(null, ys) * 1.2;
    var xMin = 0, yMin = 0;

    function px(x) { return padL + (x - xMin) / (xMax - xMin) * plotW; }
    function py(y) { return padT + plotH - (y - yMin) / (yMax - yMin) * plotH; }

    // grid + axes
    var yTicks = 4;
    for (var i = 0; i <= yTicks; i++) {
      var yVal = yMax * i / yTicks;
      var yy = py(yVal);
      svg.appendChild(svgEl('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yy, y2: yy }));
      var t = svgEl('text', { class: 'axis-label', x: padL - 8, y: yy + 4, 'text-anchor': 'end' });
      t.textContent = yVal.toFixed(1) + '%';
      svg.appendChild(t);
    }
    var xTicks = 5;
    for (var j = 0; j <= xTicks; j++) {
      var xVal = xMax * j / xTicks;
      var xx = px(xVal);
      var tx = svgEl('text', { class: 'axis-label', x: xx, y: H - padB + 18, 'text-anchor': 'middle' });
      tx.textContent = Math.round(xVal);
      svg.appendChild(tx);
    }
    var axLabelX = svgEl('text', { class: 'axis-title', x: padL + plotW / 2, y: H - 10, 'text-anchor': 'middle' });
    axLabelX.textContent = '협업 채널 수 (개)';
    svg.appendChild(axLabelX);
    var axLabelY = svgEl('text', { class: 'axis-title', x: 16, y: padT + plotH / 2, 'text-anchor': 'middle', transform: 'rotate(-90 16 ' + (padT + plotH / 2) + ')' });
    axLabelY.textContent = '참여율 중앙값 (%)';
    svg.appendChild(axLabelY);

    // points
    var pts = brandsList.map(function (b) {
      return { id: b.id, name: b.name, x: px(b.channelCount), y: py(b.engagementMedian || 0), raw: b };
    });

    // simple label collision avoidance: default above the dot, nudge apart
    // when x-proximate labels would overlap vertically.
    var placed = pts.map(function (p) { return { p: p, ly: p.y - 18, side: 'above' }; });
    placed.sort(function (a, b) { return a.p.x - b.p.x; });
    for (var pass = 0; pass < 3; pass++) {
      for (var a = 0; a < placed.length; a++) {
        for (var bI = a + 1; bI < placed.length; bI++) {
          var A = placed[a], B = placed[bI];
          if (Math.abs(A.p.x - B.p.x) < 90 && Math.abs(A.ly - B.ly) < 17) {
            A.ly -= 9;
            B.ly += 9;
          }
        }
      }
    }
    // clamp labels within plot vertical bounds
    placed.forEach(function (pl) {
      if (pl.ly < padT + 6) pl.ly = padT + 6;
      if (pl.ly > H - padB - 6) pl.ly = H - padB - 6;
    });

    placed.forEach(function (pl) {
      var p = pl.p;
      var isMedicube = p.id === MEDICUBE_ID;

      if (isMedicube) {
        // 후광: 메디큐브 점 하나에만 쓰는 강조 면 (accent-soft)
        var halo = svgEl('circle', { class: 'pt-halo', cx: p.x, cy: p.y, r: 20 });
        halo.style.fill = 'var(--accent-soft)';
        halo.style.opacity = '0.55';
        svg.appendChild(halo);
      }

      var dot = svgEl('circle', {
        class: 'pt-dot', cx: p.x, cy: p.y, r: isMedicube ? 10 : 7
      });
      dot.style.fill = isMedicube ? 'var(--accent)' : 'var(--neutral-mark)';
      svg.appendChild(dot);

      var hit = svgEl('circle', { class: 'pt-hit', cx: p.x, cy: p.y, r: 20 });
      hit.addEventListener('pointermove', function (evt) {
        showTooltip(evt.clientX, evt.clientY,
          '<span class="tt-label">' + p.name + '</span><br>' +
          '<span class="tt-value">채널 ' + formatNum(p.raw.channelCount) + '개, ' + (formatPct(p.raw.engagementMedian) || '참여율 데이터 없음') + '</span>');
      });
      hit.addEventListener('pointerleave', hideTooltip);
      svg.appendChild(hit);

      var label = svgEl('text', {
        class: 'pt-label', x: p.x, y: pl.ly, 'text-anchor': 'middle'
      });
      label.style.fill = isMedicube ? 'var(--accent-text)' : 'var(--ink)';
      label.style.fontWeight = isMedicube ? '600' : '500';
      label.textContent = p.name;
      svg.appendChild(label);
    });
  }

  // ------------------------------------------------------- 5.2 tier bars

  function renderTierBars(brandsList) {
    var legend = document.getElementById('tier-legend');
    legend.appendChild(el('span', { class: 'muted', text: '순서: ' }));
    TIER_ORDER.forEach(function (t, i) {
      legend.appendChild(el('span', {}, [
        el('span', { class: 'sw', style: 'background:var(--tier-' + t + ')' }),
        document.createTextNode(TIER_LABEL[t])
      ]));
    });

    var rows = document.getElementById('tier-rows');
    var pendingLabelSegs = []; // {seg, count, pctWidth} — 붙인 뒤(연결된 DOM에서) 대비 계산

    brandsList.forEach(function (b) {
      var total = TIER_ORDER.reduce(function (sum, t) { return sum + (b.tierDist[t] || 0); }, 0) || 1;
      var bar = el('div', { class: 'tier-bar' });
      TIER_ORDER.forEach(function (t) {
        var count = b.tierDist[t] || 0;
        if (count === 0) return;
        var pctWidth = (count / total * 100).toFixed(2);
        var seg = el('div', { class: 'seg', style: 'width:' + pctWidth + '%;background:var(--tier-' + t + ')' });

        seg.addEventListener('pointermove', function (evt) {
          showTooltip(evt.clientX, evt.clientY,
            '<span class="tt-label">' + b.name + ' ' + TIER_LABEL[t] + ' 구간</span><br>' +
            '<span class="tt-value">' + count + '건</span> (' + pctWidth + '%)');
        });
        seg.addEventListener('pointerleave', hideTooltip);
        bar.appendChild(seg);

        if (parseFloat(pctWidth) >= 8) {
          pendingLabelSegs.push({ seg: seg, count: count });
        }
      });
      // 세그먼트가 좁아 막대 안에 숫자가 안 들어갈 수 있으므로, 5개 티어 수치를
      // 막대 아래에 항상 별도로 나열한다 (생략되는 숫자가 없게).
      var breakdown = el('div', { class: 'tier-breakdown' });
      TIER_ORDER.forEach(function (t, i) {
        if (i > 0) breakdown.appendChild(document.createTextNode(' · '));
        breakdown.appendChild(el('span', {}, [
          document.createTextNode(TIER_LABEL[t] + ' '),
          el('span', { class: 'tier-breakdown-num', text: String(b.tierDist[t] || 0) })
        ]));
      });

      var barWrap = el('div', { class: 'tier-bar-wrap' }, [bar, breakdown]);

      var row = el('div', { class: 'tier-row' + (b.id === MEDICUBE_ID ? ' is-medicube' : '') }, [
        el('span', { class: 'tr-label', text: b.name + (b.id === MEDICUBE_ID ? ' (자사)' : '') }),
        barWrap,
        el('span', { class: 'tier-total', text: '총 ' + total + '건' })
      ]);
      rows.appendChild(row);
    });

    // 이제 모든 세그먼트가 연결된 DOM에 있으므로 실제 배경색을 읽어 대비를 계산한다.
    // 세그먼트가 좁거나(8% 미만) 어느 텍스트 색도 4.5:1을 못 넘기면 숫자를 생략하고
    // 툴팁으로만 안내한다.
    pendingLabelSegs.forEach(function (item) {
      var labelColor = bestLabelColorOn(item.seg);
      if (!labelColor) return;
      if (labelColor === 'dark') item.seg.classList.add('seg-light');
      item.seg.appendChild(el('span', { class: 'seg-label', text: String(item.count) }));
    });
  }

  // ------------------------------------------- 5.2 규모 보정 비교 (client-side)

  function medianSorted(arr) {
    if (!arr.length) return null;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
  }

  function initStandardization(allRows) {
    var toggle = document.getElementById('stdz-toggle');
    var panel = document.getElementById('stdz-panel');

    // 참여율이 null이 아닌 영상만 사용 (요건 1).
    var rows = allRows.filter(function (r) { return r.engagement !== null && r.engagement !== undefined; });

    // 표준 구성 = 전체(참여율 존재) 영상의 티어별 비중.
    var tierCounts = {};
    TIER_ORDER.forEach(function (t) { tierCounts[t] = 0; });
    rows.forEach(function (r) { tierCounts[r.tier] += 1; });
    var total = rows.length;
    var stdComp = {};
    TIER_ORDER.forEach(function (t) { stdComp[t] = tierCounts[t] / total; });

    // 브랜드 x 티어 median + n, 브랜드별 원본 median, 규모보정 median.
    var brandStats = BRAND_NAMES.map(function (name, bIdx) {
      var brandRows = rows.filter(function (r) { return r.brand === bIdx; });
      var rawMedian = medianSorted(brandRows.map(function (r) { return r.engagement; }));

      var tierMedian = {}, tierN = {};
      TIER_ORDER.forEach(function (t) {
        var tv = brandRows.filter(function (r) { return r.tier === t; }).map(function (r) { return r.engagement; });
        tierN[t] = tv.length;
        tierMedian[t] = medianSorted(tv);
      });

      var num = 0, den = 0;
      TIER_ORDER.forEach(function (t) {
        if (tierMedian[t] !== null) {
          num += tierMedian[t] * stdComp[t];
          den += stdComp[t];
        }
      });
      var stdMedian = den ? num / den : null;

      return { id: bIdx, name: name, rawMedian: rawMedian, stdMedian: stdMedian, tierMedian: tierMedian, tierN: tierN };
    });

    // 원본 vs 규모보정 비교 표
    var compareBody = document.querySelector('#stdz-compare-table tbody');
    compareBody.innerHTML = '';
    brandStats.forEach(function (b) {
      var tr = el('tr', { class: b.id === MEDICUBE_ID ? 'is-medicube' : '' }, [
        el('td', {}, [document.createTextNode(b.name + (b.id === MEDICUBE_ID ? ' ' : '')), b.id === MEDICUBE_ID ? el('span', { class: 'badge badge-accent', text: '자사' }) : null]),
        el('td', { text: formatPct(b.rawMedian) || '데이터 없음' }),
        el('td', { text: formatPct(b.stdMedian) || '데이터 없음' })
      ]);
      compareBody.appendChild(tr);
    });

    // 매트릭스 표 헤더
    var headRow = document.getElementById('stdz-matrix-head');
    TIER_ORDER.forEach(function (t) {
      headRow.appendChild(el('th', { text: TIER_LABEL[t] + ' (' + (stdComp[t] * 100).toFixed(0) + '%)' }));
    });

    var matrixBody = document.querySelector('#stdz-matrix-table tbody');
    matrixBody.innerHTML = '';
    brandStats.forEach(function (b) {
      var tr = el('tr', { class: b.id === MEDICUBE_ID ? 'is-medicube' : '' });
      tr.appendChild(el('td', { text: b.name }));
      TIER_ORDER.forEach(function (t) {
        var n = b.tierN[t];
        var med = b.tierMedian[t];
        var cellText = med === null ? '-' : formatPct(med) + ' (n=' + n + ')';
        var td = el('td', { text: cellText });
        if (n > 0 && n < 10) {
          td.style.opacity = '0.55';
          td.style.fontStyle = 'italic';
          td.title = '표본 ' + n + '건, 신뢰도 낮음';
        }
        tr.appendChild(td);
      });
      matrixBody.appendChild(tr);
    });

    document.getElementById('stdz-conclusion').textContent =
      '보정해도 순위가 유지됩니다. 채널 구성이 아니라 선택의 문제입니다.';

    toggle.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.arrow').textContent = open ? '▴' : '▾';
    });
  }

  // ------------------------------------------------------------ pagination

  var PAGE_SIZE = 50;

  function renderPagination(containerId, page, totalPages, total, rangeElId, onChange) {
    var container = document.getElementById(containerId);
    container.innerHTML = '';
    if (total === 0 || totalPages <= 1) return;

    function pageBtn(label, targetPage, opts) {
      opts = opts || {};
      var btn = el('button', { type: 'button', text: label });
      if (opts.disabled) btn.disabled = true;
      if (opts.current) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', function () { onChange(targetPage); });
      return btn;
    }

    container.appendChild(pageBtn('이전', page - 1, { disabled: page === 1 }));
    for (var p = 1; p <= totalPages; p++) {
      container.appendChild(pageBtn(String(p), p, { current: p === page }));
    }
    container.appendChild(pageBtn('다음', page + 1, { disabled: page === totalPages }));
  }

  // -------------------------------------------------------- FLIP row move

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Replaces tbody's rows with newRows. When animate is true (and motion is
  // allowed), rows that persist across the change (matched by data-key)
  // slide from their old screen position to their new one instead of
  // popping instantly, so a re-sort reads as movement rather than a swap.
  function replaceTableRows(tbody, newRows, animate) {
    if (!animate || prefersReducedMotion()) {
      tbody.innerHTML = '';
      newRows.forEach(function (r) { tbody.appendChild(r); });
      return;
    }

    var firstTop = {};
    Array.prototype.forEach.call(tbody.children, function (tr) {
      var key = tr.getAttribute('data-key');
      if (key) firstTop[key] = tr.getBoundingClientRect().top;
    });

    tbody.innerHTML = '';
    newRows.forEach(function (r) { tbody.appendChild(r); });

    Array.prototype.forEach.call(tbody.children, function (tr) {
      var key = tr.getAttribute('data-key');
      if (!key || !(key in firstTop)) return;
      var dy = firstTop[key] - tr.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      tr.style.transition = 'none';
      tr.style.transform = 'translateY(' + dy + 'px)';
      /* eslint-disable-next-line no-unused-expressions */
      tr.offsetHeight; // force reflow so the transform above is committed before transitioning
      requestAnimationFrame(function () {
        tr.style.transition = 'transform 250ms ease-out';
        tr.style.transform = '';
        tr.addEventListener('transitionend', function cleanup() {
          tr.style.transition = '';
          tr.removeEventListener('transitionend', cleanup);
        });
      });
    });
  }

  // ---------------------------------------------------- 5.3 video explorer

  function initVideoExplorer(rows, NOW, DATA_FLAGS, topHashtags) {
    var state = {
      metric: 'engagement',
      brands: new Set(BRAND_NAMES.map(function (_, i) { return i; })),
      tier: '',
      period: '',
      excludeShorts: false,
      excludeRatioOutliers: false,
      themes: new Set(), // 비어 있으면 전체 표시. 하나라도 고르면 OR 매칭.
      tag: null,
      sortDir: 'desc',
      page: 1
    };

    // 콘텐츠 성향 필터 — themes 필드가 있을 때만 노출한다.
    var themeButtons = [];
    if (DATA_FLAGS.themes) {
      var themeFilterEl = document.getElementById('video-theme-filter');
      THEME_LABELS.forEach(function (label, idx) {
        var btn = el('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': 'false', 'data-theme': idx, text: label });
        btn.addEventListener('click', function () {
          if (state.themes.has(idx)) {
            state.themes.delete(idx);
            btn.setAttribute('aria-pressed', 'false');
          } else {
            state.themes.add(idx);
            btn.setAttribute('aria-pressed', 'true');
          }
          state.page = 1; render();
        });
        themeFilterEl.appendChild(btn);
        themeButtons.push(btn);
      });
    } else {
      document.getElementById('video-theme-filter-row').hidden = true;
    }

    // 태그 필터 — 상위 20개 칩 + 검색(335종은 다 보여줄 수 없으므로).
    // selectTag는 buildRow(행 안의 태그 칩)에서도 써야 하므로 initVideoExplorer
    // 최상위 스코프에 var로 선언해 클로저로 공유한다 (strict 모드에서 블록 안
    // function 선언은 블록 스코프라 바깥에서 못 본다).
    var selectTag = null;
    if (DATA_FLAGS.hashtags && topHashtags.length) {
      var tagFilterEl = document.getElementById('video-tag-filter');
      var top20 = topHashtags.slice(0, 20);

      selectTag = function (tag) {
        state.tag = tag;
        state.page = 1;
        document.getElementById('video-tag-active-chip').textContent = '#' + tag;
        document.getElementById('video-tag-active').hidden = false;
        render();
      };

      top20.forEach(function (item) {
        var chip = el('button', { type: 'button', class: 'tag-chip', text: '#' + item.tag + ' (' + item.count + ')' });
        chip.addEventListener('click', function () { selectTag(item.tag); });
        tagFilterEl.appendChild(chip);
      });

      var searchWrap = el('span', { style: 'display:inline-flex; align-items:center; gap:8px;' });
      var searchInput = el('input', { type: 'text', class: 'tag-search-input', placeholder: '태그 검색 (전체 ' + topHashtags.length + '종)' });
      var searchResults = el('div', { class: 'tag-search-results' });
      searchInput.addEventListener('input', function () {
        var q = this.value.trim().toLowerCase();
        searchResults.innerHTML = '';
        if (!q) return;
        topHashtags.filter(function (item) { return item.tag.toLowerCase().indexOf(q) !== -1; })
          .slice(0, 15)
          .forEach(function (item) {
            var chip = el('button', { type: 'button', class: 'tag-chip', text: '#' + item.tag + ' (' + item.count + ')' });
            chip.addEventListener('click', function () { selectTag(item.tag); searchInput.value = ''; searchResults.innerHTML = ''; });
            searchResults.appendChild(chip);
          });
      });
      searchWrap.appendChild(searchInput);
      tagFilterEl.appendChild(searchWrap);
      tagFilterEl.appendChild(searchResults);

      document.getElementById('video-tag-clear').addEventListener('click', function () {
        state.tag = null;
        state.page = 1;
        document.getElementById('video-tag-active').hidden = true;
        render();
      });
    } else {
      document.getElementById('video-tag-filter-row').hidden = true;
    }

    var brandFilterEl = document.getElementById('video-brand-filter');
    var brandButtons = [];
    BRAND_NAMES.forEach(function (name, idx) {
      var btn = el('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': 'true', 'data-brand': idx, text: name });
      btn.addEventListener('click', function () {
        if (state.brands.has(idx)) {
          state.brands.delete(idx);
          btn.setAttribute('aria-pressed', 'false');
        } else {
          state.brands.add(idx);
          btn.setAttribute('aria-pressed', 'true');
        }
        state.page = 1; render();
      });
      brandFilterEl.appendChild(btn);
      brandButtons.push(btn);
    });

    document.getElementById('metric-toggle').addEventListener('click', function (evt) {
      var btn = evt.target.closest('button[data-metric]');
      if (!btn) return;
      state.metric = btn.getAttribute('data-metric');
      state.sortDir = 'desc';
      state.page = 1;
      Array.prototype.forEach.call(this.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      var head = document.getElementById('video-metric-head');
      head.textContent = ({ engagement: '참여율', vsExpected: '기대치 대비', views: '조회수' })[state.metric];
      head.title = state.metric !== 'engagement'
        ? '이 열의 막대는 제곱근 스케일입니다. 편차가 커서 선형 막대는 비교에 도움이 되지 않습니다.'
        : '';
      var arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '▼';
      head.appendChild(arrow);
      document.getElementById('vsexpected-note').style.display = state.metric === 'vsExpected' ? 'block' : 'none';
      render(true);
    });

    document.getElementById('video-tier-filter').addEventListener('change', function () {
      state.tier = this.value; state.page = 1; render();
    });
    document.getElementById('video-period-filter').addEventListener('change', function () {
      state.period = this.value; state.page = 1; render();
    });
    document.getElementById('video-shorts-exclude').addEventListener('change', function () {
      state.excludeShorts = this.checked; state.page = 1; render();
    });
    document.getElementById('video-outlier-exclude').addEventListener('change', function () {
      state.excludeRatioOutliers = this.checked; state.page = 1; render();
    });
    document.getElementById('video-metric-head').addEventListener('click', function () {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      state.page = 1;
      var arrow = this.querySelector('.arrow');
      if (arrow) arrow.textContent = state.sortDir === 'desc' ? '▼' : '▲';
      render(true);
    });

    function setMetricUI(metric) {
      state.metric = metric;
      state.sortDir = 'desc';
      var metricBtn = document.querySelector('#metric-toggle button[data-metric="' + metric + '"]');
      Array.prototype.forEach.call(document.querySelectorAll('#metric-toggle button'), function (b) {
        b.setAttribute('aria-pressed', b === metricBtn ? 'true' : 'false');
      });
      var head = document.getElementById('video-metric-head');
      head.textContent = ({ engagement: '참여율', vsExpected: '기대치 대비', views: '조회수' })[metric];
      head.title = metric !== 'engagement'
        ? '이 열의 막대는 제곱근 스케일입니다. 편차가 커서 선형 막대는 비교에 도움이 되지 않습니다.'
        : '';
      var arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '▼';
      head.appendChild(arrow);
      document.getElementById('vsexpected-note').style.display = metric === 'vsExpected' ? 'block' : 'none';
    }

    // 스탯 타일에서 넘어온 "메디큐브만" 필터. 기존 필터는 전부 초기화하고 이 조건만 적용한다.
    document.getElementById('video-stat-filter-clear').addEventListener('click', function () {
      document.getElementById('video-stat-filter-banner').hidden = true;
      state.brands = new Set(BRAND_NAMES.map(function (_, i) { return i; }));
      brandButtons.forEach(function (b) { b.setAttribute('aria-pressed', 'true'); });
      setMetricUI('engagement');
      state.page = 1;
      render();
    });

    explorerAPI.video = {
      applyMedicubeOnly: function (sortMetric) {
        state.tier = ''; document.getElementById('video-tier-filter').value = '';
        state.period = ''; document.getElementById('video-period-filter').value = '';
        state.excludeShorts = false; document.getElementById('video-shorts-exclude').checked = false;
        state.excludeRatioOutliers = false; document.getElementById('video-outlier-exclude').checked = false;
        state.themes = new Set();
        themeButtons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        state.tag = null;
        document.getElementById('video-tag-active').hidden = true;

        state.brands = new Set([MEDICUBE_ID]);
        brandButtons.forEach(function (b) {
          var idx = parseInt(b.getAttribute('data-brand'), 10);
          b.setAttribute('aria-pressed', idx === MEDICUBE_ID ? 'true' : 'false');
        });

        if (sortMetric) setMetricUI(sortMetric);

        state.page = 1;

        var bannerText = '메디큐브 영상만 표시 중입니다';
        if (sortMetric === 'engagement') bannerText += ' (참여율 기준 정렬)';
        else if (sortMetric === 'views') bannerText += ' (조회수 기준 정렬)';
        document.getElementById('video-stat-filter-text').textContent = bannerText;
        document.getElementById('video-stat-filter-banner').hidden = false;

        render(true);
      }
    };

    function metricValue(row) {
      if (state.metric === 'engagement') return row.engagement;
      if (state.metric === 'vsExpected') return row.vsExpected;
      return row.views;
    }

    function render(animate) {
      var filtered = rows.filter(function (r) {
        if (!state.brands.has(r.brand)) return false;
        if (state.tier && r.tier !== state.tier) return false;
        if (state.excludeShorts && r.isShorts) return false;
        if (state.excludeRatioOutliers && r.isRatioOutlier) return false;
        if (state.themes.size > 0) {
          var matchesAnyTheme = r.themes.some(function (t) { return state.themes.has(t); });
          if (!matchesAnyTheme) return false;
        }
        if (state.tag && r.hashtags.indexOf(state.tag) === -1) return false;
        if (state.period) {
          var d = parseYYMMDD(r.date);
          if (!d) return false;
          var months = (NOW.getFullYear() - d.getFullYear()) * 12 + (NOW.getMonth() - d.getMonth());
          if (months > parseInt(state.period, 10)) return false;
        }
        return true;
      });

      var withMetric = [];
      var withoutMetric = [];
      filtered.forEach(function (r) {
        var v = metricValue(r);
        if (v === null || v === undefined) withoutMetric.push(r);
        else withMetric.push(r);
      });

      withMetric.sort(function (a, b) {
        var av = metricValue(a), bv = metricValue(b);
        return state.sortDir === 'desc' ? bv - av : av - bv;
      });
      withoutMetric.sort(function (a, b) {
        var da = parseYYMMDD(a.date), db = parseYYMMDD(b.date);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      });

      var displayList = withMetric.concat(withoutMetric);
      var total = displayList.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (state.page > totalPages) state.page = totalPages;
      if (state.page < 1) state.page = 1;
      var start = (state.page - 1) * PAGE_SIZE;
      var end = Math.min(start + PAGE_SIZE, total);
      var pageItems = displayList.slice(start, end);

      var tbody = document.getElementById('video-tbody');

      // 막대 기준값: 현재 페이지가 아니라 현재 필터 결과 전체(filtered)의 최댓값.
      // 페이지를 넘겨도 막대 길이의 기준이 바뀌지 않도록 한다.
      var viewsMax = filtered.length ? Math.max.apply(null, filtered.map(function (r) { return r.views; })) : 0;
      var metricVals = withMetric.map(metricValue);
      var metricMax = metricVals.length ? Math.max.apply(null, metricVals) : 0;
      var metricUsesSqrt = state.metric === 'vsExpected' || state.metric === 'views';

      function metricCell(r) {
        var v = metricValue(r);
        if (v === null || v === undefined) return null;
        if (state.metric === 'engagement') return formatPct(v);
        if (state.metric === 'vsExpected') return formatX(v);
        return formatNum(v) + '회';
      }

      function hasHangul(s) { return /[가-힣]/.test(s); }

      function buildRow(r) {
        var mCell = metricCell(r);
        var titleChildren = [document.createTextNode(r.title)];
        var titleLink = el('a', {
          href: 'https://youtube.com/watch?v=' + r.videoId,
          target: '_blank', rel: 'noopener', title: r.title
        }, titleChildren);
        var titleTdChildren = [titleLink];

        // 한국어 기계 번역 — 원제가 이미 한국어면 중복 표시하지 않는다.
        if (r.titleKo && r.titleKo.trim() && r.titleKo !== r.title && !hasHangul(r.title)) {
          titleTdChildren.push(el('span', { class: 'cell-title-ko', title: r.titleKo, text: r.titleKo }));
        }

        // 성향 배지 + 광고 배지 — themes/isPR 필드가 실제로 있을 때만 그린다.
        var badgeChildren = [];
        if (DATA_FLAGS.themes) {
          if (r.themes.length) {
            r.themes.forEach(function (t) {
              badgeChildren.push(el('span', { class: 'theme-badge', text: THEME_LABELS[t] || ('성향 ' + t) }));
            });
          } else {
            badgeChildren.push(el('span', { class: 'theme-badge theme-badge-unclassified', text: '미분류' }));
          }
        }
        if (DATA_FLAGS.isPR && r.isPR) badgeChildren.push(el('span', { class: 'badge-pr', text: '광고' }));
        if (badgeChildren.length) titleTdChildren.push(el('div', { class: 'theme-badges' }, badgeChildren));

        // 해시태그 — 최대 4개 + 나머지는 +N, 클릭하면 태그로 필터링
        if (r.hashtags && r.hashtags.length) {
          var tagWrap = el('div', { class: 'cell-tags' });
          r.hashtags.slice(0, 4).forEach(function (tag) {
            var chip = el('button', { type: 'button', class: 'tag-chip', text: '#' + tag });
            if (selectTag) chip.addEventListener('click', function (evt) { evt.stopPropagation(); selectTag(tag); });
            tagWrap.appendChild(chip);
          });
          if (r.hashtags.length > 4) {
            tagWrap.appendChild(el('span', { class: 'tag-chip tag-chip-more', text: '+' + (r.hashtags.length - 4) }));
          }
          titleTdChildren.push(tagWrap);
        }

        var titleTd = el('td', { class: 'cell-title' }, titleTdChildren);
        var isMedicube = r.brand === MEDICUBE_ID;

        var viewsBar = barCell(document.createTextNode(formatNum(r.views) + '회'), sqrtRatio(r.views, viewsMax), isMedicube);

        var metricCellContent;
        if (mCell === null) {
          metricCellContent = el('span', { class: 'na', text: '데이터 없음' });
        } else {
          var mVal = metricValue(r);
          var mRatio = metricUsesSqrt ? sqrtRatio(mVal, metricMax) : linearRatio(mVal, metricMax);
          var textNode = document.createTextNode(mCell);
          if (r.isRatioOutlier) {
            var wrapSpan = el('span', {}, [textNode, el('span', {
              class: 'badge badge-warn',
              style: 'margin-left:6px;',
              title: '조회수가 구독자 수의 ' + r.viewSubRatio.toFixed(1) + '배입니다. 구독자 수 수집 시점과 조회수 누적 기간이 어긋나면 이 비율이 과장됩니다.',
              text: '구독자 대비 이상'
            })]);
            metricCellContent = barCell(wrapSpan, mRatio, isMedicube);
          } else {
            metricCellContent = barCell(textNode, mRatio, isMedicube);
          }
        }

        var tr = el('tr', { class: isMedicube ? 'is-medicube' : '', 'data-key': r.videoId }, [
          titleTd,
          el('td', { text: r.channelName }),
          el('td', { text: BRAND_NAMES[r.brand] }),
          el('td', { class: 'col-num', text: formatNum(r.subscribers) }),
          el('td', { class: 'col-num' }, [viewsBar]),
          el('td', { class: 'col-num' }, [metricCellContent]),
          el('td', { text: formatDate(r.date) })
        ]);
        return tr;
      }

      var newRows = [];
      pageItems.forEach(function (r, i) {
        if (state.metric === 'engagement' && withoutMetric.length && (start + i) === withMetric.length) {
          newRows.push(el('tr', { class: 'na-group-head' }, [
            el('td', { colspan: '7', text: '참여율 데이터 없음 (' + withoutMetric.length + '건, 좋아요/댓글 결측)' })
          ]));
        }
        newRows.push(buildRow(r));
      });
      replaceTableRows(tbody, newRows, animate);

      var rangeText = total === 0 ? '0건' : (start + 1) + '-' + end + ' / ' + total + '건';
      document.getElementById('video-count').textContent =
        rangeText + ' (전체 ' + rows.length + '건 중)' +
        (state.metric === 'engagement' && withoutMetric.length ? ', 참여율 데이터 없음 ' + withoutMetric.length + '건 포함' : '');

      document.getElementById('tab-videos-count').textContent = total + '건';

      renderPagination('video-pagination', state.page, totalPages, total, null, function (p) {
        state.page = p; render();
        document.getElementById('panel-videos').scrollIntoView({ block: 'nearest' });
      });
    }

    render();
  }

  // -------------------------------------------------- 5.4 channel explorer

  function initChannelExplorer(channels, NOW, DATA_FLAGS) {
    var state = { tier: '', recent: '', newOnly: false, partnerOnly: false, dermoMin: 0, minVideos: true, includeOfficial: false, sortKey: 'opportunity', sortDir: 'desc', page: 1 };

    var sampleExcludedCount = channels.filter(function (c) { return c.videoCount < 2; }).length;
    var hasOfficialField = channels.length > 0 && typeof channels[0].isOfficial === 'number';
    var officialCount = hasOfficialField ? channels.filter(function (c) { return c.isOfficial === 1; }).length : 0;

    document.getElementById('channel-tier-filter').addEventListener('change', function () {
      state.tier = this.value; state.page = 1; render();
    });
    document.getElementById('channel-recent-filter').addEventListener('change', function () {
      state.recent = this.value; state.page = 1; render();
    });
    document.getElementById('channel-newonly-filter').addEventListener('change', function () {
      state.newOnly = this.checked; state.page = 1; render();
    });
    document.getElementById('channel-minvideo-filter').addEventListener('change', function () {
      state.minVideos = this.checked; state.page = 1; render();
    });

    // isOfficial(브랜드 공식 계정) 필드가 있을 때만 관련 필터를 드러낸다 (방어적 렌더링).
    // 기본은 제외, 체크박스로 켜야 다시 보인다.
    if (hasOfficialField && officialCount > 0) {
      document.getElementById('channel-official-filter-group').hidden = false;
      document.getElementById('channel-official-filter').addEventListener('change', function () {
        state.includeOfficial = this.checked; state.page = 1; render();
      });
    }

    // dermoRatio가 있을 때만 관련 열/필터/안내문/원클릭 후보 버튼을 드러낸다 (방어적 렌더링).
    if (DATA_FLAGS.channelDermo) {
      document.getElementById('channel-dermo-filter-group').hidden = false;
      document.getElementById('channel-dermo-head').hidden = false;
      document.getElementById('dermo-note').hidden = false;
      document.getElementById('channel-candidate-row').hidden = false;
      document.getElementById('channel-dermo-filter').addEventListener('change', function () {
        state.dermoMin = this.value ? parseFloat(this.value) : 0;
        state.page = 1; render();
      });

      // 원클릭 후보 버튼: 더모 70%+ AND 미협업 조건을 한 번에 적용한다.
      // (표본 2건 이상 필터는 유지, 브랜드 공식 계정은 절대 포함하지 않는다)
      document.getElementById('channel-candidate-btn').addEventListener('click', function () {
        state.dermoMin = 0.7;
        state.newOnly = true;
        state.minVideos = true;
        state.includeOfficial = false;
        state.page = 1;
        document.getElementById('channel-dermo-filter').value = '0.7';
        document.getElementById('channel-newonly-filter').checked = true;
        document.getElementById('channel-minvideo-filter').checked = true;
        var officialCheckbox = document.getElementById('channel-official-filter');
        if (officialCheckbox) officialCheckbox.checked = false;
        render();
      });

      // 채널마다 더모 성향 편차가 얼마나 큰지 — 사분위로 보여준다. 표본은 기본 필터와
      // 같은 모집단(영상 2건 이상)을 쓰고, 값은 매 로드마다 실제 channels 데이터에서
      // 계산한다 (하드코딩 없음). dermoRatio 정의가 바뀌어도 이 문장은 그대로 맞는다.
      var dermoPopulation = channels
        .filter(function (c) { return c.videoCount >= 2 && typeof c.dermoRatio === 'number'; })
        .map(function (c) { return c.dermoRatio; })
        .sort(function (a, b) { return a - b; });

      function percentile(sorted, p) {
        if (!sorted.length) return null;
        var idx = (sorted.length - 1) * p;
        var lo = Math.floor(idx), hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
      }

      if (dermoPopulation.length >= 4) {
        var p25 = percentile(dermoPopulation, 0.25);
        var p75 = percentile(dermoPopulation, 0.75);
        var insightEl = document.getElementById('channel-insight');
        insightEl.hidden = false;
        insightEl.innerHTML = '';
        var lead = document.createElement('strong');
        lead.textContent = '채널마다 더모 성향 편차가 큽니다.';
        insightEl.appendChild(lead);
        insightEl.appendChild(document.createTextNode(
          ' 영상 2건 이상 채널 ' + dermoPopulation.length + '개 기준 하위 25%는 ' + (p25 * 100).toFixed(0) +
          '%, 상위 25%는 ' + (p75 * 100).toFixed(0) +
          '%입니다. 구독자 수나 조회수로는 드러나지 않는 차이라, 브랜드 결에 맞는 채널은 따로 걸러내야 합니다.'
        ));
      }
    }
    if (DATA_FLAGS.channelPrCount) document.getElementById('channel-pr-head').hidden = false;
    if (DATA_FLAGS.channelTopTags) document.getElementById('channel-tags-head').hidden = false;

    // 정렬 가능한 헤더 전체에 공통 클릭 핸들러를 붙인다 (참여율·영상 수·더모 성향·광고 협업).
    var sortableHeads = document.querySelectorAll('#channel-table thead th.th-sortable[data-sort]');
    sortableHeads.forEach(function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          state.sortKey = key;
          state.sortDir = 'desc';
        }
        state.page = 1;
        sortableHeads.forEach(function (h) {
          h.classList.toggle('active', h === th);
          var arrow = h.querySelector('.arrow');
          if (arrow) arrow.textContent = (h === th && state.sortDir === 'asc') ? '▲' : '▼';
        });
        render();
      });
    });

    // 스탯 타일에서 넘어온 "메디큐브 협업 채널만" 필터. 기존 필터는 전부 기본값으로
    // 되돌리고 이 조건만 적용한다.
    document.getElementById('channel-stat-filter-clear').addEventListener('click', function () {
      document.getElementById('channel-stat-filter-banner').hidden = true;
      state.partnerOnly = false;
      state.page = 1;
      render();
    });

    explorerAPI.channel = {
      applyPartnerOnly: function () {
        state.tier = ''; document.getElementById('channel-tier-filter').value = '';
        state.recent = ''; document.getElementById('channel-recent-filter').value = '';
        state.newOnly = false; document.getElementById('channel-newonly-filter').checked = false;
        // 타일 숫자(브랜드 집계 channelCount)는 표본 1건·브랜드 공식 계정을 가리지 않은
        // "메디큐브와 협업한 모든 채널" 수다. 클릭 결과도 똑같은 모집단이어야 숫자가 맞는다.
        state.minVideos = false; document.getElementById('channel-minvideo-filter').checked = false;
        state.includeOfficial = true;
        var officialCb = document.getElementById('channel-official-filter');
        if (officialCb) officialCb.checked = true;
        state.dermoMin = 0;
        var dermoSelect = document.getElementById('channel-dermo-filter');
        if (dermoSelect) dermoSelect.value = '';
        state.sortKey = 'opportunity';
        state.sortDir = 'desc';
        sortableHeads.forEach(function (h) {
          h.classList.toggle('active', h.getAttribute('data-sort') === 'engagementMedian');
          var arrow = h.querySelector('.arrow');
          if (arrow) arrow.textContent = '▼';
        });

        state.partnerOnly = true;
        state.page = 1;

        var partnerTotal = channels.filter(function (c) { return c.medicubePartner; }).length;
        document.getElementById('channel-stat-filter-text').textContent =
          '메디큐브 협업 채널 ' + partnerTotal + '개를 표시 중입니다. (표본 1건 채널·브랜드 공식 계정 포함)';
        document.getElementById('channel-stat-filter-banner').hidden = false;

        render();
      }
    };

    function render() {
      var filtered = channels.filter(function (c) {
        if (state.tier && c.tier !== state.tier) return false;
        if (state.newOnly && c.medicubePartner) return false;
        if (state.partnerOnly && !c.medicubePartner) return false;
        if (state.minVideos && c.videoCount < 2) return false;
        if (!state.includeOfficial && c.isOfficial === 1) return false;
        if (state.dermoMin > 0 && (typeof c.dermoRatio !== 'number' || c.dermoRatio < state.dermoMin)) return false;
        if (state.recent) {
          var d = parseYYMMDD(c.lastActive);
          if (!d) return false;
          var months = (NOW.getFullYear() - d.getFullYear()) * 12 + (NOW.getMonth() - d.getMonth());
          if (months > parseInt(state.recent, 10)) return false;
        }
        return true;
      });

      // 상단 요약 — 섭외 후보 찾기 화면의 핵심 문구. 현재 필터(위 predicate) 기준으로 매번 다시 센다.
      var dermoNewCount = filtered.filter(function (c) {
        return typeof c.dermoRatio === 'number' && c.dermoRatio >= 0.7 && !c.medicubePartner;
      }).length;
      // 타일 클릭으로 "메디큐브 협업 채널만" 필터가 걸린 상태에서는 미협업 후보를
      // 찾는 이 요약 문구가 모순돼 보인다("협업 채널만 보는데 미협업 0개") — 그 상태에서는 숨긴다.
      var summaryEl = document.getElementById('channels-opportunity-summary');
      if (state.partnerOnly) {
        summaryEl.hidden = true;
      } else {
        summaryEl.hidden = false;
        if (DATA_FLAGS.channelDermo) {
          summaryEl.textContent = '';
          var strongLead = document.createElement('strong');
          strongLead.textContent = '더모 성향 70% 이상이면서 아직 메디큐브와 협업하지 않은 채널 ' + dermoNewCount + '개';
          summaryEl.appendChild(strongLead);
          summaryEl.appendChild(document.createTextNode(' 성분·피부고민 중심으로 콘텐츠를 만드는 채널입니다. 브랜드 결에 맞는 신규 섭외 후보입니다.'));
        } else {
          var newCount = channels.filter(function (c) { return !c.medicubePartner; }).length;
          summaryEl.textContent = '경쟁사와만 협업한 채널이 ' + newCount + '개입니다. 이 중 참여율 상위 채널이 다음 섭외 후보입니다.';
        }
      }

      // 필터 상태 배너 — 무엇을 숨기고 있는지 항상 위에 밝힌다.
      var bannerEl = document.getElementById('channel-filter-banner');
      var bannerParts = [];
      if (state.minVideos) {
        bannerParts.push('영상 2건 이상만 표시 중입니다 (표본 1건 채널 ' + sampleExcludedCount + '개 제외)');
      }
      if (!state.includeOfficial && officialCount > 0) {
        bannerParts.push('브랜드 공식 계정 ' + officialCount + '개는 기본 제외되어 있습니다');
      }
      bannerEl.textContent = bannerParts.length
        ? bannerParts.join('. ') + '. 필터를 해제하면 전체 ' + channels.length + '개가 보입니다.'
        : '전체 ' + channels.length + '개 채널을 표시 중입니다.';

      if (state.sortKey === 'opportunity') {
        // 기본 정렬: 경쟁사 전용(신규 후보) 채널을 먼저 보여주고, 그 안에서 참여율 중앙값 내림차순.
        filtered.sort(function (a, b) {
          if (a.medicubePartner !== b.medicubePartner) return a.medicubePartner ? 1 : -1;
          var av = a.engagementMedian, bv = b.engagementMedian;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return bv - av;
        });
      } else {
        var key = state.sortKey, dir = state.sortDir;
        filtered.sort(function (a, b) {
          var av = a[key], bv = b[key];
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return dir === 'desc' ? bv - av : av - bv;
        });
      }

      var total = filtered.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (state.page > totalPages) state.page = totalPages;
      if (state.page < 1) state.page = 1;
      var start = (state.page - 1) * PAGE_SIZE;
      var end = Math.min(start + PAGE_SIZE, total);
      var pageItems = filtered.slice(start, end);

      var tbody = document.getElementById('channel-tbody');

      // 막대 기준값: 현재 필터 결과 전체(filtered)에서 값이 있는 채널의 최댓값.
      var engVals = filtered.map(function (c) { return c.engagementMedian; }).filter(function (v) { return v !== null && v !== undefined; });
      var engMax = engVals.length ? Math.max.apply(null, engVals) : 0;

      var newRows = pageItems.map(function (c) {
        var brandsChips = c.brands.slice().sort(function (x, y) { return x - y; }).map(function (bIdx) {
          return el('span', {
            class: 'chip-brand' + (bIdx === MEDICUBE_ID ? ' chip-medicube' : ''),
            text: BRAND_NAMES[bIdx]
          });
        });

        var nameChildren = [document.createTextNode(c.name + ' ')];
        if (c.isOfficial === 1) {
          nameChildren.push(el('span', { class: 'badge badge-outline', text: '브랜드 공식' }));
        } else if (!c.medicubePartner) {
          nameChildren.push(el('span', { class: 'badge badge-ink', text: '신규 후보' }));
        }
        // 성향 구성 — 채널이 가장 많이 만든 성향을 라벨로 (있을 때만)
        if (DATA_FLAGS.channelThemeDist && Array.isArray(c.themeDist)) {
          var topIdx = 0;
          c.themeDist.forEach(function (n, i) { if (n > c.themeDist[topIdx]) topIdx = i; });
          if (c.themeDist[topIdx] > 0) {
            nameChildren.push(el('div', { class: 'theme-top-label', text: '주요 성향: ' + THEME_LABELS[topIdx] }));
          }
        }

        var videoCountCell = [document.createTextNode(c.videoCount + '건 ')];
        if (c.videoCount === 1) {
          videoCountCell.push(el('span', { class: 'badge badge-warn', text: '표본 1건' }));
        }

        var hasEng = c.engagementMedian !== null && c.engagementMedian !== undefined;
        var engCell = hasEng
          ? barCell(document.createTextNode(formatPct(c.engagementMedian)), linearRatio(c.engagementMedian, engMax), c.medicubePartner)
          : el('span', { class: 'na', text: '데이터 없음' });

        var rowCells = [
          el('td', {}, nameChildren),
          el('td', { class: 'col-num' }, videoCountCell),
          el('td', { class: 'pill-row' }, brandsChips),
          el('td', { class: 'col-num', text: formatNum(c.subscribers) }),
          el('td', { class: 'col-num' }, [engCell])
        ];

        if (DATA_FLAGS.channelDermo) {
          var hasDermo = typeof c.dermoRatio === 'number';
          var dermoCell = hasDermo
            ? barCell(document.createTextNode((c.dermoRatio * 100).toFixed(0) + '%'), c.dermoRatio, c.medicubePartner)
            : el('span', { class: 'na', text: '데이터 없음' });
          rowCells.push(el('td', { class: 'col-num' }, [dermoCell]));
        }
        if (DATA_FLAGS.channelPrCount) {
          rowCells.push(el('td', { class: 'col-num', text: typeof c.prCount === 'number' ? c.prCount + '건' : '-' }));
        }
        if (DATA_FLAGS.channelTopTags) {
          var tagChips = (c.topTags || []).slice(0, 5).map(function (tag) {
            return el('span', { class: 'tag-chip tag-chip-more', text: '#' + tag });
          });
          rowCells.push(el('td', { class: 'channel-toptags' }, tagChips));
        }

        rowCells.push(el('td', { text: formatDate(c.lastActive) }));

        return el('tr', { class: c.medicubePartner ? 'is-medicube' : '', 'data-key': c.name + '__' + c.subscribers }, rowCells);
      });
      replaceTableRows(tbody, newRows, false);

      var rangeText = total === 0 ? '0개' : (start + 1) + '-' + end + ' / ' + total + '개';
      document.getElementById('channel-count').textContent =
        rangeText + ' 채널 (전체 ' + channels.length + '개 중)';

      document.getElementById('tab-channels-count').textContent = total + '개';

      renderPagination('channel-pagination', state.page, totalPages, total, null, function (p) {
        state.page = p; render();
        document.getElementById('panel-channels').scrollIntoView({ block: 'nearest' });
      });
    }

    render();
  }

  // ------------------------------------------------------------ removed

  function initRemovedPanel(removed) {
    var toggle = document.getElementById('removed-toggle');
    var panel = document.getElementById('removed-panel');
    var tbody = panel.querySelector('tbody');

    removed.forEach(function (r) {
      var tr = el('tr', {}, [
        el('td', { class: 'cell-title', title: r.title, text: r.title }),
        el('td', { text: r.channel }),
        el('td', { text: r.brand }),
        el('td', { text: formatNum(r.views) + '회' }),
        el('td', { class: 'reason', text: r.reason })
      ]);
      tbody.appendChild(tr);
    });

    toggle.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.arrow').textContent = open ? '▴' : '▾';
    });
  }

  // ------------------------------------------------------------- theme

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    var saved = localStorage.getItem('beauty-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var isDark = current
        ? current === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('beauty-theme', next);
    });
  }

})();
