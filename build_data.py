#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_data.py — 서울 아파트 실거래가 CSV를 대시보드용 JSON으로 전처리.

PRD.md 6.2 데이터 계약을 정확히 따른다:
  - data/summary.json
  - data/gu/{code}.json (25개)

사용법: python build_data.py
"""
import csv
import json
import os
import sys
import statistics
from datetime import date, datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(BASE_DIR, "seoul-apt-latest.csv")
GEOJSON_PATH = (
    r"C:\Users\DELL\AppData\Local\Temp\claude\C--Users-DELL-Projects-sesac-wab"
    r"\c25b7e72-516d-4ca0-9c44-fdb368c65324\scratchpad\seoul.json"
)
DATA_DIR = os.path.join(BASE_DIR, "data")
GU_DIR = os.path.join(DATA_DIR, "gu")

DEAL_TYPE_MAP = {"매매": 0, "전세": 1, "월세": 2}
DEAL_TYPE_NAMES = ["매매", "전세", "월세"]


def load_gu_codes():
    """GeoJSON에서 구 이름 -> 코드 매핑을 로드한다."""
    with open(GEOJSON_PATH, encoding="utf-8") as f:
        geo = json.load(f)
    name_to_code = {}
    for feat in geo["features"]:
        props = feat["properties"]
        name_to_code[props["name"]] = props["code"]
    return name_to_code


def to_yymmdd(date_str):
    """'2026-05-20' -> '260520'"""
    d = datetime.strptime(date_str.strip(), "%Y-%m-%d").date()
    return "%02d%02d%02d" % (d.year % 100, d.month, d.day)


def to_int_amount(s):
    s = (s or "").strip()
    if not s:
        return 0
    return int(round(float(s)))


def to_floor(s):
    s = (s or "").strip()
    if not s:
        return 0
    try:
        return int(s)
    except ValueError:
        try:
            return int(round(float(s)))
        except ValueError:
            return 0


def main():
    name_to_code = load_gu_codes()
    geo_names = set(name_to_code.keys())

    os.makedirs(GU_DIR, exist_ok=True)

    # per-gu accumulators
    gu_data = {}  # name -> {dongs: {name:idx}, complexes: {name:idx}, rows: []}
    # for summary stats: name -> deal_type -> list of amounts (converted deposit for wolse)
    gu_stats = {}  # name -> {0: [...], 1: [...], 2: [...]}
    gu_counts = {}  # name -> {0: n, 1: n, 2: n}

    csv_gu_names = set()
    total_rows = 0
    contract_dates = []

    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1
            gu = row["gu"].strip()
            dong = row["dong"].strip()
            complex_name = row["complex"].strip()
            deal_type_str = row["deal_type"].strip()
            csv_gu_names.add(gu)

            if gu not in gu_data:
                gu_data[gu] = {
                    "dong_index": {},
                    "dongs": [],
                    "complex_index": {},
                    "complexes": [],
                    "rows": [],
                }
                gu_stats[gu] = {0: [], 1: [], 2: []}
                gu_counts[gu] = {0: 0, 1: 0, 2: 0}

            g = gu_data[gu]

            dong_idx = g["dong_index"].get(dong)
            if dong_idx is None:
                dong_idx = len(g["dongs"])
                g["dong_index"][dong] = dong_idx
                g["dongs"].append(dong)

            complex_idx = g["complex_index"].get(complex_name)
            if complex_idx is None:
                complex_idx = len(g["complexes"])
                g["complex_index"][complex_name] = complex_idx
                g["complexes"].append(complex_name)

            area_m2 = round(float(row["area_m2"]), 1)
            floor = to_floor(row["floor"])
            deal_type = DEAL_TYPE_MAP[deal_type_str]

            if deal_type == 0:  # 매매
                amount = to_int_amount(row["price"])
                monthly_rent = 0
                converted = amount
            elif deal_type == 1:  # 전세
                amount = to_int_amount(row["deposit"])
                monthly_rent = 0
                converted = amount
            else:  # 월세
                amount = to_int_amount(row["deposit"])
                monthly_rent = to_int_amount(row["monthly_rent"])
                converted = amount + monthly_rent * 100

            date_str = to_yymmdd(row["contract_date"])
            contract_dates.append(row["contract_date"].strip())

            g["rows"].append(
                [dong_idx, complex_idx, area_m2, floor, deal_type, amount, monthly_rent, date_str]
            )

            gu_stats[gu][deal_type].append(converted)
            gu_counts[gu][deal_type] += 1

    # --- validate gu name matching ---
    missing_in_geo = csv_gu_names - geo_names
    missing_in_csv = geo_names - csv_gu_names
    if missing_in_geo or missing_in_csv:
        print("ERROR: gu 이름 불일치 발견!")
        if missing_in_geo:
            print("  CSV에는 있지만 GeoJSON에 없음:", sorted(missing_in_geo))
        if missing_in_csv:
            print("  GeoJSON에는 있지만 CSV에 없음:", sorted(missing_in_csv))
        sys.exit(1)
    else:
        print(f"gu 이름 매칭 검증 통과: {len(csv_gu_names)}개 자치구 모두 일치")

    # --- write per-gu files ---
    summary_gu_list = []
    for gu_name in sorted(gu_data.keys(), key=lambda n: name_to_code[n]):
        code = name_to_code[gu_name]
        g = gu_data[gu_name]
        out = {
            "code": code,
            "name": gu_name,
            "dongs": g["dongs"],
            "complexes": g["complexes"],
            "rows": g["rows"],
        }
        out_path = os.path.join(GU_DIR, f"{code}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

        counts = {
            DEAL_TYPE_NAMES[i]: gu_counts[gu_name][i] for i in range(3)
        }
        median = {}
        for i in range(3):
            vals = gu_stats[gu_name][i]
            median[DEAL_TYPE_NAMES[i]] = int(round(statistics.median(vals))) if vals else 0

        summary_gu_list.append(
            {
                "code": code,
                "name": gu_name,
                "counts": counts,
                "median": median,
            }
        )

    # --- period from data ---
    period_start = min(contract_dates)[:7] if contract_dates else ""
    period_end = max(contract_dates)[:7] if contract_dates else ""

    summary = {
        "meta": {
            "totalRows": total_rows,
            "periodStart": period_start,
            "periodEnd": period_end,
            "builtAt": date.today().isoformat(),
        },
        "gu": summary_gu_list,
    }

    summary_path = os.path.join(DATA_DIR, "summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, separators=(",", ":"))

    print(f"총 {total_rows}행 처리 완료.")
    print(f"summary.json 작성: {summary_path}")
    print(f"gu 파일 {len(summary_gu_list)}개 작성: {GU_DIR}")


if __name__ == "__main__":
    main()
