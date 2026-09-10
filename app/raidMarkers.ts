const RAID_MARKER_ASSET_ROOT = 'https://warcraft.wiki.gg/images';

export interface RaidMarkerDefinition {
	label: string;
	icon: string;
	color: string;
	symbol: string;
}

export const RAID_MARKERS: Readonly<Record<number, RaidMarkerDefinition>> = {
	1: { label: 'Star', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidStar.png`, color: '#facc15', symbol: '★' },
	2: { label: 'Circle', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidCircle.png`, color: '#f97316', symbol: '●' },
	3: { label: 'Diamond', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidDiamond.png`, color: '#c084fc', symbol: '◆' },
	4: { label: 'Triangle', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidTriangle.png`, color: '#22c55e', symbol: '▲' },
	5: { label: 'Moon', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidMoon.png`, color: '#93c5fd', symbol: '◐' },
	6: { label: 'Square', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidSquare.png`, color: '#3b82f6', symbol: '■' },
	7: { label: 'Cross', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidCross.png`, color: '#ef4444', symbol: '✕' },
	8: { label: 'Skull', icon: `${RAID_MARKER_ASSET_ROOT}/IconSmall_RaidSkull.png`, color: '#e5e7eb', symbol: '☠' },
};

export function getRaidMarker(marker?: number): RaidMarkerDefinition | undefined {
	return marker == null ? undefined : RAID_MARKERS[marker];
}
