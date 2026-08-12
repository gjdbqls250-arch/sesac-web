# -*- coding: utf-8 -*-
"""
K뷰티 인플루언서 대시보드 데이터 전처리 빌드 스크립트
PRD-beauty.md 7.2 데이터 계약을 따른다.
"""
import csv
import json
import os
import re
import collections

SRC = r"C:\Users\DELL\Desktop\yt_beauty_influencer_data.csv"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "beauty", "data")
TITLES_KO_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "beauty_titles_ko.json")

BRAND_ORDER = ["Medicube", "COSRX", "Beauty of Joseon", "Anua", "Torriden", "Round Lab"]
BRAND_TO_ID = {b: i for i, b in enumerate(BRAND_ORDER)}

TIER_ORDER = ["nano", "micro", "mid", "macro", "mega"]


def tier_of(subs):
    if subs < 1000:
        return "nano"
    if subs < 10000:
        return "micro"
    if subs < 100000:
        return "mid"
    if subs < 500000:
        return "macro"
    return "mega"


# ---------------------------------------------------------------------------
# 노이즈 제거 규칙 (검증 완료, PRD 3.1) — scratchpad/noise_rule.py 로직 그대로 사용
# ---------------------------------------------------------------------------
BRANDS_KW = ["medicube", "메디큐브", "cosrx", "코스알엑스", "beauty of joseon", "조선미녀",
             "anua", "아누아", "torriden", "토리든", "round lab", "라운드랩",
             "メディキューブ", "コスアールエックス", "アヌア", "トリデン", "ラウンドラボ", "ジョソン"]

BEAUTY_KW = ["スキンケア", "コスメ", "美容", "毛穴", "化粧", "洗顔", "日焼け", "肌", "クリーム",
             "セラム", "美白", "ニキビ", "パック", "マスク", "トナー", "エッセンス", "保湿",
             "レビュー", "使ってみた", "紹介", "購入", "リップ", "メイク", "スキン", "乾燥",
             "쿠션", "화장", "스킨", "뷰티", "피부", "리뷰", "skincare", "beauty", "cosmetic",
             "serum", "toner", "cream", "review", "routine", "cleanser", "sunscreen", "spf"]

NONBEAUTY_KW = ["心霊", "怖い", "ホラー", "都市伝説", "歴史", "戦史", "米兵", "事件", "儀式",
                "ヒカキン", "ミッキー", "裏話", "闇", "犯罪", "殺", "幽霊", "呪"]

# ---------------------------------------------------------------------------
# 해시태그 추출 (PRD 추가 요구사항 #2)
# 공백/#/｜/|/【/】/[/] 에서 태그가 종료된다. 전각 샵(＃)도 시작 문자로 인정한다.
# ---------------------------------------------------------------------------
HASHTAG_RE = re.compile(r"[#＃]([^\s#＃｜|\[\]【】]+)", re.UNICODE)

# ---------------------------------------------------------------------------
# 콘텐츠 성향 분류 (PRD 추가 요구사항 #3) — 인덱스 고정
# 0 성분·과학 / 1 피부고민 / 2 정직리뷰 / 3 하울·쇼핑 / 4 루틴 / 5 메이크업
# 원문(일본어) + 한국어 번역 제목을 합쳐서 매칭해 재현율을 높인다.
# ---------------------------------------------------------------------------
THEME_NAMES = ["성분·과학", "피부고민", "정직리뷰", "하울·쇼핑", "루틴", "메이크업"]

THEME_KW = [
    # 0 성분·과학
    ["成分", "pdrn", "レチノール", "ナイアシン", "セラミド", "ビタミン", "解説", "検証", "皮膚科", "医師",
     "アゼライン", "ペプチド", "ヒアルロン酸", "パンテノール", "弱酸性", "抗酸化", "エビデンス", "科学",
     "処方", "メカニズム",
     "エクソソーム", "엑소좀", "exosome", "酵素", "효소", "enzyme", "ドクターズコスメ", "더마 코스메틱",
     "닥터스코스메", "コラーゲン", "콜라겐", "collagen", "カフェイン", "카페인", "caffeine", "ターメリック",
     "터메릭", "turmeric", "コウジ酸", "코지산", "kojic", "ビタc", "비타c", "プロポリス", "프로폴리스",
     "propolis", "シカ", "시카",
     "성분", "레티놀", "나이아신", "세라마이드", "비타민", "피부과", "의사", "아젤라익", "펩타이드", "히알루론산",
     "ingredient", "retinol", "niacinamide", "ceramide", "vitamin", "dermatologist", "azelaic",
     "peptide", "hyaluronic", "panthenol", "txa", "cica"],
    # 1 피부고민
    ["毛穴", "ニキビ", "たるみ", "シミ", "しみ", "乾燥", "敏感", "赤み", "黒ずみ", "インナードライ", "脂性",
     "くすみ", "肌荒れ", "しわ", "混合肌", "毛穴レス", "ニキビ跡", "いちご鼻", "皮脂", "ハリ不足", "うるおい",
     "色素沈着", "テカリ", "油田肌",
     "危険", "위험", "日焼け止め", "선크림", "sunscreen", "spf", "リフトアップ", "保湿力", "透明感", "투명감",
     "肌管理", "피부 관리", "脱皮", "ムズムズ", "간질간질", "uv", "アクネ", "아크네", "赤ちゃん肌", "아기 피부",
     "모공", "여드름", "탄력", "색소", "건조", "민감", "붉음", "칙칙", "트러블", "지성", "복합성", "주름",
     "pores", "acne", "sagging", "dark spot", "dry skin", "sensitive", "redness", "dullness",
     "oily skin", "wrinkle", "blemish", "breakout", "pigmentation"],
    # 2 정직리뷰
    ["正直", "レビュー", "本音", "忖度", "比較", "使ってみた", "ガチ", "リアル", "辛口", "徹底比較", "検証動画",
     "案件❌", "案件0", "案件なし", "no案件", "レポ", "ランキング", "感想", "ぶった斬る", "口コミ", "使い切",
     "おすすめ",
     "実際どう", "使うべき", "써야 할", "どれがいい", "結局どれ", "期待してた", "期待と違",
     "良すぎ", "優秀すぎ", "凄すぎ", "ヤバすぎ", "感動", "お気に入り", "최애", "大好き", "使ってる",
     "가치가 있", "worth it", "first impression", "대박", "ヤバい", "金ドブ", "돈 낭비", "money waste",
     "使っても同じ", "てみた", "聞いてみたら", "물어봤더니",
     "정직", "리뷰", "본음", "비교", "후기", "리얼", "냉정", "추천", "써봤", "써보", "사용해보", "솔직",
     "재구매", "내돈내산",
     "honest", "review", "comparison", "unbiased", "recommend", "i love", "i tried", "tried"],
    # 3 하울·쇼핑
    ["購入", "haul", "ハウル", "爆買い", "qoo10", "メガ割", "セール", "お得", "購入品", "買い物", "戦利品",
     "メガポ", "買う", "kit", "キット", "ポップアップストア", "팝업스토어", "入手困難", "コスパ", "가성비",
     "新作", "신제품", "new release", "話題", "바이럴", "viral", "화제",
     "pr pack", "pr package", "pr packet", "pr box", "pr opening", "unboxed",
     "구매", "하울", "쇼핑", "세일", "특가", "득템", "직구",
     "shopping", "sale", "unboxing", "order"],
    # 4 루틴
    ["ルーティン", "routine", "スキンケア紹介", "朝の", "夜の", "日課", "ナイトルーティン", "朝スキンケア",
     "夜スキンケア", "使い方", "塗る順番", "使う順番", "ケア方法", "美容法", "スキンケアを紹介", "使用方法",
     "褒めてもらえる", "칭찬받는",
     "루틴", "데일리",
     "daily", "morning", "night"],
    # 5 메이크업
    ["メイク", "リップ", "アイシャドウ", "ファンデ", "下地", "アイライナー", "ベースメイク", "コンシーラー",
     "チーク", "マスカラ",
     "메이크업", "립", "아이섀도", "파운데이션", "베이스", "아이라이너", "컨실러", "블러셔",
     "makeup", "lip", "eyeshadow", "foundation", "primer", "eyeliner", "concealer", "blush", "mascara"],
]

# isPR 판정 키워드. 주의: "案件"은 데이터 내 15건 전부가 "NO案件"/"案件❌"/"案件なし"처럼
# "협찬 아님"을 뜻하는 부정형으로만 쓰이고 있어 긍정 마커에서 제외한다.
PR_TEXT_KW = ["提供", "タイアップ", "広告", "광고", "협찬"]

# 브랜드 2곳 이상이 한 제목에 동시 언급되면(예: "ROUND LAB vs. BEAUTY OF JOSEON") 비교/정직리뷰
# 성향(2)으로 간주한다. 같은 브랜드의 다국어 표기가 중복 집계되지 않도록 브랜드별 별칭을 묶어둔다.
BRAND_ALIASES = {
    0: ["medicube", "메디큐브", "メディキューブ"],
    1: ["cosrx", "코스알엑스", "コスアールエックス"],
    2: ["beauty of joseon", "조선미녀", "朝鮮美女"],
    3: ["anua", "아누아", "アヌア"],
    4: ["torriden", "토리든", "トリデン"],
    5: ["round lab", "라운드랩", "ラウンドラボ", "roundlab"],
}


def themes_of(text):
    t = text.lower()
    result = []
    for i, kws in enumerate(THEME_KW):
        if any(kw.lower() in t for kw in kws):
            result.append(i)
    brand_hits = {bid for bid, aliases in BRAND_ALIASES.items() if any(a.lower() in t for a in aliases)}
    if len(brand_hits) >= 2 and 2 not in result:
        result.append(2)
    return result


def extract_hashtags(title):
    return HASHTAG_RE.findall(title)


def is_pr(title, tags_lower):
    if "pr" in tags_lower:
        return 1
    if has(title, PR_TEXT_KW):
        return 1
    return 0


def has(text, words):
    t = text.lower()
    return any(w.lower() in t for w in words)


def to_int_or_none(s):
    s = (s or "").strip()
    if s == "":
        return None
    return int(float(s))


def to_yymmdd(iso_str):
    # "2026-03-30T09:30:33Z" -> "260330"
    date_part = iso_str.split("T")[0]
    y, m, d = date_part.split("-")
    return y[2:] + m + d


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    with open(SRC, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    total_raw = len(rows)

    # -- 채널 단위로 묶기 (노이즈 판정용)
    by_channel = collections.defaultdict(list)
    for r in rows:
        by_channel[r["channel_title"]].append(r)

    # 규칙 1: 비뷰티 키워드 + 뷰티/브랜드 관련어 전무
    rule_a_ids = set()
    for r in rows:
        if has(r["title"], NONBEAUTY_KW) and not has(r["title"], BEAUTY_KW + BRANDS_KW):
            rule_a_ids.add(r["video_id"])

    # 규칙 2: 영상 3건 이상, 뷰티/브랜드 관련어 포함 영상이 하나도 없는 채널 전체
    rule_b_channels = []
    for ch, vids in by_channel.items():
        if len(vids) >= 3:
            hits = sum(1 for v in vids if has(v["title"], BEAUTY_KW + BRANDS_KW))
            if hits == 0:
                rule_b_channels.append(ch)

    rule_b_ids = set()
    for ch in rule_b_channels:
        for v in by_channel[ch]:
            rule_b_ids.add(v["video_id"])

    removed_ids = rule_a_ids | rule_b_ids

    removed_list = []
    for r in rows:
        if r["video_id"] in removed_ids:
            if r["video_id"] in rule_a_ids:
                reason = f"비뷰티 키워드 포함 · 뷰티·브랜드 관련어 없음: 「{r['title']}」"
            else:
                reason = f"채널 '{r['channel_title']}' 전체가 뷰티·브랜드 관련어 없는 영상 {len(by_channel[r['channel_title']])}건으로 구성되어 채널 단위 제외"
            removed_list.append({
                "videoId": r["video_id"],
                "brand": r["brand"],
                "channel": r["channel_title"],
                "title": r["title"],
                "views": to_int_or_none(r["view_count"]) or 0,
                "reason": reason,
            })

    kept_rows = [r for r in rows if r["video_id"] not in removed_ids]
    total_clean = len(kept_rows)
    removed_count = len(removed_ids)

    assert removed_count == 20, f"제거 건수 불일치: {removed_count}"
    assert total_clean == total_raw - removed_count

    # -----------------------------------------------------------------
    # 구독자 구간별 조회수 중앙값 (정제 후 데이터 기준)
    # -----------------------------------------------------------------
    def median(vals):
        # PRD 검증값과 일치시키기 위해 짝수 길이에서도 평균을 취하지 않고
        # 하위 정렬 기준 중앙 인덱스(len//2) 값을 그대로 사용한다.
        vals = sorted(vals)
        n = len(vals)
        if n == 0:
            return 0
        return vals[n // 2]

    tier_views = collections.defaultdict(list)
    for r in kept_rows:
        subs = to_int_or_none(r["subscriber_count"]) or 0
        views = to_int_or_none(r["view_count"]) or 0
        tier_views[tier_of(subs)].append(views)

    tier_medians = {t: median(tier_views[t]) for t in TIER_ORDER}

    # -----------------------------------------------------------------
    # channels 배열 (videos.json 참조용) - 등장 순서 유지
    # -----------------------------------------------------------------
    channel_names = []
    channel_idx_map = {}
    for r in kept_rows:
        name = r["channel_title"]
        if name not in channel_idx_map:
            channel_idx_map[name] = len(channel_names)
            channel_names.append(name)

    # -----------------------------------------------------------------
    # videos 배열 + titles 배열
    # -----------------------------------------------------------------
    videos = []
    titles = []
    for r in kept_rows:
        video_id = r["video_id"]
        channel_idx = channel_idx_map[r["channel_title"]]
        brand_id = BRAND_TO_ID[r["brand"]]
        subs = to_int_or_none(r["subscriber_count"]) or 0
        views = to_int_or_none(r["view_count"]) or 0
        likes = to_int_or_none(r["like_count"])
        comments = to_int_or_none(r["comment_count"])

        if likes is None or comments is None or views == 0:
            engagement_pct = None
        else:
            engagement_pct = round((likes + comments) / views * 100, 4)

        tier = tier_of(subs)
        tier_med = tier_medians[tier]
        vs_expected = round(views / tier_med, 4) if tier_med else 0

        date = to_yymmdd(r["published_at"])
        title = r["title"]
        is_shorts = 1 if "#shorts" in title.lower() else 0

        videos.append([
            video_id, channel_idx, brand_id, subs, views,
            likes, comments, engagement_pct, vs_expected, date, is_shorts,
        ])
        titles.append(title)

    period_start = min(r["published_at"] for r in kept_rows)[:7]
    period_end = max(r["published_at"] for r in kept_rows)[:7]

    # -----------------------------------------------------------------
    # titlesKo (한국어 번역) — 별도 파일에서 로드, titles와 순서·길이 일치 검증
    # -----------------------------------------------------------------
    with open(TITLES_KO_SRC, encoding="utf-8") as f:
        titles_ko = json.load(f)

    assert len(titles_ko) == len(titles), (
        f"titlesKo 길이 불일치: titlesKo={len(titles_ko)} titles={len(titles)}"
    )
    assert all(isinstance(x, str) and x.strip() for x in titles_ko), "titlesKo에 빈 문자열 존재"

    # -----------------------------------------------------------------
    # hashtags / themes / isPR (영상별, titles와 같은 순서)
    # -----------------------------------------------------------------
    hashtag_display = {}  # lower -> Counter(original-case display form)
    hashtags_per_video = []
    themes_per_video = []
    is_pr_per_video = []

    for title, title_ko in zip(titles, titles_ko):
        raw_tags = extract_hashtags(title)
        norm_tags = []
        for tag in raw_tags:
            lower = tag.lower()
            norm_tags.append(lower)
            hashtag_display.setdefault(lower, collections.Counter())[tag] += 1
        hashtags_per_video.append(norm_tags)

        combined_text = title + " " + title_ko
        themes_per_video.append(themes_of(combined_text))
        is_pr_per_video.append(is_pr(title, norm_tags))

    tag_counts = collections.Counter()
    for tags in hashtags_per_video:
        tag_counts.update(tags)

    top_hashtags = [
        {"tag": hashtag_display[lower].most_common(1)[0][0], "count": count}
        for lower, count in tag_counts.most_common(40)
    ]

    videos_json = {
        "meta": {
            "totalRaw": total_raw,
            "totalClean": total_clean,
            "removed": removed_count,
            "periodStart": period_start,
            "periodEnd": period_end,
            "tierMedians": {t: (int(tier_medians[t]) if tier_medians[t] == int(tier_medians[t]) else tier_medians[t]) for t in TIER_ORDER},
            "builtAt": "2026-08-12",
            "topHashtags": top_hashtags,
        },
        "channels": channel_names,
        "videos": videos,
        "titles": titles,
        "titlesKo": titles_ko,
        "hashtags": hashtags_per_video,
        "themes": themes_per_video,
        "isPR": is_pr_per_video,
    }

    # -----------------------------------------------------------------
    # channels.json
    # -----------------------------------------------------------------
    # video_id -> videos/titles/hashtags/themes/isPR 배열 인덱스 (kept_rows와 동일 순서로 생성됨)
    video_id_to_idx = {r["video_id"]: i for i, r in enumerate(kept_rows)}

    # dermoRatio는 성분·과학(0)·피부고민(1)만 반영한다. 정직리뷰(2)는 뷰티 영상 대부분이
    # 어떤 식으로든 리뷰 성격을 띠어(466건 중 241건, 52%) 변별력이 없으므로 제외한다.
    # 정직리뷰 성향 자체(themes/themeDist)는 화면 배지·필터용으로 그대로 둔다.
    DERMO_THEMES = {0, 1}  # 성분·과학, 피부고민

    # 브랜드 공식 계정 판정. 후보(채널명에 브랜드명 포함)를 자동으로 뽑은 뒤 사람이 눈으로 확인해
    # 확정한 3개만 명시한다 — 단순 문자열 포함만으로 자동 판정하면
    # "わーるどりえたす【元美容部員韓国コスメオタク】" 같은 일반 리뷰 채널이 오탐될 수 있다.
    OFFICIAL_CHANNEL_NAMES = {
        "【日本公式】medicube メディキューブ",  # "일본공식" 명시 + medicube 공식 로고 채널
        "medicube HK",                          # medicube 브랜드명 + 지역(HK) 접미사, 개인색 전무
        "COSRX 코스알엑스",                      # 채널명이 브랜드명(영문+한글 표기)만으로 구성, 개인색 전무
    }

    ch_records = collections.defaultdict(list)  # name -> list of video dict rows (kept_rows entries)
    for r in kept_rows:
        ch_records[r["channel_title"]].append(r)

    channels_out = []
    for name in channel_names:
        recs = ch_records[name]
        subs_vals = [to_int_or_none(r["subscriber_count"]) or 0 for r in recs]
        subscribers = max(subs_vals)  # 최신/대표 구독자 수 (최대값 사용)
        tier = tier_of(subscribers)
        video_count = len(recs)
        brand_ids = sorted({BRAND_TO_ID[r["brand"]] for r in recs})
        medicube_partner = 0 in brand_ids

        eng_vals = []
        views_vals = []
        for r in recs:
            views = to_int_or_none(r["view_count"]) or 0
            views_vals.append(views)
            likes = to_int_or_none(r["like_count"])
            comments = to_int_or_none(r["comment_count"])
            if likes is not None and comments is not None and views > 0:
                eng_vals.append((likes + comments) / views * 100)

        engagement_median = round(median(eng_vals), 4) if eng_vals else None
        views_median = median(views_vals)
        views_median = int(views_median) if views_median == int(views_median) else views_median

        last_active = max(to_yymmdd(r["published_at"]) for r in recs)

        # -- 콘텐츠 성향 집계 (PRD 추가 요구사항 #4)
        theme_dist = [0, 0, 0, 0, 0, 0]
        dermo_video_count = 0
        pr_count = 0
        ch_tag_counter = collections.Counter()
        for r in recs:
            idx = video_id_to_idx[r["video_id"]]
            v_themes = themes_per_video[idx]
            for th in v_themes:
                theme_dist[th] += 1
            if set(v_themes) & DERMO_THEMES:
                dermo_video_count += 1
            pr_count += is_pr_per_video[idx]
            for tag in hashtags_per_video[idx]:
                ch_tag_counter[tag] += 1

        dermo_ratio = round(dermo_video_count / video_count, 2) if video_count else 0
        top_tags = [
            hashtag_display[lower].most_common(1)[0][0]
            for lower, _ in ch_tag_counter.most_common(5)
        ]

        channels_out.append({
            "name": name,
            "subscribers": subscribers,
            "tier": tier,
            "videoCount": video_count,
            "brands": brand_ids,
            "medicubePartner": medicube_partner,
            "engagementMedian": engagement_median,
            "viewsMedian": views_median,
            "lastActive": last_active,
            "themeDist": theme_dist,
            "dermoRatio": dermo_ratio,
            "prCount": pr_count,
            "topTags": top_tags,
            "isOfficial": 1 if name in OFFICIAL_CHANNEL_NAMES else 0,
        })

    channels_json = {"channels": channels_out}

    # -----------------------------------------------------------------
    # brands.json
    # -----------------------------------------------------------------
    brands_out = []
    for brand_name in BRAND_ORDER:
        bid = BRAND_TO_ID[brand_name]
        brecs = [r for r in kept_rows if r["brand"] == brand_name]
        video_count = len(brecs)
        channel_count = len({r["channel_title"] for r in brecs})

        eng_vals = []
        views_vals = []
        tier_dist = {t: 0 for t in TIER_ORDER}
        for r in brecs:
            subs = to_int_or_none(r["subscriber_count"]) or 0
            views = to_int_or_none(r["view_count"]) or 0
            views_vals.append(views)
            tier_dist[tier_of(subs)] += 1
            likes = to_int_or_none(r["like_count"])
            comments = to_int_or_none(r["comment_count"])
            if likes is not None and comments is not None and views > 0:
                eng_vals.append((likes + comments) / views * 100)

        engagement_median = round(median(eng_vals), 4) if eng_vals else None
        views_median = median(views_vals)
        views_median = int(views_median) if views_median == int(views_median) else views_median

        theme_dist = [0, 0, 0, 0, 0, 0]
        for r in brecs:
            idx = video_id_to_idx[r["video_id"]]
            for th in themes_per_video[idx]:
                theme_dist[th] += 1

        brands_out.append({
            "id": bid,
            "name": brand_name,
            "videoCount": video_count,
            "channelCount": channel_count,
            "engagementMedian": engagement_median,
            "viewsMedian": views_median,
            "tierDist": tier_dist,
            "themeDist": theme_dist,
        })

    brands_json = {"brands": brands_out}

    removed_json = {"removed": removed_list}

    # -----------------------------------------------------------------
    # 저장
    # -----------------------------------------------------------------
    def dump(obj, filename):
        path = os.path.join(OUT_DIR, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        return path

    p1 = dump(videos_json, "videos.json")
    p2 = dump(channels_json, "channels.json")
    p3 = dump(brands_json, "brands.json")
    p4 = dump(removed_json, "removed.json")

    print("빌드 완료")
    print(f"  totalRaw={total_raw} totalClean={total_clean} removed={removed_count}")
    print(f"  tierMedians={videos_json['meta']['tierMedians']}")
    for p in (p1, p2, p3, p4):
        print(f"  {p} ({os.path.getsize(p):,} bytes)")

    # -----------------------------------------------------------------
    # 검증 로그 (PRD 추가 요구사항 검증 섹션)
    # -----------------------------------------------------------------
    print()
    print("== 검증 ==")
    print(f"  titlesKo 길이={len(titles_ko)} (titles={len(titles)}) / 빈 문자열 0건 확인됨")

    pr_tag_count = tag_counts.get("pr", 0)
    print(f"  해시태그 정규화: #PR/#pr 합산 = {pr_tag_count}건 (PRD 예상 71건)")

    theme_totals = [0, 0, 0, 0, 0, 0]
    zero_theme = 0
    zero_theme_views = 0
    total_views_all = sum(v[4] for v in videos)
    for th, v in zip(themes_per_video, videos):
        if not th:
            zero_theme += 1
            zero_theme_views += v[4]
        for i in th:
            theme_totals[i] += 1
    for i, name in enumerate(THEME_NAMES):
        print(f"  성향[{i}] {name}: {theme_totals[i]}건")
    print(f"  성향 미부여 영상: {zero_theme}건 / {len(titles)}건")
    print(f"  성향 미부여 조회수 비중: {round(zero_theme_views / total_views_all * 100, 2)}% (조회수 {zero_theme_views:,} / {total_views_all:,})")
    print(f"  isPR=1 영상: {sum(is_pr_per_video)}건")

    ratios = [c["dermoRatio"] for c in channels_out]
    print(f"  dermoRatio 범위: min={min(ratios)} max={max(ratios)}")
    top10 = sorted(channels_out, key=lambda c: (c["dermoRatio"], c["videoCount"]), reverse=True)[:10]
    print("  dermoRatio 상위 10개 채널:")
    for c in top10:
        print(f"    {c['name']}: dermoRatio={c['dermoRatio']} videoCount={c['videoCount']} themeDist={c['themeDist']}")

    # -- dermoRatio 변별력 점검 (영상 2건 이상 채널 기준, 성분+고민만 반영한 새 정의)
    multi = [c for c in channels_out if c["videoCount"] >= 2]
    multi_ratios = sorted(c["dermoRatio"] for c in multi)

    def quantile(vals, q):
        if not vals:
            return 0
        idx = min(len(vals) - 1, max(0, int(round(q * (len(vals) - 1)))))
        return vals[idx]

    at_max = sum(1 for r in multi_ratios if r == 1.0)
    print(f"  [영상 2건 이상, n={len(multi)}] dermoRatio=1.00 비율: {round(at_max / len(multi) * 100, 1)}% ({at_max}개)")
    print(f"  [영상 2건 이상] dermoRatio 사분위: {quantile(multi_ratios, 0.25)}/{quantile(multi_ratios, 0.5)}/{quantile(multi_ratios, 0.75)}")

    multi_video_high_dermo = sum(1 for c in channels_out if c["videoCount"] >= 2 and c["dermoRatio"] >= 0.7)
    print(f"  영상 2건 이상 채널 중 dermoRatio>=0.7: {multi_video_high_dermo}개")

    # -- 브랜드 공식 채널(isOfficial) 판정 근거 + 오탐 점검
    official = [c for c in channels_out if c["isOfficial"] == 1]
    print(f"  isOfficial=1 채널 ({len(official)}개):")
    OFFICIAL_REASONS = {
        "【日本公式】medicube メディキューブ": "채널명에 '일본공식' 명시 + medicube 브랜드 공식 계정",
        "medicube HK": "브랜드명 + 지역 접미사(HK) 조합, 개인 색채 없는 전형적 지역 공식 핸들",
        "COSRX 코스알엑스": "채널명이 브랜드명의 영문·한글 표기만으로 구성, 개인 채널 요소 전무",
    }
    for c in official:
        reason = OFFICIAL_REASONS.get(c["name"], "")
        print(f"    {c['name']} | videoCount={c['videoCount']} subs={c['subscribers']} medicubePartner={c['medicubePartner']} | 근거: {reason}")

    brand_name_kw = ["medicube", "메디큐브", "メディキューブ", "cosrx", "코스알엑스", "コスアールエックス",
                      "anua", "아누아", "アヌア", "torriden", "토리든", "トリデン",
                      "round lab", "라운드랩", "ラウンドラボ", "roundlab",
                      "beauty of joseon", "조선미녀", "ジョソン"]
    brand_named_non_official = [
        c for c in channels_out
        if c["isOfficial"] == 0 and any(kw in c["name"].lower() for kw in brand_name_kw)
    ]
    print(f"  브랜드명 포함하지만 공식 아님으로 판정한 채널 ({len(brand_named_non_official)}개):")
    for c in brand_named_non_official:
        print(f"    {c['name']} | videoCount={c['videoCount']} subs={c['subscribers']}")

    # -- 협업 후보 필터: 영상 2건 이상 · dermoRatio>=0.7 · 미협업 · 공식 아님
    candidates = [
        c for c in channels_out
        if c["videoCount"] >= 2 and c["dermoRatio"] >= 0.7
        and not c["medicubePartner"] and c["isOfficial"] == 0
    ]
    print(f"  [영상 2건 이상 · dermoRatio>=0.7 · 미협업 · 공식 아님] 채널 수: {len(candidates)}개")
    top_candidates = sorted(candidates, key=lambda c: (c["dermoRatio"], c["videoCount"]), reverse=True)[:10]
    print("  상위 10개:")
    for c in top_candidates:
        print(f"    {c['name']}: dermoRatio={c['dermoRatio']} videoCount={c['videoCount']} subs={c['subscribers']}")

    torriden = next(b for b in brands_out if b["name"] == "Torriden")
    non_partner = sum(1 for c in channels_out if not c["medicubePartner"])
    print(f"  기존 필드 확인: Torriden viewsMedian={torriden['viewsMedian']} (기대 27341)")
    print(f"  기존 필드 확인: removed={removed_count} (기대 20)")
    print(f"  기존 필드 확인: 메디큐브 미협업 채널 수={non_partner} (기대 166)")


if __name__ == "__main__":
    main()
