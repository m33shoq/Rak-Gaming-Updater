"""Build bundled, zoom-aware replay maps from WoW's UiMap floor art.

The development-only builder follows the same client DB relationships used by
WoW's map UI: UiMap -> UiMapXMapArt -> UiMapArtTile. UiMapAssignment provides
the terrain or WMO-local coordinate rectangle used to place the finished art
behind WCL positions. Source DB2 rows and BLP payloads are downloaded from Wago
for a pinned Retail build; the shipped application only reads local WebP assets.

Pillow 11.3.0 or newer is recommended. Rebuild all configured raid floors with:

    python scripts/build_replay_maps.py

Or rebuild selected UiMap IDs with:

    python scripts/build_replay_maps.py 2610
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO, StringIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image


SOURCE_BUILD = "12.1.0.69587"
DEFAULT_UI_MAP_IDS = (2606, 2607, 2608, 2609, 2610, 2632)
DEFAULT_LEVELS = (1, 2, 4, 8)
OUTPUT_TILE_PIXELS = 1024
WEBP_QUALITY = 90
OUTPUT_DIRECTORY = Path(__file__).parents[1] / "app" / "assets" / "replay-maps" / "uimap"
MANIFEST_PATH = OUTPUT_DIRECTORY / "manifest.json"
WAGO_DB2_URL = "https://wago.tools/db2/{table}/csv"
WAGO_CASC_URL = "https://wago.tools/api/casc/{file_data_id}"


@dataclass(frozen=True)
class UiMapArtTileSource:
    row: int
    column: int
    file_data_id: int


@dataclass(frozen=True)
class UiMapSource:
    ui_map_id: int
    world_map_id: int
    name: str
    art_id: int
    width: int
    height: int
    source_tile_width: int
    source_tile_height: int
    left: float
    top: float
    right: float
    bottom: float
    coordinate_transform: str
    tiles: tuple[UiMapArtTileSource, ...]


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "RG-Updater replay map builder"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def fetch_db2_table(table: str, build: str) -> list[dict[str, str]]:
    query = urlencode({"build": build})
    body = fetch_bytes(f"{WAGO_DB2_URL.format(table=table)}?{query}")
    return list(csv.DictReader(StringIO(body.decode("utf-8-sig"))))


def require_one(items: list[object], description: str) -> object:
    if len(items) != 1:
        raise ValueError(f"Expected one {description}, found {len(items)}")
    return items[0]


def fetch_db2_tables(build: str) -> dict[str, list[dict[str, str]]]:
    return {
        table: fetch_db2_table(table, build)
        for table in (
            "UiMap",
            "UiMapArt",
            "UiMapArtStyleLayer",
            "UiMapArtTile",
            "UiMapAssignment",
            "UiMapXMapArt",
        )
    }


def coordinate_mapping(
    _wmo_doodad_placement_id: int,
    region_0: float,
    region_1: float,
    region_3: float,
    region_4: float,
) -> tuple[dict[str, float], str]:
    # WCL exposes both WMO and terrain positions in map-oriented axes: replay X
    # is negative world/Region Y and replay Y is world/Region X. UiMapAssignment
    # stores the unmodified world axes, so negate Region Y when constructing the
    # horizontal bounds. The authored image's vertical axis still runs opposite
    # to replay Y and is reflected by the renderer.
    bounds = {
        "left": min(-region_1, -region_4),
        "top": min(region_0, region_3),
        "right": max(-region_1, -region_4),
        "bottom": max(region_0, region_3),
    }
    return bounds, "flipY"


def resolve_sources(
    ui_map_ids: tuple[int, ...],
    tables: dict[str, list[dict[str, str]]],
) -> list[UiMapSource]:
    sources: list[UiMapSource] = []

    for ui_map_id in ui_map_ids:
        ui_map = require_one(
            [row for row in tables["UiMap"] if int(row["ID"]) == ui_map_id],
            f"UiMap row for {ui_map_id}",
        )
        art_link_candidates = [
            row for row in tables["UiMapXMapArt"]
            if int(row["UiMapID"]) == ui_map_id and int(row["PhaseID"]) == 0
        ]
        if not art_link_candidates:
            raise ValueError(f"UiMap {ui_map_id} has no phase-independent art")
        art_link = min(art_link_candidates, key=lambda row: int(row["ID"]))
        art_id = int(art_link["UiMapArtID"])
        art = require_one(
            [row for row in tables["UiMapArt"] if int(row["ID"]) == art_id],
            f"UiMapArt row for {ui_map_id}",
        )
        style_id = int(art["UiMapArtStyleID"])
        layer = require_one(
            [
                row for row in tables["UiMapArtStyleLayer"]
                if int(row["UiMapArtStyleID"]) == style_id
                and int(row["LayerIndex"]) == 0
            ],
            f"base art layer for UiMap {ui_map_id}",
        )

        # Phase/order variants commonly duplicate an assignment. Reject truly
        # different rectangles because selecting one silently would misalign a
        # replay and be much harder to diagnose than a failed build.
        assignments = [
            row for row in tables["UiMapAssignment"]
            if int(row["UiMapID"]) == ui_map_id
            and float(row["UiMin_0"]) == 0
            and float(row["UiMin_1"]) == 0
            and float(row["UiMax_0"]) == 1
            and float(row["UiMax_1"]) == 1
        ]
        distinct_assignments = {
            (
                int(row["MapID"]),
                int(row["WMODoodadPlacementID"]),
                float(row["Region_0"]),
                float(row["Region_1"]),
                float(row["Region_3"]),
                float(row["Region_4"]),
            )
            for row in assignments
        }
        assignment = require_one(
            list(distinct_assignments),
            f"world assignment for UiMap {ui_map_id}",
        )
        (
            world_map_id,
            wmo_doodad_placement_id,
            region_0,
            region_1,
            region_3,
            region_4,
        ) = assignment

        bounds, coordinate_transform = coordinate_mapping(
            wmo_doodad_placement_id,
            region_0,
            region_1,
            region_3,
            region_4,
        )

        tiles = tuple(
            sorted(
                (
                    UiMapArtTileSource(
                        row=int(row["RowIndex"]),
                        column=int(row["ColIndex"]),
                        file_data_id=int(row["FileDataID"]),
                    )
                    for row in tables["UiMapArtTile"]
                    if int(row["UiMapArtID"]) == art_id
                    and int(row["LayerIndex"]) == 0
                ),
                key=lambda tile: (tile.row, tile.column),
            )
        )
        if not tiles:
            raise ValueError(f"UiMap {ui_map_id} art {art_id} has no base-layer tiles")

        sources.append(UiMapSource(
            ui_map_id=ui_map_id,
            world_map_id=world_map_id,
            name=ui_map["Name_lang"],
            art_id=art_id,
            width=int(layer["LayerWidth"]),
            height=int(layer["LayerHeight"]),
            source_tile_width=int(layer["TileWidth"]),
            source_tile_height=int(layer["TileHeight"]),
            left=bounds["left"],
            top=bounds["top"],
            right=bounds["right"],
            bottom=bounds["bottom"],
            coordinate_transform=coordinate_transform,
            tiles=tiles,
        ))

    return sources


def resolve_fallback_maps(
    tables: dict[str, list[dict[str, str]]],
    bundled_ui_map_ids: set[int],
) -> list[dict[str, object]]:
    """Build a compact index for remote, low-resolution best-effort maps.

    Only a unique full-floor assignment is safe to use without encounter-level
    knowledge. Partial and ambiguous assignments intentionally fall back to the
    replay grid instead of rendering plausible-looking but misaligned art.
    """
    names = {int(row["ID"]): row["Name_lang"] for row in tables["UiMap"]}
    assignments_by_ui_map: dict[int, set[tuple[int, int, int, float, float, float, float]]] = {}

    for row in tables["UiMapAssignment"]:
        ui_map_id = int(row["UiMapID"])
        area_id = int(row["AreaID"])
        if ui_map_id in bundled_ui_map_ids or area_id <= 0:
            continue
        if (
            float(row["UiMin_0"]) != 0
            or float(row["UiMin_1"]) != 0
            or float(row["UiMax_0"]) != 1
            or float(row["UiMax_1"]) != 1
        ):
            continue

        assignment = (
            int(row["MapID"]),
            area_id,
            int(row["WMODoodadPlacementID"]),
            float(row["Region_0"]),
            float(row["Region_1"]),
            float(row["Region_3"]),
            float(row["Region_4"]),
        )
        assignments_by_ui_map.setdefault(ui_map_id, set()).add(assignment)

    fallback_maps: list[dict[str, object]] = []
    for ui_map_id, assignments in assignments_by_ui_map.items():
        if len(assignments) != 1 or ui_map_id not in names:
            continue
        (
            world_map_id,
            area_id,
            wmo_doodad_placement_id,
            region_0,
            region_1,
            region_3,
            region_4,
        ) = next(iter(assignments))
        bounds, coordinate_transform = coordinate_mapping(
            wmo_doodad_placement_id,
            region_0,
            region_1,
            region_3,
            region_4,
        )
        if bounds["left"] == bounds["right"] or bounds["top"] == bounds["bottom"]:
            continue

        fallback_maps.append({
            "uiMapID": ui_map_id,
            "worldMapID": world_map_id,
            "areaID": area_id,
            "name": names[ui_map_id],
            "coordinateTransform": coordinate_transform,
            "bounds": bounds,
        })

    return sorted(fallback_maps, key=lambda entry: int(entry["uiMapID"]))


def download_art_tile(tile: UiMapArtTileSource, build: str) -> tuple[UiMapArtTileSource, Image.Image]:
    query = urlencode({"version": build})
    payload = fetch_bytes(f"{WAGO_CASC_URL.format(file_data_id=tile.file_data_id)}?{query}")
    return tile, Image.open(BytesIO(payload)).convert("RGB")


def load_source_art(source: UiMapSource, build: str) -> Image.Image:
    image = Image.new("RGB", (source.width, source.height))
    with ThreadPoolExecutor(max_workers=8) as executor:
        downloaded = list(executor.map(
            lambda tile: download_art_tile(tile, build),
            source.tiles,
        ))

    for tile, tile_image in downloaded:
        expected_size = (source.source_tile_width, source.source_tile_height)
        if tile_image.size != expected_size:
            raise ValueError(
                f"UiMap {source.ui_map_id} tile {tile.row}_{tile.column} is "
                f"{tile_image.size}, expected {expected_size}"
            )
        image.paste(
            tile_image,
            (tile.column * source.source_tile_width, tile.row * source.source_tile_height),
        )

    return image


def save_level_tiles(
    source_image: Image.Image,
    destination: Path,
    scale: int,
    tile_pixels: int,
    quality: int,
) -> dict[str, int]:
    width = source_image.width * scale
    height = source_image.height * scale
    image = source_image if scale == 1 else source_image.resize(
        (width, height),
        Image.Resampling.LANCZOS,
    )
    columns = (width + tile_pixels - 1) // tile_pixels
    rows = (height + tile_pixels - 1) // tile_pixels
    destination.mkdir(parents=True, exist_ok=True)

    for row in range(rows):
        for column in range(columns):
            left = column * tile_pixels
            top = row * tile_pixels
            tile = image.crop((
                left,
                top,
                min(left + tile_pixels, width),
                min(top + tile_pixels, height),
            ))
            tile.save(
                destination / f"{row}_{column}.webp",
                "WEBP",
                quality=quality,
                method=6,
            )

    return {
        "scale": scale,
        "pixelWidth": width,
        "pixelHeight": height,
        "columns": columns,
        "rows": rows,
    }


def build_map(
    source: UiMapSource,
    build: str,
    levels: tuple[int, ...],
    tile_pixels: int,
    quality: int,
) -> dict[str, object]:
    source_image = load_source_art(source, build)
    staging_root = OUTPUT_DIRECTORY / f".staging-{source.ui_map_id}"
    if staging_root.exists():
        shutil.rmtree(staging_root)
    staging_root.mkdir(parents=True)
    try:
        level_manifests = [
            save_level_tiles(
                source_image,
                staging_root / str(scale),
                scale,
                tile_pixels,
                quality,
            )
            for scale in levels
        ]
        output = OUTPUT_DIRECTORY / str(source.ui_map_id)
        if output.exists():
            shutil.rmtree(output)
        shutil.move(str(staging_root), str(output))
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise

    return {
        "uiMapID": source.ui_map_id,
        "worldMapID": source.world_map_id,
        "name": source.name,
        "artID": source.art_id,
        "coordinateTransform": source.coordinate_transform,
        "bounds": {
            "left": source.left,
            "top": source.top,
            "right": source.right,
            "bottom": source.bottom,
        },
        "levels": level_manifests,
    }


def load_manifest() -> dict[str, object] | None:
    if not MANIFEST_PATH.exists():
        return None
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "ui_map_ids",
        metavar="UI_MAP_ID",
        type=int,
        nargs="*",
        help="only rebuild these UiMap floors (default: all configured raid floors)",
    )
    parser.add_argument("--build", default=SOURCE_BUILD, help="Retail build used by Wago CASC/DB2")
    parser.add_argument(
        "--levels",
        type=int,
        nargs="+",
        default=DEFAULT_LEVELS,
        help="positive integer upscale levels (default: 1 2 4 8)",
    )
    parser.add_argument("--tile-pixels", type=int, default=OUTPUT_TILE_PIXELS)
    parser.add_argument("--quality", type=int, default=WEBP_QUALITY)
    args = parser.parse_args()

    partial_build = bool(args.ui_map_ids)
    ui_map_ids = tuple(dict.fromkeys(args.ui_map_ids or DEFAULT_UI_MAP_IDS))
    levels = tuple(sorted(set(args.levels)))
    if not levels or any(level < 1 for level in levels):
        parser.error("levels must be positive integers")
    if args.tile_pixels < 256:
        parser.error("tile-pixels must be at least 256")
    if not 1 <= args.quality <= 100:
        parser.error("quality must be between 1 and 100")

    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    previous_manifest = load_manifest()
    if partial_build and previous_manifest and (
        previous_manifest.get("version") != 3
        or previous_manifest.get("sourceBuild") != args.build
        or previous_manifest.get("tilePixels") != args.tile_pixels
    ):
        parser.error(
            "a partial build cannot mix source builds, manifest versions, or tile sizes; "
            "rebuild all configured floors"
        )

    tables = fetch_db2_tables(args.build)
    sources = resolve_sources(ui_map_ids, tables)
    manifest_maps = {
        int(entry["uiMapID"]): entry
        for entry in (previous_manifest or {}).get("maps", [])
    } if partial_build else {}
    for source in sources:
        manifest_maps[source.ui_map_id] = build_map(
            source,
            args.build,
            levels,
            args.tile_pixels,
            args.quality,
        )
        print(f"Built UiMap {source.ui_map_id}: {source.name}")

    if not partial_build:
        for stale_output in OUTPUT_DIRECTORY.iterdir():
            if (
                stale_output.is_dir()
                and stale_output.name.isdigit()
                and int(stale_output.name) not in manifest_maps
            ):
                shutil.rmtree(stale_output)

    manifest = {
        "version": 3,
        "sourceBuild": args.build,
        "tilePixels": args.tile_pixels,
        "maps": [manifest_maps[key] for key in sorted(manifest_maps)],
        "fallbackMaps": resolve_fallback_maps(tables, set(manifest_maps)),
    }
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent="\t") + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
