"""
build_map.py — 서울 25개 자치구 GeoJSON -> data/seoul-map.json (SVG path)

입력: scratchpad/seoul.json (GeoJSON FeatureCollection, WGS84 lon/lat)
출력: data/seoul-map.json
  {
    "viewBox": "0 0 800 600",
    "districts": [
      { "code": "...", "name": "...", "path": "M..Z", "cx": .., "cy": .. }
    ]
  }

변환 절차:
  1. 각 좌표에 웹 메르카토르 투영 적용 (x=lon, y=ln(tan(pi/4 + lat*pi/360)))
  2. 투영된 전체 좌표의 bounding box를 구해 800x600 (여백 10px)에 종횡비 유지로 스케일/이동
  3. y축 반전 (SVG는 y가 아래로 증가)
  4. 소수점 1자리로 반올림
  5. Polygon/MultiPolygon 모두 처리, 각 ring(hole 포함)을 subpath로 이어붙임
  6. cx/cy는 면적 가중 centroid, 폴리곤 밖으로 나가면 bbox 중심으로 대체
"""
import json
import math

INPUT_PATH = r"C:\Users\DELL\AppData\Local\Temp\claude\C--Users-DELL-Projects-sesac-wab\c25b7e72-516d-4ca0-9c44-fdb368c65324\scratchpad\seoul.json"
OUTPUT_PATH = r"C:\Users\DELL\Projects\sesac-wab\data\seoul-map.json"

VIEW_W = 800
VIEW_H = 600
MARGIN = 10


def mercator(lon, lat):
    # x = lon is in degrees. The raw mercator y formula (ln(tan(...))) yields
    # radians, which is a ~57x different scale than degrees and would wreck
    # the aspect ratio when bbox-fitting x (degrees) against y (radians).
    # Multiply by 180/pi to express y in the same "degree" units as x -- this
    # is the standard way to keep a true mercator y proportional to lon degrees.
    x = lon
    y = (180.0 / math.pi) * math.log(math.tan(math.pi / 4 + lat * math.pi / 360))
    return x, y


def project_ring(ring):
    return [mercator(lon, lat) for lon, lat in ring]


def polygon_rings(geometry):
    """Yield list of rings (each ring a list of (lon,lat)) for Polygon or MultiPolygon."""
    if geometry["type"] == "Polygon":
        yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for poly in geometry["coordinates"]:
            yield from poly
    else:
        raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def polygon_groups(geometry):
    """Yield list of polygons; each polygon is a list of rings, for centroid/PIP by outer ring."""
    if geometry["type"] == "Polygon":
        yield geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for poly in geometry["coordinates"]:
            yield poly
    else:
        raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def ring_signed_area_centroid(ring):
    """Shoelace formula: returns (area, cx, cy) for a single ring (list of x,y tuples)."""
    n = len(ring)
    a_sum = 0.0
    cx_sum = 0.0
    cy_sum = 0.0
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        cross = x0 * y1 - x1 * y0
        a_sum += cross
        cx_sum += (x0 + x1) * cross
        cy_sum += (y0 + y1) * cross
    area = a_sum / 2.0
    if area == 0:
        # degenerate; fall back to simple average
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    cx = cx_sum / (6.0 * area)
    cy = cy_sum / (6.0 * area)
    return area, cx, cy


def point_in_ring(x, y, ring):
    """Ray casting point-in-polygon test."""
    inside = False
    n = len(ring)
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        if ((y0 > y) != (y1 > y)):
            x_int = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < x_int:
                inside = not inside
    return inside


def main():
    with open(INPUT_PATH, "r", encoding="utf-8") as f:
        gj = json.load(f)

    features = gj["features"]
    assert len(features) == 25, f"Expected 25 features, got {len(features)}"

    # First pass: project all coordinates, collect global bbox
    projected_features = []
    min_x = min_y = math.inf
    max_x = max_y = -math.inf

    for feat in features:
        props = feat["properties"]
        geom = feat["geometry"]

        proj_polygons = []  # list of polygons; each polygon = list of rings; each ring = list of (x,y)
        for poly in polygon_groups(geom):
            proj_poly = [project_ring(ring) for ring in poly]
            proj_polygons.append(proj_poly)
            for ring in proj_poly:
                for x, y in ring:
                    min_x = min(min_x, x)
                    max_x = max(max_x, x)
                    min_y = min(min_y, y)
                    max_y = max(max_y, y)

        projected_features.append((props, proj_polygons))

    # Compute scale to fit viewBox with margin, preserving aspect ratio
    avail_w = VIEW_W - 2 * MARGIN
    avail_h = VIEW_H - 2 * MARGIN
    span_x = max_x - min_x
    span_y = max_y - min_y
    scale = min(avail_w / span_x, avail_h / span_y)

    # Center the scaled content within the viewBox
    scaled_w = span_x * scale
    scaled_h = span_y * scale
    offset_x = MARGIN + (avail_w - scaled_w) / 2.0
    offset_y = MARGIN + (avail_h - scaled_h) / 2.0

    def to_svg(x, y):
        sx = (x - min_x) * scale + offset_x
        # flip y: SVG y grows downward, mercator y grows upward (north)
        sy_up = (y - min_y) * scale
        sy = (scaled_h - sy_up) + offset_y
        return round(sx, 1), round(sy, 1)

    districts = []
    for props, proj_polygons in projected_features:
        code = props["code"]
        name = props["name"]

        # Build SVG path, and also build svg-space polygons for centroid calc
        path_parts = []
        svg_polygons = []  # list of polygons (each polygon = list of rings, each ring = list of (x,y) svg coords)

        for poly in proj_polygons:
            svg_rings = []
            for ring in poly:
                svg_ring = [to_svg(x, y) for x, y in ring]
                svg_rings.append(svg_ring)
                d = "M" + " L".join(f"{px},{py}" for px, py in svg_ring) + " Z"
                path_parts.append(d)
            svg_polygons.append(svg_rings)

        path = "".join(path_parts)

        # Centroid: area-weighted over all outer rings (largest ring per polygon = outer boundary,
        # holes are typically listed after outer ring in each polygon's ring list).
        # Use only the outer ring (index 0) of each polygon for centroid weighting,
        # which approximates area-weighted centroid across (multi)polygon parts.
        total_area = 0.0
        weighted_cx = 0.0
        weighted_cy = 0.0
        outer_rings = []
        for svg_rings in svg_polygons:
            outer = svg_rings[0]
            outer_rings.append(outer)
            area, cx, cy = ring_signed_area_centroid(outer)
            area_abs = abs(area)
            total_area += area_abs
            weighted_cx += cx * area_abs
            weighted_cy += cy * area_abs

        if total_area > 0:
            centroid_x = weighted_cx / total_area
            centroid_y = weighted_cy / total_area
        else:
            centroid_x, centroid_y = outer_rings[0][0]

        # Check centroid falls within at least one outer ring; if not, fall back to bbox center
        inside_any = any(point_in_ring(centroid_x, centroid_y, ring) for ring in outer_rings)

        if not inside_any:
            xs = [p[0] for ring in outer_rings for p in ring]
            ys = [p[1] for ring in outer_rings for p in ring]
            centroid_x = (min(xs) + max(xs)) / 2.0
            centroid_y = (min(ys) + max(ys)) / 2.0

        districts.append({
            "code": code,
            "name": name,
            "path": path,
            "cx": round(centroid_x, 1),
            "cy": round(centroid_y, 1),
        })

    # Sort by code for stable, predictable output
    districts.sort(key=lambda d: d["code"])

    out = {
        "viewBox": f"0 0 {VIEW_W} {VIEW_H}",
        "districts": districts,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {OUTPUT_PATH} with {len(districts)} districts")


if __name__ == "__main__":
    main()
