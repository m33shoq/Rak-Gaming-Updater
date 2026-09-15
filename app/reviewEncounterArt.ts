import nymrissaWavecallerArt from '@/assets/review-encounters/3379.webp';
import sszorakArt from '@/assets/review-encounters/3420.webp';
import twinFangsArt from '@/assets/review-encounters/3421.webp';
import coiledAltarArt from '@/assets/review-encounters/3429.webp';
import entombedSentinelsArt from '@/assets/review-encounters/3445.webp';
import vashnikArt from '@/assets/review-encounters/3455.webp';
import nekzaliArt from '@/assets/review-encounters/3470.webp';
import ulatekArt from '@/assets/review-encounters/3492.webp';
import lostExplorersArt from '@/assets/review-encounters/3497.webp';

// Maintenance workflow and source provenance: docs/reviews-maintenance.md
const REVIEW_ENCOUNTER_ART: Readonly<Record<number, string>> = {
	3379: nymrissaWavecallerArt,
	3420: sszorakArt,
	3421: twinFangsArt,
	3429: coiledAltarArt,
	3445: entombedSentinelsArt,
	3455: vashnikArt,
	3470: nekzaliArt,
	3492: ulatekArt,
	3497: lostExplorersArt,
};

export function getReviewEncounterArt(encounterID: number | null | undefined): string | undefined {
	if (typeof encounterID !== 'number' || !Number.isFinite(encounterID)) return undefined;
	return REVIEW_ENCOUNTER_ART[encounterID];
}
