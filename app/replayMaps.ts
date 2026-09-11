import replayMapManifest from './assets/replay-maps/uimap/manifest.json';

const replayMapAssetURLs = import.meta.glob<string>(
	'./assets/replay-maps/uimap/**/*.webp',
	{ eager: true, query: '?url', import: 'default' },
);

export interface ReplayMapPoint {
	x: number;
	y: number;
}

export interface ReplayMapBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface ReplayMapTile {
	key: string;
	imageURL: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ReplayMapLevel {
	scale: number;
	pixelWidth: number;
	pixelHeight: number;
	pixelsPerWorldUnit: number;
	tileWorldSize: number;
	tiles: readonly ReplayMapTile[];
}

export interface ReplayMapDefinition {
	uiMapID: number;
	worldMapID: number;
	name: string;
	artID: number;
	coordinateTransform: ReplayMapCoordinateTransform;
	bounds: ReplayMapBounds;
	levels: readonly ReplayMapLevel[];
}

export type ReplayMapCoordinateTransform = 'none' | 'flipY';

interface ReplayMapManifestLevel {
	scale: number;
	pixelWidth: number;
	pixelHeight: number;
	columns: number;
	rows: number;
}

interface ReplayMapManifestEntry {
	uiMapID: number;
	worldMapID: number;
	name: string;
	artID: number;
	coordinateTransform: ReplayMapCoordinateTransform;
	bounds: ReplayMapBounds;
	levels: ReplayMapManifestLevel[];
}

interface ReplayMapFallbackManifestEntry {
	uiMapID: number;
	worldMapID: number;
	areaID: number;
	name: string;
	coordinateTransform: ReplayMapCoordinateTransform;
	bounds: ReplayMapBounds;
}

interface ReplayMapManifest {
	version: number;
	sourceBuild: string;
	tilePixels: number;
	maps: ReplayMapManifestEntry[];
	fallbackMaps: ReplayMapFallbackManifestEntry[];
}

/**
 * REPLAY MAP MAINTENANCE GUIDE
 * ============================
 *
 * Asset model
 * -----------
 * Replays use the same Blizzard UiMap floor art shown by WoW and WCL. Source
 * floors are normally split into 256px BLP files and are often only 1002x668
 * in total. `scripts/build_replay_maps.py` assembles those source files, creates
 * 1x/2x/4x/8x versions offline, and cuts every version into bounded 1024px WebP
 * tiles. The source images are never fetched or transformed at runtime.
 *
 * This is a tile pyramid rather than one huge upscaled texture. At whole-pull
 * zoom the renderer selects the 1x or 2x level. At close zoom it selects a
 * sharper level, then mounts only tiles intersecting the SVG viewport plus a
 * small overscan ring. A 1024px RGB tile decodes to roughly 4 MiB regardless of
 * the full floor dimensions, so 8x art does not imply an 8x floor-sized GPU
 * allocation. `import.meta.glob` eagerly resolves content-hashed URLs, but an
 * image is decoded only while its SVG `<image>` element is mounted.
 *
 * Where maps and coordinates come from
 * ------------------------------------
 * The builder follows Blizzard's current client tables instead of maintaining
 * per-file paths by hand:
 *
 * - UiMap identifies the floor exposed by WCL fight metadata/resource events.
 * - UiMapXMapArt resolves that floor to its phase-independent UiMapArt row.
 * - UiMapArt and UiMapArtStyleLayer describe the source canvas.
 * - UiMapArtTile contains the source BLP FileDataIDs and tile positions.
 * - UiMapAssignment maps normalized art coordinates to the terrain Map ID and
 *   coordinate rectangle. WCL's replay convention is X = -Region Y and
 *   Y = Region X for both WMO and terrain floors. Blizzard maps those
 *   coordinates onto the floor art as (uiX, 1 - uiY), so generated horizontal
 *   bounds negate the assignment's Region Y values and the manifest marks the
 *   floor with `flipY`. This sign conversion matters: sorting the raw Region Y
 *   values produces plausible bounds on the opposite side of the origin and
 *   leaves the map invisible once the viewport follows its actors.
 *
 * WCL positions are hundredths of a yard on the server and are normalized to
 * yards before reaching this module. A position event may identify the UiMap
 * floor directly or only its shared terrain Map ID. Direct floor IDs win. For
 * a terrain ID, `resolveReplayMapDefinition` narrows candidates using fight
 * floor metadata and observed positions, which avoids hard-coded encounter
 * offsets and keeps multi-floor instances usable.
 *
 * Adding or updating floors
 * -------------------------
 * 1. Find the UiMap floor IDs in WCL fight `maps { id }` metadata or in
 *    `https://wago.tools/db2/UiMap`. Do not use the terrain Map ID as builder
 *    input; several floors commonly share it.
 * 2. Add current raid floors to DEFAULT_UI_MAP_IDS in the builder, or validate
 *    one floor first with:
 *
 *        python scripts/build_replay_maps.py <UI_MAP_ID>
 *
 *    Pillow is the only development dependency. The Retail build is pinned so
 *    FileDataIDs and DB rows are reproducible. A partial build replaces only
 *    the requested manifest entries and leaves other bundled floors intact.
 * 3. The builder rejects missing/ambiguous art or world assignments. Do not
 *    silence that check with a guessed rectangle: a failed build is safer than
 *    a convincing but misaligned replay. Phase-specific art needs an explicit
 *    design before selecting a non-zero UiMapXMapArt PhaseID.
 * 4. Inspect a base-level tile and a maximum-level tile, then verify player
 *    positions at pull start and after movement. Test both Follow and Whole
 *    pull modes, pan across tile boundaries, and watch process/GPU memory while
 *    zooming. The generated pyramid is intentionally excluded from Vite's file
 *    watcher to prevent one replay remount per tile, so restart the dev renderer
 *    once generation finishes. An unsupported floor must still fall back to the
 *    normal grid.
 * 5. Run `npx vue-tsc` and a production Vite build. Assets are local and
 *    content-hashed; adding a floor creates no WCL/Wago runtime traffic and
 *    requires no replay protocol bump. Bump REVIEW_REPLAY_VERSION on client and
 *    server only when the serialized FightReplayData shape changes.
 *
 * Unsupported-floor fallback
 * --------------------------
 * The manifest also contains a compact index of unambiguous, full-floor
 * UiMapAssignment rows. When a floor has no bundled pyramid, the renderer uses
 * its AreaID to try Wowhead's 1002x668 area-map image. This is intentionally a
 * best-effort network fallback: it is lower resolution, may not exist for a new
 * or phased area, and silently leaves the normal grid visible on image failure.
 * Never include partial or ambiguous assignments merely to increase coverage;
 * a missing background is safer than a misaligned one.
 *
 * Quality and resource tradeoffs
 * ------------------------------
 * The current levels use deterministic Lanczos upscaling. It removes the harsh
 * browser enlargement seen at close zoom, but cannot reconstruct geometry that
 * Blizzard did not paint into the source floor. If a future offline ML scaler
 * is adopted, feed its output into the same tiled levels and keep the manifest
 * contract unchanged. Avoid lossless output for upscaled art: interpolated
 * pixels compress poorly while decoded GPU cost is unchanged. Do not increase
 * tile dimensions casually; fewer files also means much larger unavoidable
 * per-tile GPU allocations.
 *
 * Current data/assets snapshot: Retail 12.1.0.69587.
 */

const manifest = replayMapManifest as ReplayMapManifest;
if (manifest.version !== 3) {
	throw new Error(`Unsupported replay map manifest version ${manifest.version}`);
}

/** Project a WCL position into the authored floor-art coordinate system. */
export function projectReplayMapPosition<
	T extends ReplayMapPoint & { facingDegrees?: number },
>(definition: ReplayMapDefinition, position: T): T {
	if (definition.coordinateTransform === 'none') return position;

	const facingDegrees = position.facingDegrees == null
		? undefined
		: (360 - position.facingDegrees) % 360;

	return {
		...position,
		y: definition.bounds.top + definition.bounds.bottom - position.y,
		...(facingDegrees == null
			? {}
			: { facingDegrees }),
	};
}

interface ParsedReplayMapAsset {
	uiMapID: number;
	scale: number;
	row: number;
	column: number;
}

function parseReplayMapAsset(path: string): ParsedReplayMapAsset | null {
	const match = path.match(/\/uimap\/(\d+)\/(\d+)\/(\d+)_(\d+)\.webp$/);
	if (!match) return null;
	return {
		uiMapID: Number(match[1]),
		scale: Number(match[2]),
		row: Number(match[3]),
		column: Number(match[4]),
	};
}

const assetsByLevel = new Map<string, Array<ParsedReplayMapAsset & { imageURL: string }>>();
for (const [path, imageURL] of Object.entries(replayMapAssetURLs)) {
	const asset = parseReplayMapAsset(path);
	if (!asset) continue;
	const key = `${asset.uiMapID}:${asset.scale}`;
	const existing = assetsByLevel.get(key) || [];
	existing.push({ ...asset, imageURL });
	assetsByLevel.set(key, existing);
}

function buildLevel(
	entry: ReplayMapManifestEntry,
	level: ReplayMapManifestLevel,
): ReplayMapLevel {
	const worldWidth = entry.bounds.right - entry.bounds.left;
	const worldHeight = entry.bounds.bottom - entry.bounds.top;
	const worldUnitsPerPixelX = worldWidth / level.pixelWidth;
	const worldUnitsPerPixelY = worldHeight / level.pixelHeight;
	const assets = assetsByLevel.get(`${entry.uiMapID}:${level.scale}`) || [];
	const tiles = assets.map(asset => {
		const pixelX = asset.column * manifest.tilePixels;
		const pixelY = asset.row * manifest.tilePixels;
		const pixelWidth = Math.min(manifest.tilePixels, level.pixelWidth - pixelX);
		const pixelHeight = Math.min(manifest.tilePixels, level.pixelHeight - pixelY);
		return {
			key: `${entry.uiMapID}:${level.scale}:${asset.row}:${asset.column}`,
			imageURL: asset.imageURL,
			x: entry.bounds.left + pixelX * worldUnitsPerPixelX,
			y: entry.bounds.top + pixelY * worldUnitsPerPixelY,
			width: pixelWidth * worldUnitsPerPixelX,
			height: pixelHeight * worldUnitsPerPixelY,
		};
	}).sort((left, right) => left.y - right.y || left.x - right.x);

	const expectedTileCount = level.columns * level.rows;
	if (tiles.length !== expectedTileCount) {
		throw new Error(
			`Replay map ${entry.uiMapID} level ${level.scale}x has `
			+ `${tiles.length} tiles; expected ${expectedTileCount}`,
		);
	}

	return {
		...level,
		pixelsPerWorldUnit: Math.min(
			level.pixelWidth / worldWidth,
			level.pixelHeight / worldHeight,
		),
		tileWorldSize: Math.max(
			manifest.tilePixels * worldUnitsPerPixelX,
			manifest.tilePixels * worldUnitsPerPixelY,
		),
		tiles,
	};
}

const BUNDLED_REPLAY_MAPS = new Map<number, ReplayMapDefinition>(
	manifest.maps.map(entry => [entry.uiMapID, {
		...entry,
		levels: entry.levels
			.map(level => buildLevel(entry, level))
			.sort((left, right) => left.scale - right.scale),
	}]),
);

const WOWHEAD_MAP_WIDTH = 1002;
const WOWHEAD_MAP_HEIGHT = 668;

function buildFallbackDefinition(entry: ReplayMapFallbackManifestEntry): ReplayMapDefinition {
	const worldWidth = entry.bounds.right - entry.bounds.left;
	const worldHeight = entry.bounds.bottom - entry.bounds.top;
	return {
		uiMapID: entry.uiMapID,
		worldMapID: entry.worldMapID,
		name: entry.name,
		artID: 0,
		coordinateTransform: entry.coordinateTransform,
		bounds: entry.bounds,
		levels: [{
			scale: 1,
			pixelWidth: WOWHEAD_MAP_WIDTH,
			pixelHeight: WOWHEAD_MAP_HEIGHT,
			pixelsPerWorldUnit: Math.min(
				WOWHEAD_MAP_WIDTH / worldWidth,
				WOWHEAD_MAP_HEIGHT / worldHeight,
			),
			tileWorldSize: Math.max(worldWidth, worldHeight),
			tiles: [{
				key: `fallback:${entry.uiMapID}`,
				imageURL: `https://wow.zamimg.com/images/wow/maps/enus/original/${entry.areaID}.jpg`,
				x: entry.bounds.left,
				y: entry.bounds.top,
				width: worldWidth,
				height: worldHeight,
			}],
		}],
	};
}

const FALLBACK_REPLAY_MAPS = new Map<number, ReplayMapDefinition>(
	manifest.fallbackMaps.map(entry => [entry.uiMapID, buildFallbackDefinition(entry)]),
);
const REPLAY_MAPS = new Map<number, ReplayMapDefinition>([
	...FALLBACK_REPLAY_MAPS,
	...BUNDLED_REPLAY_MAPS,
]);

const WORLD_MAPS = new Map<number, ReplayMapDefinition[]>();
for (const definition of REPLAY_MAPS.values()) {
	const definitions = WORLD_MAPS.get(definition.worldMapID) || [];
	definitions.push(definition);
	WORLD_MAPS.set(definition.worldMapID, definitions);
}

function pointInMap(definition: ReplayMapDefinition, point: ReplayMapPoint): boolean {
	return point.x >= definition.bounds.left
		&& point.x <= definition.bounds.right
		&& point.y >= definition.bounds.top
		&& point.y <= definition.bounds.bottom;
}

function chooseByObservedPositions(
	definitions: readonly ReplayMapDefinition[],
	points: readonly ReplayMapPoint[],
): ReplayMapDefinition | undefined {
	const bestMatch = definitions
		.map(definition => ({
			definition,
			matches: points.reduce(
				(total, point) => total + Number(pointInMap(definition, point)),
				0,
			),
		}))
		.sort((left, right) => right.matches - left.matches)[0];

	return bestMatch?.matches ? bestMatch.definition : undefined;
}

/** Resolve exact floor art first, then disambiguate a shared terrain map. */
export function resolveReplayMapDefinition(
	eventMapID: number | undefined,
	uiMapIDs: readonly number[],
	points: readonly ReplayMapPoint[] = [],
): ReplayMapDefinition | undefined {
	if (eventMapID != null) {
		const exact = REPLAY_MAPS.get(eventMapID);
		if (exact) return exact;
	}

	const fightMaps = uiMapIDs.flatMap(uiMapID => {
		const definition = REPLAY_MAPS.get(uiMapID);
		return definition ? [definition] : [];
	});
	const terrainMaps = eventMapID == null ? [] : (WORLD_MAPS.get(eventMapID) || []);
	const candidates = fightMaps.length
		? fightMaps.filter(definition => !terrainMaps.length || terrainMaps.includes(definition))
		: terrainMaps;
	if (candidates.length <= 1) return candidates[0];

	return chooseByObservedPositions(candidates, points);
}
