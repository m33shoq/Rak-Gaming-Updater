import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue';

export interface ReplayPoint {
	x: number;
	y: number;
}

export interface ReplayView {
	x: number;
	y: number;
	height: number;
}

interface ReplayDrag {
	id: number;
	x: number;
	y: number;
	view: ReplayView;
	unitsPerPixel: number;
}

// Keep roughly 18% of the fitted actor extent visible on every edge. Expressed
// as a total scale so tightly stacked raids also get a meaningful zoom-out.
const AUTO_FIT_MARGIN_SCALE = 1.36;

function fitReplayView(
	points: readonly ReplayPoint[],
	minimumHeight: number,
	padding: number,
	aspectRatio: number,
): ReplayView {
	if (!points.length) return { x: 0, y: 0, height: minimumHeight };

	const xs = points.map(point => point.x).sort((left, right) => left - right);
	const ys = points.map(point => point.y).sort((left, right) => left - right);
	const inset = points.length >= 100 ? Math.floor(points.length * 0.01) : 0;
	const minX = xs[inset];
	const maxX = xs[xs.length - 1 - inset];
	const minY = ys[inset];
	const maxY = ys[ys.length - 1 - inset];
	const requiredWidth = maxX - minX + padding * 2;
	const requiredHeight = maxY - minY + padding * 2;

	return {
		x: (minX + maxX) / 2,
		y: (minY + maxY) / 2,
		height: Math.max(minimumHeight, requiredHeight, requiredWidth / aspectRatio)
			* AUTO_FIT_MARGIN_SCALE,
	};
}

export function useReplayViewport(
	allPoints: ComputedRef<ReplayPoint[]>,
	focusPoints: ComputedRef<ReplayPoint[]>,
	canvas: Ref<SVGSVGElement | null>,
) {
	const follow = ref(true);
	const dragging = ref(false);
	const aspectRatio = ref(1);
	const pixelHeight = ref(600);
	const manual = ref<ReplayView>({ x: 0, y: 0, height: 60 });
	let drag: ReplayDrag | null = null;
	let resizeObserver: ResizeObserver | null = null;

	function measure(element: SVGSVGElement): void {
		const bounds = element.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		aspectRatio.value = bounds.width / bounds.height;
		pixelHeight.value = bounds.height;
	}

	watch(canvas, (element) => {
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (!element) return;

		measure(element);
		resizeObserver = new ResizeObserver(() => measure(element));
		resizeObserver.observe(element);
	}, { flush: 'post' });

	onScopeDispose(() => {
		resizeObserver?.disconnect();
	});

	const fullView = computed(() => fitReplayView(allPoints.value, 60, 5, aspectRatio.value));
	const followedView = computed(() => (
		focusPoints.value.length
			? fitReplayView(focusPoints.value, 30, 8, aspectRatio.value)
			: fullView.value
	));
	const view = computed(() => follow.value ? followedView.value : manual.value);
	const viewWidth = computed(() => view.value.height * aspectRatio.value);
	const viewBox = computed(() => {
		return [
			view.value.x - viewWidth.value / 2,
			view.value.y - view.value.height / 2,
			viewWidth.value,
			view.value.height,
		].join(' ');
	});
	const zoom = computed(() => fullView.value.height / view.value.height);
	const pixelsToWorld = computed(() => view.value.height / pixelHeight.value);

	function enterManual(): void {
		if (!follow.value) return;
		manual.value = { ...followedView.value };
		follow.value = false;
	}

	function constrain(candidate: ReplayView): ReplayView {
		const height = Math.max(
			fullView.value.height / 12,
			Math.min(fullView.value.height, candidate.height),
		);
		const halfHeight = height / 2;
		const halfWidth = height * aspectRatio.value / 2;
		const fullHalfHeight = fullView.value.height / 2;
		const fullHalfWidth = fullView.value.height * aspectRatio.value / 2;

		return {
			x: Math.max(
				fullView.value.x - fullHalfWidth + halfWidth,
				Math.min(fullView.value.x + fullHalfWidth - halfWidth, candidate.x),
			),
			y: Math.max(
				fullView.value.y - fullHalfHeight + halfHeight,
				Math.min(fullView.value.y + fullHalfHeight - halfHeight, candidate.y),
			),
			height,
		};
	}

	function zoomBy(factor: number, anchor?: ReplayPoint): void {
		enterManual();
		const previous = manual.value;
		const nextHeight = previous.height / factor;
		const pivot = anchor || { x: previous.x, y: previous.y };
		const scale = nextHeight / previous.height;
		manual.value = constrain({
			x: pivot.x + (previous.x - pivot.x) * scale,
			y: pivot.y + (previous.y - pivot.y) * scale,
			height: nextHeight,
		});
	}

	function onWheel(event: WheelEvent): void {
		const element = event.currentTarget as SVGSVGElement;
		const matrix = element.getScreenCTM();
		if (!matrix) return;

		const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		const modeMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
		const delta = Math.max(-150, Math.min(150, event.deltaY * modeMultiplier));
		zoomBy(Math.exp(-delta * 0.003), anchor);
	}

	function startPan(event: PointerEvent): void {
		if (event.button !== 0 || drag) return;

		const element = event.currentTarget as SVGSVGElement;
		const bounds = element.getBoundingClientRect();
		if (bounds.height <= 0) return;

		enterManual();
		drag = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			view: { ...manual.value },
			unitsPerPixel: manual.value.height / bounds.height,
		};
		dragging.value = true;
		element.setPointerCapture(event.pointerId);
	}

	function movePan(event: PointerEvent): void {
		if (!drag || drag.id !== event.pointerId) return;
		manual.value = constrain({
			...drag.view,
			x: drag.view.x - (event.clientX - drag.x) * drag.unitsPerPixel,
			y: drag.view.y - (event.clientY - drag.y) * drag.unitsPerPixel,
		});
	}

	function endPan(event: PointerEvent): void {
		if (drag?.id !== event.pointerId) return;
		drag = null;
		dragging.value = false;

		const element = event.currentTarget as SVGSVGElement;
		if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
	}

	function showWholePull(): void {
		follow.value = false;
		manual.value = { ...fullView.value };
	}

	function followActors(): void {
		follow.value = true;
		drag = null;
		dragging.value = false;
	}

	/** Return to an uninitialized follow view when the replay source changes. */
	function reset(): void {
		if (drag && canvas.value?.hasPointerCapture(drag.id)) {
			canvas.value.releasePointerCapture(drag.id);
		}
		drag = null;
		dragging.value = false;
		manual.value = { x: 0, y: 0, height: 60 };
		follow.value = true;
	}

	return {
		view,
		viewWidth,
		viewBox,
		zoom,
		pixelsToWorld,
		follow,
		dragging,
		zoomBy,
		onWheel,
		startPan,
		movePan,
		endPan,
		showWholePull,
		followActors,
		reset,
	};
}
