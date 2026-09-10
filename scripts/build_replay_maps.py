"""Build bundled replay minimap tiles from the WoW client assets.

Development-only requirements: Python 3 and Pillow. Tile FileDataIDs come from
the wowdev community listfile (or a local wow.tools.local listfile) and the BLP
payloads are downloaded from Wago's CASC endpoint for the pinned Retail build.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image, ImageChops


@dataclass(frozen=True)
class MinimapTileSource:
    x: int
    y: int
    file_data_id: int


@dataclass(frozen=True)
class LightArtifactRepair:
    """Softly attenuate a baked minimap light effect in replay-oriented pixels."""

    tile_x: int
    tile_y: int
    center_x: float
    center_y: float
    radius_x: float
    radius_y: float
    strength: float


@dataclass(frozen=True)
class MinimapSource:
    tile_size: tuple[int, int]
    empty_color: tuple[int, int, int] | None
    tiles: tuple[MinimapTileSource, ...]
    light_artifact_repairs: tuple[LightArtifactRepair, ...] = ()


def minimap_source(
    entries: tuple[tuple[int, int, int], ...],
    *,
    light_artifact_repairs: tuple[LightArtifactRepair, ...] = (),
) -> MinimapSource:
    return MinimapSource(
        tile_size=(512, 512),
        empty_color=(109, 112, 109),
        tiles=tuple(MinimapTileSource(*entry) for entry in entries),
        light_artifact_repairs=light_artifact_repairs,
    )


# Only tiles containing raid geometry are needed. The first build used the full
# 26..34 by 24..32 listfile rectangle; fully empty tiles were then pruned here.
MAP_SOURCES = {
    3004: minimap_source(
        (
            (31, 28, 7296861),
            (32, 28, 7296893),
            (31, 29, 7296867),
            (32, 29, 7296899),
            (30, 30, 7296961),
            (31, 30, 7296963),
            (32, 30, 7296995),
            (33, 30, 7296997),
            (30, 31, 7296967),
            (31, 31, 7296969),
            (32, 31, 7297001),
            (33, 31, 7297003),
            (31, 32, 7296975),
            (32, 32, 7297007),
        ),
        # Blizzard's Coiled Altar minimap capture contains a tall white light
        # bloom across the 31/32 seam that is not part of the room in-game.
        # Keep the repair in asset generation: a runtime SVG overlay would move
        # with neither the minimap pixels nor future tile transforms reliably.
        light_artifact_repairs=(
            LightArtifactRepair(32, 29, 512, 78, 36, 100, 0.55),
            LightArtifactRepair(31, 29, 0, 78, 36, 100, 0.55),
        ),
    ),
}
SOURCE_BUILD = "12.1.0.69587"
OUTPUT_DIRECTORY = Path(__file__).parents[1] / "app" / "assets" / "replay-maps" / "minimap"


def load_tile(source: MinimapTileSource) -> tuple[MinimapTileSource, Image.Image]:
    request = Request(
        f"https://wago.tools/api/casc/{source.file_data_id}?version={SOURCE_BUILD}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urlopen(request, timeout=30) as response:
        return source, Image.open(BytesIO(response.read())).convert("RGB")


def repair_light_artifacts(
    images: dict[tuple[int, int], Image.Image],
    repairs: tuple[LightArtifactRepair, ...],
) -> None:
    for repair in repairs:
        key = (repair.tile_x, repair.tile_y)
        image = images.get(key)
        if image is None:
            raise ValueError(f"Light artifact repair references missing tile {key}")

        repaired = image.convert("RGBA")
        pixels = repaired.load()
        min_x = max(0, int(repair.center_x - repair.radius_x))
        max_x = min(repaired.width - 1, int(repair.center_x + repair.radius_x))
        min_y = max(0, int(repair.center_y - repair.radius_y))
        max_y = min(repaired.height - 1, int(repair.center_y + repair.radius_y))

        for y in range(min_y, max_y + 1):
            dy = (y - repair.center_y) / repair.radius_y
            for x in range(min_x, max_x + 1):
                dx = (x - repair.center_x) / repair.radius_x
                distance_squared = dx * dx + dy * dy
                if distance_squared >= 1:
                    continue

                falloff = 1 - distance_squared
                falloff = falloff * falloff * (3 - 2 * falloff)
                factor = 1 - repair.strength * falloff
                red, green, blue, alpha = pixels[x, y]
                luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                desaturation = 0.7 * falloff
                pixels[x, y] = (
                    round((red * (1 - desaturation) + luminance * desaturation) * factor),
                    round((green * (1 - desaturation) + luminance * desaturation) * factor),
                    round((blue * (1 - desaturation) + luminance * desaturation) * factor),
                    alpha,
                )

        images[key] = repaired


def build_map(world_map_id: int, source: MinimapSource) -> None:
    output = OUTPUT_DIRECTORY / str(world_map_id)
    output.mkdir(parents=True, exist_ok=True)
    expected_names: set[str] = set()
    processed_images: dict[tuple[int, int], Image.Image] = {}

    with ThreadPoolExecutor(max_workers=8) as executor:
        tiles = list(executor.map(load_tile, source.tiles))

    for tile_source, image in tiles:
        if image.size != source.tile_size:
            raise ValueError(
                f"Map {world_map_id} tile {tile_source.x}_{tile_source.y} is "
                f"{image.size}, expected {source.tile_size}"
            )

        if source.empty_color is not None:
            background = Image.new("RGB", image.size, source.empty_color)
            difference = ImageChops.difference(image, background)
            red, green, blue = difference.split()
            alpha = ImageChops.lighter(ImageChops.lighter(red, green), blue)
            alpha = alpha.point(lambda value: 0 if value == 0 else 255)
            image = image.convert("RGBA")
            image.putalpha(alpha)

        if image.getbbox() is None:
            continue

        # Minimap pixels run opposite to WCL world coordinates on both axes.
        # Bake the fixed 180-degree transform once so the renderer can place
        # every tile as a plain SVG image without per-frame SVG transforms.
        image = image.transpose(Image.Transpose.ROTATE_180)

        processed_images[(tile_source.x, tile_source.y)] = image

    repair_light_artifacts(processed_images, source.light_artifact_repairs)

    for tile_source, _image in tiles:
        image = processed_images.get((tile_source.x, tile_source.y))
        if image is None:
            continue

        asset_name = f"{tile_source.x}_{tile_source.y}.webp"
        expected_names.add(asset_name)

        # The source minimaps already contain real close-range terrain detail.
        # Lossless WebP preserves it and is considerably smaller than decoded
        # RGBA. Keep tiles separate so Chromium only decodes the current view.
        image.save(
            output / asset_name,
            "WEBP",
            lossless=True,
            quality=100,
            method=6,
        )

    for stale_asset in output.glob("*.webp"):
        if stale_asset.name not in expected_names:
            stale_asset.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "map_ids",
        metavar="WORLD_MAP_ID",
        type=int,
        nargs="*",
        help="only rebuild these configured terrain maps (default: all)",
    )
    requested = parser.parse_args().map_ids
    unknown = sorted(set(requested) - MAP_SOURCES.keys())
    if unknown:
        parser.error(f"unconfigured world map IDs: {', '.join(map(str, unknown))}")

    selected = requested or MAP_SOURCES.keys()
    for world_map_id in selected:
        build_map(world_map_id, MAP_SOURCES[world_map_id])
        print(f"Built minimap tiles for {world_map_id}")


if __name__ == "__main__":
    main()
