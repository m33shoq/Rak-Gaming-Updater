export type WclRequestResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };
