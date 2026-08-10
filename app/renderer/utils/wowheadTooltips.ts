const WOWHEAD_LINK_SELECTOR = 'a[data-wowhead]';
const WOWHEAD_TOOLTIP_SELECTOR = '.wowhead-tooltip';
const TOOLTIP_FOOTER_CLASS = 'rg-wowhead-tooltip-footer';

let activeSpellID: string | null = null;
let tooltipObserver: MutationObserver | null = null;

function getSpellID(link: HTMLAnchorElement) {
	const tooltipData = link.dataset.wowhead || '';
	return tooltipData.match(/(?:^|&)spell=(\d+)(?:&|$)/)?.[1] || null;
}

function decorateTooltip(tooltip: HTMLElement) {
	if (!activeSpellID) return;

	let footer = tooltip.querySelector<HTMLElement>(`:scope > .${TOOLTIP_FOOTER_CLASS}`);
	if (!footer) {
		footer = document.createElement('div');
		footer.className = TOOLTIP_FOOTER_CLASS;
		footer.setAttribute('aria-hidden', 'true');

		const spellID = document.createElement('span');
		spellID.className = 'rg-wowhead-tooltip-spell-id';
		footer.append(spellID);

		const action = document.createElement('span');
		action.className = 'rg-wowhead-tooltip-action';
		action.textContent = 'Click header to open on Wowhead ↗';
		footer.append(action);

		const poweredBy = tooltip.querySelector(':scope > .wowhead-tooltip-powered');
		tooltip.insertBefore(footer, poweredBy);
	}

	const spellID = footer.querySelector<HTMLElement>('.rg-wowhead-tooltip-spell-id');
	if (spellID) spellID.textContent = `Spell ID ${activeSpellID}`;
}

function decorateExistingTooltips() {
	document.querySelectorAll<HTMLElement>(WOWHEAD_TOOLTIP_SELECTOR).forEach(decorateTooltip);
}

function addedNodeContainsTooltip(node: Node) {
	if (!(node instanceof Element)) return false;
	return node.matches(WOWHEAD_TOOLTIP_SELECTOR) || node.querySelector(WOWHEAD_TOOLTIP_SELECTOR) != null;
}

export function refreshWowheadTooltips() {
	const wowheadWindow = window as typeof window & {
		$WowheadPower?: { refreshLinks?: () => void };
		WH?: { Tooltips?: { refreshLinks?: () => void } };
	};
	if (wowheadWindow.WH?.Tooltips?.refreshLinks) {
		wowheadWindow.WH.Tooltips.refreshLinks();
	} else {
		wowheadWindow.$WowheadPower?.refreshLinks?.();
	}
}

export function installWowheadTooltipEnhancements() {
	if (tooltipObserver) return;

	document.addEventListener('mouseover', event => {
		if (!(event.target instanceof Element)) return;
		const link = event.target.closest<HTMLAnchorElement>(WOWHEAD_LINK_SELECTOR);
		if (!link) return;

		const spellID = getSpellID(link);
		if (!spellID) return;
		activeSpellID = spellID;
		decorateExistingTooltips();
	}, true);

	tooltipObserver = new MutationObserver(mutations => {
		if (!activeSpellID) return;
		if (!mutations.some(mutation => [...mutation.addedNodes].some(addedNodeContainsTooltip))) return;
		decorateExistingTooltips();
	});
	tooltipObserver.observe(document.body, { childList: true, subtree: true });
}
