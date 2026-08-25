export const POWER_INFUSION_SPELL_ID = 10060;

type ReviewCooldownActor = NonNullable<reviewCooldownEvent['source']>;

function actorsMatch(left: ReviewCooldownActor, right: ReviewCooldownActor) {
	if (left.id != null && right.id != null) return left.id === right.id;
	if (left.guid != null && right.guid != null) return left.guid === right.guid;
	return Boolean(left.name && right.name && left.name === right.name);
}

function isNonPlayerTarget(actor: ReviewCooldownActor) {
	const actorType = actor.type?.toLowerCase();
	return (
		actor.name?.toLowerCase() === 'environment'
		|| actorType === 'environment'
		|| actorType === 'npc'
		|| actorType === 'pet'
		|| actorType === 'boss'
	);
}

export function isPowerInfusionEvent(event: reviewCooldownEvent) {
	return event.cooldown.spellID === POWER_INFUSION_SPELL_ID;
}

/** Power Infusion is presented as a DPS cooldown even for older cached catalogs. */
export function getReviewCooldownGroups(event: reviewCooldownEvent): readonly reviewCooldownGroupID[] {
	return isPowerInfusionEvent(event) ? ['dps_cd'] : event.cooldown.groups;
}

export function getReviewCooldownPrimaryGroup(event: reviewCooldownEvent): reviewCooldownGroupID {
	return isPowerInfusionEvent(event) ? 'dps_cd' : event.cooldown.primaryGroup;
}

/**
 * External cooldowns are useful to both the caster and their recipient, so the
 * same WCL cast appears on both player lanes without manufacturing another
 * event. Power Infusion uses the same attribution even though it is presented
 * exclusively as a DPS cooldown.
 */
export function getReviewCooldownDisplayActors(event: reviewCooldownEvent): ReviewCooldownActor[] {
	const actors: ReviewCooldownActor[] = event.source ? [event.source] : [];
	const target = event.target;
	const displaysOnTarget = (
		isPowerInfusionEvent(event)
		|| event.cooldown.groups.includes('externals')
	);

	if (
		displaysOnTarget
		&& target
		&& !isNonPlayerTarget(target)
		&& !actors.some(actor => actorsMatch(actor, target))
	) {
		actors.push(target);
	}

	return actors.length > 0 ? actors : [{ name: 'Unknown player' }];
}
