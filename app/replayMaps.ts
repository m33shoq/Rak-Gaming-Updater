const minimapAssetURLs = import.meta.glob<string>(
	'./assets/replay-maps/minimap/**/*.webp',
	{ eager: true, query: '?url', import: 'default' },
);

const MINIMAP_TILE_WORLD_SIZE = 1600 / 3;

export interface ReplayMapTile {
	key: string;
	imageURL: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ReplayMapDefinition {
	worldMapID: number;
	uiMapIDs: readonly number[];
	name: string;
	tileWorldSize: number;
	tiles: readonly ReplayMapTile[];
}

interface ReplayMapConfig {
	worldMapID: number;
	uiMapIDs: readonly number[];
	name: string;
}

/**
 * REPLAY MAP MAINTENANCE GUIDE
 * ============================
 *
 * Why minimap tiles
 * -----------------
 * UiMapArt is the parchment-style world map. A complete floor is commonly only
 * 1002x668 and an encounter room may occupy a few hundred source pixels. Making
 * that image 6x or 12x consumes large amounts of decoded GPU memory without
 * recovering detail. WoW's separate `World/Minimaps` assets are 512px terrain
 * tiles tied to fixed world-space squares. They are both more representative of
 * the room and naturally support viewport-aware loading.
 *
 * The renderer mounts only minimap tiles intersecting the visible replay view.
 * A close zoom therefore decodes a handful of 512px images instead of a full
 * raid-sized monolith. Keep assets tiled; do not stitch or upscale them.
 *
 * Data and coordinate model
 * -------------------------
 * WCL resource events can expose a UiMap.db2 floor ID in `mapID` (Coiled Altar
 * reports 2610), while minimap assets are grouped under the terrain Map.db2 ID
 * (3004). Fight `maps { id }` metadata also contains UiMap floor IDs. Add every
 * known floor alias to the config below so either source resolves to the same
 * terrain tiles. Multiple floors may share one minimap layer; WCL does not
 * expose Z coordinates, so overlapping vertical geometry cannot be separated
 * reliably from positions alone.
 *
 * Each minimap tile covers one ADT square: 533 1/3 yards. WoW tile coordinates
 * are centered around index 32. Replay processing converts WCL hundredths of a
 * yard to yards. Minimap pixels increase in the opposite direction from WCL
 * world coordinates on both axes. The builder applies Pillow's deterministic
 * ROTATE_180 operation to each tile. For a client tile named
 * `map<TILE_X>_<TILE_Y>.blp`, its replay rectangle is then:
 *
 *     size   = 1600 / 3
 *     x      = (31 - TILE_X) * size
 *     y      = (31 - TILE_Y) * size
 *     width  = size
 *     height = size
 *
 * Do not add another SVG rotation or flip: the converted WebP is already in the
 * replay orientation.
 *
 * Finding assets for a new terrain map
 * ------------------------------------
 * 1. Identify the terrain Map.db2 ID from replay events. If needed, use the
 *    Directory column in `https://wago.tools/db2/Map` to confirm the map.
 * 2. Obtain the current wowdev community listfile. A local wow.tools.local
 *    installation also has `listfile.csv`. Search for:
 *
 *        ;World/Minimaps/<WORLD_MAP_ID>/
 *
 *    Entries have the form:
 *
 *        <FILE_DATA_ID>;World/Minimaps/3004/map30_31.blp
 *
 *    Modern listfile names are community-maintained, so pin the numeric
 *    FileDataIDs in `scripts/build_replay_maps.py`; never resolve filenames in
 *    the production renderer.
 * 3. Add a MinimapSource entry to that script. For the first pass, include the
 *    complete listfile rectangle so disconnected rooms are not accidentally
 *    missed. The builder omits fully empty outputs; after visual verification,
 *    remove those empty source tuples to keep later rebuilds quick. A smaller
 *    non-rectangular set is expected, but check all boss rooms, transition
 *    corridors, and known out-of-bounds positions before trimming it.
 * 4. Update SOURCE_BUILD to the exact Retail build used to validate the IDs.
 *    Install the development-only converter with:
 *
 *        python -m pip install Pillow==11.3.0
 *
 *    Then rebuild one map with:
 *
 *        python scripts/build_replay_maps.py <WORLD_MAP_ID>
 *
 * 5. The script downloads BLP data from Wago's CASC endpoint, validates the
 *    native 512x512 dimensions, removes the map's known empty background color,
 *    omits fully empty tiles, and writes lossless WebP tiles below
 *    `app/assets/replay-maps/minimap/<WORLD_MAP_ID>/`. Lossless output matters:
 *    the source is already compressed and a second lossy pass damages fine room
 *    edges and floor markings. Inspect both an occupied tile and a transparent
 *    empty tile before committing.
 *
 *    Minimap captures can contain transient-looking lighting or spell effects
 *    baked into the client asset. Do not hide those with a renderer overlay:
 *    that makes the correction depend on the current SVG viewport and is easy
 *    to misalign later. Add a narrowly scoped repair to the corresponding
 *    MinimapSource in the builder instead. Repair coordinates are pixels after
 *    the fixed 180-degree replay transform. Keep the strength feathered, name
 *    the affected encounter in a comment, and compare the rebuilt tile against
 *    both an in-game screenshot and a WCL pull before committing it.
 * 6. Add a ReplayMapConfig entry below. The import glob discovers tile assets
 *    from their `<TILE_X>_<TILE_Y>.webp` names, so no per-file imports are
 *    required. Run `vue-tsc`, the replay tests, and a production Vite build.
 *
 * Visual verification checklist
 * -----------------------------
 * - Open a pull with known player positions and turn the yard grid on.
 * - Confirm actors stand on the expected platforms at pull start and after a
 *   transition. A mirrored or 533-yard-shifted result is a transform bug, not a
 *   reason to hand-adjust the image.
 * - Treat map quality as encounter-specific even when several fights use one
 *   terrain map. Player coordinates can prove alignment, but they cannot fill
 *   geometry or remove lighting already missing/baked into Blizzard's image.
 * - Pan across a tile boundary and confirm there is no seam or loading flash.
 * - Zoom to the maximum and watch process/GPU memory. Only visible tiles plus
 *   the small overscan margin should be mounted.
 * - Verify an unsupported map still displays the normal grid without errors.
 *
 * Release behavior
 * ----------------
 * Tiles are bundled and content-hashed by Vite, so runtime replay does not
 * depend on Wago and adds no WCL event requests. Adding assets/config does not
 * require a replay protocol bump. Bump REVIEW_REPLAY_VERSION on both client and
 * server only when the serialized ReplayData contract changes.
 *
 * Current data/assets snapshot: Retail 12.1.0.69587.
 */
const REPLAY_MAP_CONFIGS: readonly ReplayMapConfig[] = [
	{
		worldMapID: 3004,
		uiMapIDs: [2606, 2607, 2608, 2609, 2610],
		name: 'The Venomous Abyss',
	},
];

function parseMinimapAsset(path: string): {
	worldMapID: number;
	tileX: number;
	tileY: number;
} | null {
	const match = path.match(/\/minimap\/(\d+)\/(\d+)_(\d+)\.webp$/);
	if (!match) return null;
	return {
		worldMapID: Number(match[1]),
		tileX: Number(match[2]),
		tileY: Number(match[3]),
	};
}

function buildTiles(worldMapID: number): ReplayMapTile[] {
	return Object.entries(minimapAssetURLs).flatMap(([path, imageURL]) => {
		const asset = parseMinimapAsset(path);
		if (!asset || asset.worldMapID !== worldMapID) return [];

		return [{
			key: `${worldMapID}:${asset.tileX}:${asset.tileY}`,
			imageURL,
			x: (31 - asset.tileX) * MINIMAP_TILE_WORLD_SIZE,
			y: (31 - asset.tileY) * MINIMAP_TILE_WORLD_SIZE,
			width: MINIMAP_TILE_WORLD_SIZE,
			height: MINIMAP_TILE_WORLD_SIZE,
		}];
	}).sort((left, right) => left.y - right.y || left.x - right.x);
}

const REPLAY_MAPS = new Map<number, ReplayMapDefinition>(
	REPLAY_MAP_CONFIGS.map(config => [config.worldMapID, {
		...config,
		tileWorldSize: MINIMAP_TILE_WORLD_SIZE,
		tiles: buildTiles(config.worldMapID),
	}]),
);
const UI_MAP_TO_WORLD_MAP = new Map<number, number>(
	REPLAY_MAP_CONFIGS.flatMap(config => (
		config.uiMapIDs.map(uiMapID => [uiMapID, config.worldMapID] as const)
	)),
);

export function getReplayMapDefinition(mapID?: number): ReplayMapDefinition | undefined {
	if (mapID == null) return undefined;
	return REPLAY_MAPS.get(mapID) || REPLAY_MAPS.get(UI_MAP_TO_WORLD_MAP.get(mapID) || -1);
}

/** Resolve a terrain minimap from an event map ID, then from fight floor IDs. */
export function resolveReplayMapDefinition(
	eventMapID: number | undefined,
	uiMapIDs: readonly number[],
): ReplayMapDefinition | undefined {
	const direct = getReplayMapDefinition(eventMapID);
	if (direct) return direct;

	for (const uiMapID of uiMapIDs) {
		const definition = getReplayMapDefinition(uiMapID);
		if (definition) return definition;
	}
	return undefined;
}
