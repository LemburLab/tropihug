#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, '.higgsfield');
const JOBS_FILE = path.join(STATE_DIR, 'jobs.json');
const LOCK_FILE = path.join(STATE_DIR, 'jobs.lock');
const API_ROOT = 'https://api.higgsfield.ai';
const IMAGE_MODEL = 'marketing-studio/image/sunburst';
const VIDEO_MODEL = 'bytedance/seedance-2.5/text-to-video';
const KLING_VIDEO_MODEL = 'kling-video/v3.0/pro/text-to-video';
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled']);
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const IMAGE_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};
const VIDEO_EXT_BY_MIME = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

function loadLocalEnvironment() {
  if (typeof process.loadEnvFile !== 'function') {
    throw new Error('Node.js 20.12 or newer is required to read the local .env file.');
  }
  try {
    process.loadEnvFile(path.join(ROOT, '.env.local'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function credentials() {
  const loaded = process.env.HF_CREDENTIALS?.trim();
  if (loaded) {
    const parts = loaded.split(':');
    // Accept a duplicated key ID in the ignored local file without exposing it.
    const pair = parts.length === 3 && parts[0] === parts[1] && parts[2]
      ? parts.slice(1).join(':')
      : loaded;
    const separator = pair.indexOf(':');
    if (separator <= 0 || separator === pair.length - 1) {
      throw new Error('HF_CREDENTIALS must contain a key ID and secret separated by a colon.');
    }
    return `Key ${pair}`;
  }
  const keyId = process.env.HF_API_KEY_ID?.trim();
  const secret = process.env.HF_API_KEY_SECRET?.trim();
  if (!keyId || !secret) {
    throw new Error('Set HF_CREDENTIALS in .env.local, or HF_API_KEY_ID and HF_API_KEY_SECRET in .env.');
  }
  return `Key ${keyId}:${secret}`;
}

function ownerId() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USERNAME || process.env.USER || 'local-user';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2).replaceAll('-', '_');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { positional, options };
}

function requirePrompt(value) {
  const prompt = String(value || '').trim();
  if (!prompt) throw new Error('Pass a non-empty --prompt.');
  return prompt;
}

function positiveInteger(value, fallback, label, min, max) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function choice(value, fallback, choices, label) {
  const result = value === undefined ? fallback : String(value);
  if (!choices.includes(result)) throw new Error(`${label} must be one of: ${choices.join(', ')}.`);
  return result;
}

function parseBoolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${label} must be true or false.`);
}

function safeProjectPath(value) {
  if (!value) return null;
  const absolute = path.resolve(ROOT, value);
  const relative = path.relative(ROOT, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Output paths must be inside this project.');
  }
  if (relative.split(path.sep).includes('.git')) {
    throw new Error('Output paths cannot target the Git metadata directory.');
  }
  const normalized = relative.split(path.sep).join('/').toLowerCase();
  const firstPart = normalized.split('/')[0];
  if (firstPart === '.env' || firstPart.startsWith('.env.')) {
    throw new Error('Output paths cannot target environment files.');
  }
  if (['.higgsfield/jobs.json', '.higgsfield/jobs.lock'].includes(normalized)) {
    throw new Error('Output paths cannot target the local request journal.');
  }
  return absolute;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(JOBS_FILE, 'utf8'));
    if (!Array.isArray(parsed.jobs)) throw new Error('Invalid local Higgsfield job journal.');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, jobs: [] };
    throw error;
  }
}

async function withStoreLock(operation) {
  await mkdir(STATE_DIR, { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      handle = await open(LOCK_FILE, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const lockStats = await stat(LOCK_FILE);
        if (Date.now() - lockStats.mtimeMs > 30000) await rm(LOCK_FILE, { force: true });
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      await sleep(100);
    }
  }
  if (!handle) throw new Error('The local job journal is busy; try again shortly.');

  try {
    const store = await readStore();
    const result = await operation(store);
    const temporary = `${JOBS_FILE}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await rename(temporary, JOBS_FILE);
    return result;
  } finally {
    await handle.close();
    await rm(LOCK_FILE, { force: true });
  }
}

async function addJob(job) {
  return withStoreLock((store) => {
    store.jobs.push(job);
    return job;
  });
}

async function updateJob(localId, patch) {
  return withStoreLock((store) => {
    const index = store.jobs.findIndex((job) => job.local_id === localId && job.owner_id === ownerId());
    if (index < 0) throw new Error('This local Higgsfield job is not owned by the current OS user.');
    store.jobs[index] = { ...store.jobs[index], ...patch, updated_at: new Date().toISOString() };
    return store.jobs[index];
  });
}

async function findOwnedJob(identifier) {
  const store = await readStore();
  const job = store.jobs.find((item) => item.request_id === identifier || item.local_id === identifier);
  if (!job || job.owner_id !== ownerId()) {
    throw new Error('That request is not recorded for the current local user.');
  }
  return job;
}

async function ownedJobs() {
  const store = await readStore();
  return store.jobs.filter((job) => job.owner_id === ownerId());
}

function fingerprint(model, input, outputBase, assetKey) {
  return createHash('sha256')
    .update(JSON.stringify({ model, input, outputBase, assetKey }))
    .digest('hex');
}

function isValidStatusUrl(rawUrl, requestId) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && !url.username && !url.password
      && ['api.higgsfield.ai', 'platform.higgsfield.ai'].includes(url.hostname)
      && url.pathname === `/requests/${requestId}/status`;
  } catch {
    return false;
  }
}

function describeApiError(response, body) {
  const detail = typeof body?.detail === 'string' ? body.detail : '';
  if (response.status === 401) return 'Higgsfield rejected the credentials (401). Check the local key ID and secret.';
  if (response.status === 403) return 'Higgsfield denied the request (403). Check account credits and model access.';
  if (response.status === 404) return 'Higgsfield could not find this model or request for the current account (404).';
  if (response.status === 423 || response.status === 503) return 'This model is temporarily unavailable. Try again later.';
  if (response.status === 429) return 'Higgsfield rate-limited the request. Wait for active jobs to finish before submitting more.';
  if (response.status === 400 && /concurrent|concurrency/i.test(detail)) {
    return `Higgsfield reached the account concurrency limit. Wait for a job to finish. ${detail}`;
  }
  if (response.status === 400 || response.status === 422) {
    return `Higgsfield rejected the request (${response.status}). ${detail || 'Check the model parameters.'}`;
  }
  return `Higgsfield returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`;
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function submitJob({ kind, model, input, outputBase = null, assetKey = null, force = false }) {
  const auth = credentials();
  const signature = fingerprint(model, input, outputBase, assetKey);
  const priorJobs = await ownedJobs();
  const previous = [...priorJobs].reverse().find((job) => job.fingerprint === signature && !['submit_failed', 'failed', 'nsfw', 'canceled'].includes(job.status));
  if (previous && !force) {
    if (['submission_uncertain', 'submitting'].includes(previous.status)) {
      throw new Error(`A previous submission may have been accepted (local job ${previous.local_id}). Check the Higgsfield console before retrying; generation POSTs have no idempotency key.`);
    }
    console.log(`Reusing existing request ${previous.request_id || previous.local_id} (${previous.status}). Use --force to submit another generation.`);
    return previous;
  }

  const job = {
    local_id: randomUUID(),
    request_id: null,
    owner_id: ownerId(),
    kind,
    model,
    prompt: input.prompt,
    input,
    output_base: outputBase ? path.relative(ROOT, outputBase).split(path.sep).join('/') : null,
    asset_key: assetKey,
    fingerprint: signature,
    status: 'submitting',
    status_url: null,
    media_url: null,
    error: null,
    correlation_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await addJob(job);

  let response;
  try {
    response = await fetch(`${API_ROOT}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    await updateJob(job.local_id, {
      status: 'submission_uncertain',
      error: 'The connection ended before the submission response was confirmed. Inspect Higgsfield Console before retrying.',
    });
    throw new Error(`Submission outcome is uncertain (local job ${job.local_id}). No automatic resubmission was attempted.`);
  }

  const body = await responseBody(response);
  const correlationId = response.headers.get('x-correlation-id');
  if (!response.ok) {
    const ambiguous = response.status >= 500;
    await updateJob(job.local_id, {
      status: ambiguous ? 'submission_uncertain' : 'submit_failed',
      error: describeApiError(response, body),
      correlation_id: correlationId,
    });
    if (ambiguous) {
      throw new Error(`Higgsfield returned HTTP ${response.status}; the submission may be uncertain (local job ${job.local_id}). Check Console before retrying.`);
    }
    throw new Error(describeApiError(response, body));
  }

  const requestId = typeof body?.request_id === 'string' ? body.request_id : '';
  const statusUrl = body?.status_url || `${API_ROOT}/requests/${requestId}/status`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)
      || !isValidStatusUrl(statusUrl, requestId)) {
    await updateJob(job.local_id, {
      status: 'submission_uncertain',
      error: 'The response did not contain the documented request_id and status_url.',
      correlation_id: correlationId,
    });
    throw new Error(`Higgsfield accepted the HTTP request but returned an unexpected lifecycle response (local job ${job.local_id}). Inspect Console before retrying.`);
  }

  const status = body.status;
  if (!['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'].includes(status)) {
    await updateJob(job.local_id, {
      status: 'submission_uncertain',
      error: 'The response did not contain a documented request status.',
      correlation_id: correlationId,
    });
    throw new Error(`Higgsfield returned an unexpected lifecycle status (local job ${job.local_id}). Inspect Console before retrying.`);
  }
  const submitted = await updateJob(job.local_id, {
    request_id: requestId,
    status_url: statusUrl,
    status,
    media_url: mediaFromStatus(body, kind)?.url || null,
    media_kind: mediaFromStatus(body, kind)?.kind || null,
    correlation_id: correlationId,
  });
  console.log(`Submitted ${kind} request ${requestId} (${status}).`);
  return submitted;
}

function mediaFromStatus(body, kind) {
  if (kind === 'video') return body?.video?.url ? { url: body.video.url, kind: 'video' } : null;
  if (Array.isArray(body?.images) && body.images[0]?.url) return { url: body.images[0].url, kind: 'image' };
  return null;
}

async function getRemoteStatus(job) {
  if (!job.request_id || !isValidStatusUrl(job.status_url, job.request_id)) {
    throw new Error('This job has no valid Higgsfield status URL.');
  }
  const response = await fetch(job.status_url, {
    headers: { Authorization: credentials() },
    signal: AbortSignal.timeout(30000),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const error = new Error(describeApiError(response, body));
    error.status = response.status;
    throw error;
  }
  if (body?.request_id !== job.request_id || !TERMINAL.has(body?.status) && !['queued', 'in_progress'].includes(body?.status)) {
    throw new Error('Higgsfield returned a status response that does not match the saved request.');
  }
  const media = mediaFromStatus(body, job.kind);
  const correlationId = response.headers.get('x-correlation-id') || body.correlation_id || job.correlation_id;
  const updated = await updateJob(job.local_id, {
    status: body.status,
    error: typeof body.error === 'string' ? body.error : null,
    media_url: media?.url || null,
    media_kind: media?.kind || null,
    correlation_id: correlationId,
  });
  return { job: updated, body };
}

async function pollJob(identifier, timeoutMinutes = 15) {
  const timeoutMs = positiveInteger(timeoutMinutes, 15, 'Timeout minutes', 1, 120) * 60000;
  const deadline = Date.now() + timeoutMs;
  let delay = 2000;
  let latest = await findOwnedJob(identifier);
  if (!latest.request_id) throw new Error(`Local job ${latest.local_id} has no confirmed request ID; inspect Higgsfield Console before retrying.`);
  console.log(`Polling request ${latest.request_id}; local timeout is ${timeoutMinutes} minute(s).`);

  while (Date.now() < deadline) {
    try {
      const result = await getRemoteStatus(latest);
      latest = result.job;
      console.log(`Request ${latest.request_id}: ${latest.status}.`);
      if (TERMINAL.has(latest.status)) return latest;
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 400 || error.status === 422) {
        throw error;
      }
      if (error.status && error.status !== 429 && error.status < 500) throw error;
      console.warn(`Status check failed; retrying with backoff (${error.message}).`);
    }
    const jitter = Math.floor(Math.random() * 501);
    await sleep(Math.min(delay + jitter, Math.max(0, deadline - Date.now())));
    delay = Math.min(Math.ceil(delay * 1.5), 10000);
  }
  throw new Error(`Polling timed out locally for ${latest.request_id}. The generation may still be running; resume with the wait command.`);
}

function extensionForMedia(contentType, mediaUrl, kind) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const fromMime = (kind === 'image' ? IMAGE_EXT_BY_MIME : VIDEO_EXT_BY_MIME)[mime];
  if (fromMime) return fromMime;
  try {
    const extension = path.extname(new URL(mediaUrl).pathname).toLowerCase();
    const allowed = kind === 'image' ? IMAGE_EXTENSIONS : ['.mp4', '.mov'];
    if (allowed.includes(extension)) return extension === '.jpeg' ? '.jpg' : extension;
  } catch {
    // The URL was validated before this point; the extension is only a fallback.
  }
  throw new Error(`Higgsfield returned an unsupported ${kind} media type (${mime || 'unknown'}).`);
}

function validateMediaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The saved media URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The saved media URL is not a safe HTTPS URL.');
  }
  return url;
}

function pathWithExtension(base, extension) {
  return path.extname(base) ? base.slice(0, -path.extname(base).length) + extension : base + extension;
}

async function rewritePageReferences(fromRelative, toRelative) {
  const pages = ['index.html', 'thank-you.html'];
  for (const page of pages) {
    const file = path.join(ROOT, page);
    const content = await readFile(file, 'utf8');
    const updated = content.split(fromRelative).join(toRelative);
    if (updated !== content) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, updated, 'utf8');
      await rename(temporary, file);
    }
  }
}

async function installSiteImage(job, tempFile, finalPath) {
  const base = path.join(ROOT, job.output_base);
  const relativeBase = path.relative(ROOT, base).split(path.sep).join('/');
  const finalRelative = path.relative(ROOT, finalPath).split(path.sep).join('/');
  const previousPaths = IMAGE_EXTENSIONS.map((extension) => `${relativeBase}${extension}`);
  const backupDir = path.join(STATE_DIR, 'backups');
  await mkdir(backupDir, { recursive: true });
  const oldFiles = [];
  for (const oldRelative of previousPaths) {
    const oldPath = path.join(ROOT, oldRelative);
    try {
      await stat(oldPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const backup = path.join(backupDir, `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(oldPath)}`);
    await copyFile(oldPath, backup);
    oldFiles.push({ oldPath, oldRelative, backup });
  }
  await mkdir(path.dirname(finalPath), { recursive: true });
  await rm(finalPath, { force: true });
  try {
    await rename(tempFile, finalPath);
  } catch (error) {
    const previousTarget = oldFiles.find((item) => item.oldRelative === finalRelative);
    if (previousTarget) await copyFile(previousTarget.backup, finalPath);
    throw error;
  }
  for (const item of oldFiles) {
    if (item.oldRelative !== finalRelative) await rewritePageReferences(item.oldRelative, finalRelative);
    await rm(item.oldPath, { force: true });
  }
}

async function downloadJob(identifier, outputValue = null) {
  const job = await findOwnedJob(identifier);
  if (job.status !== 'completed' || !job.media_url) {
    throw new Error(`Request ${job.request_id || job.local_id} has no completed output to download.`);
  }
  const mediaUrl = validateMediaUrl(job.media_url);
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Could not download the generated file (HTTP ${response.status}).`);

  const contentType = response.headers.get('content-type');
  const extension = extensionForMedia(contentType, mediaUrl.href, job.media_kind);
  const defaultBase = job.output_base
    ? path.join(ROOT, job.output_base)
    : path.join(STATE_DIR, 'output', job.kind, job.request_id);
  const requestedPath = outputValue ? safeProjectPath(outputValue) : defaultBase;
  const finalPath = pathWithExtension(requestedPath, extension);
  const buffer = Buffer.from(await response.arrayBuffer());
  const sizeLimit = job.media_kind === 'image' ? 60 * 1024 * 1024 : 512 * 1024 * 1024;
  if (buffer.byteLength === 0 || buffer.byteLength > sizeLimit) {
    throw new Error(`Generated file size is empty or exceeds the ${Math.round(sizeLimit / 1024 / 1024)} MB safety limit.`);
  }

  await mkdir(path.dirname(finalPath), { recursive: true });
  const temporary = `${finalPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer, { flag: 'wx' });
  try {
    if (job.media_kind === 'image' && job.asset_key) {
      await installSiteImage(job, temporary, finalPath);
    } else {
      await rm(finalPath, { force: true });
      await rename(temporary, finalPath);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const relativePath = path.relative(ROOT, finalPath).split(path.sep).join('/');
  await updateJob(job.local_id, { downloaded_path: relativePath, media_content_type: contentType });
  console.log(`Saved ${job.media_kind} to ${relativePath}.`);
  return relativePath;
}

function imageInput(options) {
  return {
    prompt: requirePrompt(options.prompt),
    resolution: choice(options.resolution, '2k', ['1k', '2k', '4k'], 'Image resolution'),
    aspect_ratio: choice(options.aspect_ratio, '1:1', ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'], 'Image aspect ratio'),
    quality: choice(options.quality, 'high', ['low', 'medium', 'high', 'xhigh', 'max'], 'Image quality'),
    enhance_prompt: false,
  };
}

function videoInput(options) {
  return {
    prompt: requirePrompt(options.prompt),
    duration: positiveInteger(options.duration, 5, 'Video duration', 4, 30),
    resolution: choice(options.resolution, '720p', ['480p', '720p'], 'Video resolution'),
    aspect_ratio: choice(options.aspect_ratio, '16:9', ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], 'Video aspect ratio'),
    output_format: choice(options.output_format, 'mp4', ['mp4', 'mov'], 'Video format'),
    generate_audio: parseBoolean(options.audio, true, 'Audio option'),
  };
}

function klingVideoInput(options) {
  return {
    prompt: requirePrompt(options.prompt),
    duration: positiveInteger(options.duration, 8, 'Kling video duration', 3, 15),
    sound: choice(options.sound, 'on', ['on', 'off'], 'Kling sound setting'),
    cfg_scale: 0.5,
    multi_shots: false,
    aspect_ratio: choice(options.aspect_ratio, '16:9', ['16:9', '9:16', '1:1'], 'Kling aspect ratio'),
  };
}

function siteVideoModel(video) {
  const model = video.model || VIDEO_MODEL;
  if (![VIDEO_MODEL, KLING_VIDEO_MODEL].includes(model)) {
    throw new Error(`Site video ${video.key} uses an unsupported model: ${model}.`);
  }
  return model;
}

function siteVideoInput(video, model) {
  if (model === KLING_VIDEO_MODEL) {
    return klingVideoInput({
      prompt: video.prompt,
      duration: video.duration,
      sound: video.sound,
      aspect_ratio: video.aspect_ratio,
    });
  }
  return videoInput({
    prompt: video.prompt,
    duration: video.duration,
    resolution: video.resolution,
    aspect_ratio: video.aspect_ratio,
    output_format: video.output_format,
    audio: String(video.generate_audio),
  });
}

async function loadSiteImages() {
  const file = path.join(ROOT, 'tools', 'higgsfield-site-images.json');
  const images = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(images) || images.length === 0) throw new Error('The site image manifest is empty or invalid.');
  return images;
}

async function loadSiteVideos() {
  const file = path.join(ROOT, 'tools', 'higgsfield-site-videos.json');
  const videos = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(videos) || videos.length === 0) throw new Error('The site video manifest is empty or invalid.');
  return videos;
}

async function runSiteImages(options) {
  const images = await loadSiteImages();
  if (options.dry_run) {
    console.log(`Dry run: ${images.length} Marketing Studio Image (2.5 Sunburst) requests; no API calls made.`);
    for (const image of images) console.log(`- ${image.key}: ${image.base} (${image.aspect_ratio})\n  ${image.prompt}`);
    return;
  }

  credentials();
  for (const asset of images) {
    const outputBase = safeProjectPath(asset.base);
    const jobs = await ownedJobs();
    let job = [...jobs].reverse().find((candidate) => candidate.asset_key === asset.key && candidate.owner_id === ownerId());
    if (job && ['submission_uncertain', 'submitting'].includes(job.status)) {
      throw new Error(`Asset ${asset.key} has an uncertain previous submission. Check Higgsfield Console before retrying.`);
    }
    if (job && job.status === 'completed' && job.downloaded_path && !options.force) {
      try {
        await stat(safeProjectPath(job.downloaded_path));
        console.log(`Skipping ${asset.key}; a completed replacement is already installed at ${job.downloaded_path}.`);
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        job = await updateJob(job.local_id, { downloaded_path: null });
      }
    }
    if (!job || ['failed', 'nsfw', 'canceled', 'submit_failed'].includes(job.status) || !job.request_id || options.force) {
      const input = imageInput({ prompt: asset.prompt, aspect_ratio: asset.aspect_ratio });
      job = await submitJob({
        kind: 'image',
        model: IMAGE_MODEL,
        input,
        outputBase,
        assetKey: asset.key,
        force: Boolean(options.force),
      });
    }
    if (job.status !== 'completed') job = await pollJob(job.request_id || job.local_id, options.timeout_minutes || 15);
    else if (!job.media_url) job = (await getRemoteStatus(job)).job;
    if (job.status !== 'completed') {
      throw new Error(`Asset ${asset.key} finished with status ${job.status}${job.error ? `: ${job.error}` : '.'}`);
    }
    if (!job.downloaded_path) await downloadJob(job.request_id || job.local_id, asset.base);
  }
  console.log('All referenced site image assets have generated replacements.');
}

async function runSiteVideos(options) {
  const videos = await loadSiteVideos();
  if (options.dry_run) {
    console.log(`Dry run: ${videos.length} site video requests; no API calls made.`);
    for (const video of videos) {
      const model = siteVideoModel(video);
      const input = siteVideoInput(video, model);
      const label = model === KLING_VIDEO_MODEL ? 'Kling 3.0 Pro' : 'Seedance 2.5';
      const audio = model === KLING_VIDEO_MODEL ? input.sound : (input.generate_audio ? 'on' : 'off');
      console.log(`- ${video.key}: ${video.output} (${label}, ${input.duration}s, ${input.aspect_ratio}, audio ${audio})\n  ${input.prompt}`);
    }
    return;
  }

  credentials();
  for (const video of videos) {
    const model = siteVideoModel(video);
    const outputBase = safeProjectPath(video.output);
    if (path.extname(outputBase).toLowerCase() !== '.mp4' || video.output_format !== 'mp4') {
      throw new Error(`Site video ${video.key} must use an .mp4 output.`);
    }
    const assetKey = `video:${video.key}`;
    const jobs = await ownedJobs();
    let job = [...jobs].reverse().find((candidate) => candidate.asset_key === assetKey && candidate.owner_id === ownerId());
    if (job && ['submission_uncertain', 'submitting'].includes(job.status)) {
      throw new Error(`Video ${video.key} has an uncertain previous submission. Check Higgsfield Console before retrying.`);
    }
    if (job && job.status === 'completed' && job.downloaded_path && !options.force) {
      try {
        await stat(safeProjectPath(job.downloaded_path));
        console.log(`Skipping ${video.key}; a completed video is already installed at ${job.downloaded_path}.`);
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        job = await updateJob(job.local_id, { downloaded_path: null });
      }
    }
    if (!job || ['failed', 'nsfw', 'canceled', 'submit_failed'].includes(job.status) || !job.request_id || options.force) {
      const input = siteVideoInput(video, model);
      job = await submitJob({
        kind: 'video',
        model,
        input,
        outputBase,
        assetKey,
        force: Boolean(options.force),
      });
    }
    if (job.status !== 'completed') job = await pollJob(job.request_id || job.local_id, options.timeout_minutes || 15);
    else if (!job.media_url) job = (await getRemoteStatus(job)).job;
    if (job.status !== 'completed') {
      throw new Error(`Video ${video.key} finished with status ${job.status}${job.error ? `: ${job.error}` : '.'}`);
    }
    if (!job.downloaded_path) await downloadJob(job.request_id, video.output);
  }
  console.log('All generated site videos are installed.');
}

function printJob(job) {
  console.log(JSON.stringify({
    request_id: job.request_id,
    local_id: job.local_id,
    model: job.model,
    status: job.status,
    output: job.downloaded_path || job.output_base,
    error: job.error,
  }, null, 2));
}

function help() {
  console.log(`Higgsfield local agent tool (Node.js 20.12+; credentials read from .env.local or .env)

Commands:
  node tools/higgsfield.mjs image --prompt "..." [--output assets/new-image] [--wait]
  node tools/higgsfield.mjs video --prompt "..." [--output .higgsfield/output/clip] [--duration 5] [--wait]
  node tools/higgsfield.mjs status <request_id>
  node tools/higgsfield.mjs wait <request_id> [--timeout-minutes 15]
  node tools/higgsfield.mjs download <request_id> [--output assets/new-image]
  node tools/higgsfield.mjs jobs
  node tools/higgsfield.mjs site-images [--dry-run] [--force]
  node tools/higgsfield.mjs site-videos [--dry-run] [--force]

Image requests use Marketing Studio Image (2.5 Sunburst).
General video requests use Seedance 2.5 text-to-video. The site-video manifest also supports Kling 3.0 Pro text-to-video.
The job journal and backups are kept in ignored .higgsfield/.`);
}

async function main() {
  loadLocalEnvironment();
  const command = process.argv[2];
  const { positional, options } = parseArgs(process.argv.slice(3));

  if (!command || command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'site-images') return runSiteImages(options);
  if (command === 'site-videos') return runSiteVideos(options);
  if (command === 'jobs') {
    const jobs = await ownedJobs();
    if (jobs.length === 0) return console.log('No local Higgsfield jobs have been submitted.');
    for (const job of jobs) printJob(job);
    return;
  }

  if (command === 'image' || command === 'video') {
    const kind = command;
    const input = kind === 'image' ? imageInput(options) : videoInput(options);
    const outputBase = options.output ? safeProjectPath(options.output) : null;
    const job = await submitJob({
      kind,
      model: kind === 'image' ? IMAGE_MODEL : VIDEO_MODEL,
      input,
      outputBase,
      force: Boolean(options.force),
    });
    if (options.wait) {
      const complete = await pollJob(job.request_id || job.local_id, options.timeout_minutes || 15);
      if (complete.status !== 'completed') throw new Error(`Generation ended with ${complete.status}${complete.error ? `: ${complete.error}` : '.'}`);
      if (outputBase) await downloadJob(complete.request_id, options.output);
    }
    return;
  }

  if (command === 'status') {
    const job = await findOwnedJob(positional[0]);
    const result = await getRemoteStatus(job);
    printJob(result.job);
    return;
  }

  if (command === 'wait') {
    const job = await pollJob(positional[0], options.timeout_minutes || 15);
    if (job.status !== 'completed') throw new Error(`Generation ended with ${job.status}${job.error ? `: ${job.error}` : '.'}`);
    if (job.output_base) await downloadJob(job.request_id);
    else printJob(job);
    return;
  }

  if (command === 'download') {
    const output = options.output || null;
    const saved = await downloadJob(positional[0], output);
    console.log(`Downloaded to ${saved}.`);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "node tools/higgsfield.mjs help" for usage.`);
}

main().catch((error) => {
  console.error(`Higgsfield tool: ${error.message}`);
  process.exitCode = 1;
});
