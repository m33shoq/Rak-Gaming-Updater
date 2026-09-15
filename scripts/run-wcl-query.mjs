import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const queryFile = args[0];
const optionValue = option => {
	const index = args.indexOf(option);
	return index >= 0 ? args[index + 1] : undefined;
};
const variablesFile = optionValue('--variables');
const outputFile = optionValue('--out');

if (!queryFile || args.includes('--help')) {
	console.error(
		'Usage: npm run wcl:query -- <query.graphql|->'
		+ ' [--variables variables.json] [--out result.json]',
	);
	process.exitCode = queryFile ? 0 : 2;
} else {
	const descriptorPath = process.env.RG_WCL_DEV_BRIDGE_FILE || path.join(
		process.env.APPDATA || '',
		'rak-gaming-updater',
		'logs',
		'dev-tools',
		'wcl-development-bridge.json',
	);
	try {
		const [query, variablesText, descriptorText] = await Promise.all([
			queryFile === '-' ? fs.readFile(0, 'utf8') : fs.readFile(queryFile, 'utf8'),
			variablesFile ? fs.readFile(variablesFile, 'utf8') : Promise.resolve('{}'),
			fs.readFile(descriptorPath, 'utf8'),
		]);
		const variables = JSON.parse(variablesText);
		if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
			throw new Error('Variables must be a JSON object');
		}
		const descriptor = JSON.parse(descriptorText);
		if (
			descriptor?.version !== 1
			|| !Number.isSafeInteger(descriptor.port)
			|| descriptor.port <= 0
			|| descriptor.port > 65535
			|| typeof descriptor.token !== 'string'
			|| descriptor.token.length < 32
		) {
			throw new Error('The WCL development bridge descriptor is invalid');
		}

		const response = await fetch(`http://127.0.0.1:${descriptor.port}/v1/wcl-query`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${descriptor.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query, variables }),
			signal: AbortSignal.timeout(130_000),
		});
		const result = await response.json();
		if (!response.ok || result?.success !== true) {
			throw new Error(result?.error || `WCL development bridge returned HTTP ${response.status}`);
		}
		const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
		if (outputFile) {
			const resolvedOutput = path.resolve(outputFile);
			await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
			await fs.writeFile(resolvedOutput, serialized, 'utf8');
			console.log(JSON.stringify({
				success: true,
				outputPath: resolvedOutput,
				bytes: Buffer.byteLength(serialized, 'utf8'),
			}, null, 2));
		} else {
			process.stdout.write(serialized);
		}
	} catch (error) {
		console.error(
			`WCL development query failed: ${error instanceof Error ? error.message : String(error)}\n`
			+ 'Start the development app and make sure its WCL connection is ready.',
		);
		process.exitCode = 1;
	}
}
