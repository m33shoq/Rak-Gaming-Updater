import { computed, nextTick, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue';

type TimelineOccurrenceTooltipDescriptor = {
	occurrences: unknown[];
	placement: 'above' | 'below';
	x: number;
	y: number;
};

const VIEWPORT_PADDING_PX = 8;
const TOOLTIP_COLUMN_WIDTH_PX = 420;
const MIN_TOOLTIP_COLUMN_WIDTH_PX = 340;
const BELOW_CURSOR_OFFSET_PX = 12;

export function useTimelineOccurrenceTooltipLayout(getTooltip: () => TimelineOccurrenceTooltipDescriptor | null) {
	const element = ref<HTMLElement | null>(null);
	const columnCount = ref(1);
	const fitScale = ref(1);
	const measuredSize = ref({ width: 0, height: 0 });
	let layoutGeneration = 0;

	function tooltipWidth(tooltip: TimelineOccurrenceTooltipDescriptor) {
		if (tooltip.occurrences.length <= 1) return undefined;
		return Math.min(
			columnCount.value * TOOLTIP_COLUMN_WIDTH_PX,
			Math.max(1, window.innerWidth - VIEWPORT_PADDING_PX * 2),
		);
	}

	const tooltipStyle = computed<CSSProperties>(() => {
		const tooltip = getTooltip();
		if (!tooltip) return {};

		const style: CSSProperties = {
			transform: fitScale.value < 1 ? `scale(${fitScale.value})` : undefined,
			transformOrigin: 'top left',
			visibility: measuredSize.value.width > 0 ? 'visible' : 'hidden',
		};
		const width = tooltipWidth(tooltip);
		if (width != null) style.width = `${width}px`;

		const measuredWidth = measuredSize.value.width || width || 0;
		const measuredHeight = measuredSize.value.height;
		const maxLeft = Math.max(
			VIEWPORT_PADDING_PX,
			window.innerWidth - VIEWPORT_PADDING_PX - measuredWidth,
		);
		style.left = `${Math.max(
			VIEWPORT_PADDING_PX,
			Math.min(maxLeft, tooltip.x - measuredWidth / 2),
		)}px`;

		const aboveTop = tooltip.y - measuredHeight;
		const belowTop = tooltip.y + BELOW_CURSOR_OFFSET_PX;
		const fitsAbove = aboveTop >= VIEWPORT_PADDING_PX;
		const fitsBelow = belowTop + measuredHeight <= window.innerHeight - VIEWPORT_PADDING_PX;
		let top = tooltip.placement === 'below' ? belowTop : aboveTop;
		if (tooltip.placement === 'below' && !fitsBelow && fitsAbove) top = aboveTop;
		if (tooltip.placement === 'above' && !fitsAbove && fitsBelow) top = belowTop;
		const maxTop = Math.max(
			VIEWPORT_PADDING_PX,
			window.innerHeight - VIEWPORT_PADDING_PX - measuredHeight,
		);
		style.top = `${Math.max(VIEWPORT_PADDING_PX, Math.min(maxTop, top))}px`;

		return style;
	});

	const occurrenceListStyle = computed<CSSProperties>(() => ({
		gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`,
	}));

	function occurrenceStyle(index: number, occurrenceCount: number): CSSProperties {
		const columns = Math.max(1, Math.min(columnCount.value, occurrenceCount));
		const rows = Math.ceil(occurrenceCount / columns);
		return {
			gridColumn: Math.floor(index / rows) + 1,
			gridRow: index % rows + 1,
		};
	}

	async function prepare() {
		const generation = ++layoutGeneration;
		columnCount.value = 1;
		fitScale.value = 1;
		measuredSize.value = { width: 0, height: 0 };
		await nextTick();

		const tooltip = getTooltip();
		if (generation !== layoutGeneration || !tooltip || !element.value) return;
		const maximumColumns = tooltip.occurrences.length <= 1
			? 1
			: Math.max(1, Math.min(
				tooltip.occurrences.length,
				Math.floor((window.innerWidth - VIEWPORT_PADDING_PX * 2) / MIN_TOOLTIP_COLUMN_WIDTH_PX),
			));
		const availableHeight = window.innerHeight - VIEWPORT_PADDING_PX * 2;

		while (element.value.getBoundingClientRect().height > availableHeight && columnCount.value < maximumColumns) {
			columnCount.value++;
			await nextTick();
			if (generation !== layoutGeneration || !getTooltip() || !element.value) return;
		}

		const rect = element.value.getBoundingClientRect();
		fitScale.value = rect.height > availableHeight ? availableHeight / rect.height : 1;
		measuredSize.value = {
			width: rect.width * fitScale.value,
			height: rect.height * fitScale.value,
		};
	}

	function clear() {
		layoutGeneration++;
		fitScale.value = 1;
		measuredSize.value = { width: 0, height: 0 };
	}

	function handleViewportResize() {
		if (getTooltip()) void prepare();
	}

	onMounted(() => window.addEventListener('resize', handleViewportResize));
	onBeforeUnmount(() => {
		layoutGeneration++;
		window.removeEventListener('resize', handleViewportResize);
	});

	return {
		element,
		tooltipStyle,
		occurrenceListStyle,
		occurrenceStyle,
		prepare,
		clear,
	};
}

// Keep the existing, domain-specific name for boss-cast consumers while the
// generic helper is also reused by other aggregated timeline markers.
export const useBossCastTooltipLayout = useTimelineOccurrenceTooltipLayout;
