import { config, higgsfield } from '@higgsfield/client/v2';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = resolve(projectRoot, '.env.local');

if (typeof process.loadEnvFile !== 'function') {
    console.error('Node.js 22.6 or newer is required to run this TypeScript example.');
    process.exit(1);
}

try {
    process.loadEnvFile(envFile);
} catch (error) {
    if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') {
        console.error('Could not load .env.local. Check its KEY=VALUE syntax; credential values are never displayed.');
        process.exit(1);
    }
}

const loadedCredentials = process.env.HF_CREDENTIALS?.trim();
const parts = loadedCredentials?.split(':') ?? [];
// Some local setups contain the key ID twice. Use the validated pair in
// memory without modifying the user's ignored environment file.
const credentials = parts.length === 3 && parts[0] === parts[1] && parts[2]
    ? parts.slice(1).join(':')
    : loadedCredentials;
if (!credentials) {
    console.error('Add HF_CREDENTIALS=key-id:key-secret to the ignored project-root .env.local file.');
    process.exit(1);
}

const credentialSeparator = credentials.indexOf(':');
if (credentialSeparator <= 0 || credentialSeparator === credentials.length - 1) {
    console.error('HF_CREDENTIALS must contain a non-empty key ID and secret separated by a colon; the value was not displayed.');
    process.exit(1);
}

// The SDK supports apiKey/apiSecret as a compatibility configuration.
const apiKey = credentials.slice(0, credentialSeparator);
const apiSecret = credentials.slice(credentialSeparator + 1);

try {
    config({ apiKey, apiSecret });
} catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    if (errorName === 'BadInputError') {
        console.error('The Higgsfield SDK rejected the credential format. Use one key-id:key-secret pair with exactly one colon.');
    } else {
        console.error(`Higgsfield SDK setup failed (${errorName}); no generation request was sent.`);
    }
    process.exit(1);
}

async function main() {
    const result = await higgsfield.subscribe('bytedance/seedance-2.5/text-to-video', {
        input: {
            prompt: 'A cinematic scene at sunset',
            duration: 5,
            resolution: '720p',
            aspect_ratio: '16:9',
        },
        withPolling: true,
    });

    const jobs = Array.isArray(result.jobs) ? result.jobs : [];
    const statuses = [result.status, ...jobs.map((job) => job.status)].filter((status) => typeof status === 'string');

    if (statuses.includes('nsfw') || statuses.includes('moderated')) {
        console.error('Higgsfield moderated this request; no video URL is available.');
        process.exitCode = 1;
        return;
    }
    if (statuses.includes('canceled') || statuses.includes('cancelled')) {
        console.error('Higgsfield canceled this request; no video URL is available.');
        process.exitCode = 1;
        return;
    }
    if (statuses.includes('failed')) {
        console.error('Higgsfield reported that generation failed; no video URL is available.');
        process.exitCode = 1;
        return;
    }
    if (!statuses.includes('completed')) {
        console.error('The SDK returned before a terminal completed state; no video URL is available.');
        process.exitCode = 1;
        return;
    }

    const completedJob = jobs.find((job) => job.status === 'completed');
    const videoUrl = result.video?.url ?? completedJob?.results?.raw?.url;
    if (!videoUrl) {
        console.error('Generation completed without a video URL in the SDK result.');
        process.exitCode = 1;
        return;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(videoUrl);
    } catch {
        console.error('The SDK returned an invalid video URL.');
        process.exitCode = 1;
        return;
    }
    if (parsedUrl.protocol !== 'https:') {
        console.error('The SDK returned a non-HTTPS video URL.');
        process.exitCode = 1;
        return;
    }

    console.log(`Video URL: ${parsedUrl.href}`);
}

main().catch((error) => {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
        && typeof error.statusCode === 'number'
        ? error.statusCode
        : null;

    if (statusCode === 401 || errorName === 'AuthenticationError') {
        console.error('Higgsfield authentication failed. Check the matching key ID and secret in .env.local; the values were not logged.');
    } else if (errorName === 'NotEnoughCreditsError' || statusCode === 402) {
        console.error('Higgsfield reports insufficient credits; generation did not complete.');
    } else {
        const status = statusCode ? `, HTTP ${statusCode}` : '';
        console.error(`Higgsfield generation did not complete (${errorName}${status}); no video URL was reported.`);
    }
    process.exitCode = 1;
});
