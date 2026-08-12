import { getStore } from '@netlify/blobs';
import { refuse } from './_auth.mjs';

const BASE_ID = 'appOTj9wLzFwbQUZj';
const CONTENT_TABLE = 'tblX309mqF8RNrDa5';
const SOURCE_TABLE = 'tblGNMC5Re3917BUF';
const STORE = 'scene-airtable';
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

const FIELD = {
  content: {
    status: 'fldlUH4bEue4QDlPn',
    editedImage: 'fldu0G5FUsph7bR4Z',
    notes: 'fldvrxfSwqw0gcNA8',
    sourceImages: 'fldX68QVAPXDezux2',
    prompt: 'fldO2TKKSxMG6NNRc',
    failureNote: 'fldLow8ZDm68cFiTc',
  },
  source: {
    sourcePhoto: 'fldJRT4UVqKB5Ff2a',
    photoshootName: 'fldabOgV02sQJrFsb',
    note: 'fldFJ6ktavtXHdbFX',
  },
};

const EXTRA = {
  configCode: 'Config Code',
  blenderRender: 'Blender Render',
  originalFilename: 'Original Filename',
  submissionId: 'Scene Studio Submission ID',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function bad(status, error, details = {}) {
  return json({ ok: false, error, ...details }, status);
}

function token() {
  return process.env.AIRTABLE_IMAGE_UPLOAD || process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_TOKEN || '';
}

function safeId(value) {
  return /^[a-zA-Z0-9_-]{12,80}$/.test(value || '');
}

function safeSlot(value) {
  return value === 'source' || value === 'output';
}

function cleanFilename(value, fallback) {
  const base = String(value || '').split(/[\\/]/).pop().replace(/[^\w .()@+-]+/g, '-').trim();
  return (base || fallback).slice(0, 120);
}

function cleanConfigCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[0-9A-Z]{7}$/.test(code) ? code : '';
}

function stageKey(submission, slot) {
  return `${submission}/${slot}`;
}

async function airtable(path, options = {}) {
  const key = token();
  if (!key) throw Object.assign(new Error('Airtable token is not configured.'), { status: 500, code: 'missing_airtable_token' });
  const response = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.error?.message || data?.error || text || `Airtable ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, code: 'airtable_error', body: data });
  }
  return data;
}

async function uploadAttachment(recordId, fieldId, staged, fallbackName) {
  const key = token();
  if (!key) throw Object.assign(new Error('Airtable token is not configured.'), { status: 500, code: 'missing_airtable_token' });
  const response = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      file: Buffer.from(staged.data).toString('base64'),
      filename: cleanFilename(staged.metadata?.filename, fallbackName),
      contentType: staged.metadata?.contentType || 'image/jpeg',
    }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.error?.message || data?.error || text || `Airtable upload ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, code: 'airtable_upload_error', body: data });
  }
  return data;
}

async function schemaFields() {
  const data = await airtable(`meta/bases/${BASE_ID}/tables`, { method: 'GET' });
  const byTable = {};
  for (const table of data.tables || []) {
    if (table.id !== CONTENT_TABLE && table.id !== SOURCE_TABLE) continue;
    byTable[table.id] = new Map((table.fields || []).map((field) => [field.name, field]));
  }
  return byTable;
}

function includeIfPresent(fields, tableMap, name, value) {
  const field = tableMap?.get(name);
  if (field && value !== undefined && value !== null && value !== '') fields[field.id] = value;
}

function requiredExtras(fields) {
  const source = fields[SOURCE_TABLE];
  const content = fields[CONTENT_TABLE];
  const missing = [];
  for (const name of [EXTRA.configCode, EXTRA.blenderRender, EXTRA.originalFilename, EXTRA.submissionId]) {
    if (!source?.has(name)) missing.push(`Marketing - Source Images / ${name}`);
  }
  for (const name of [EXTRA.configCode, EXTRA.submissionId]) {
    if (!content?.has(name)) missing.push(`Marketing - Content Pipeline / ${name}`);
  }
  return missing;
}

async function stagedImage(store, submission, slot) {
  const entry = await store.getWithMetadata(stageKey(submission, slot), { type: 'arrayBuffer' });
  if (!entry?.data) throw Object.assign(new Error(`${slot} image was not uploaded.`), { status: 400, code: 'missing_staged_image' });
  return entry;
}

async function handleUpload(request, url) {
  const submission = url.searchParams.get('submission') || '';
  const slot = url.searchParams.get('slot') || '';
  if (!safeId(submission) || !safeSlot(slot)) return bad(422, 'bad_upload_target');
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) return bad(415, 'bad_content_type', { got: contentType || '(none)' });
  const data = await request.arrayBuffer();
  if (!data.byteLength || data.byteLength > MAX_IMAGE_BYTES) return bad(400, 'bad_size', { maxBytes: MAX_IMAGE_BYTES });
  await getStore({ name: STORE, consistency: 'strong' }).set(stageKey(submission, slot), data, {
    metadata: {
      filename: cleanFilename(url.searchParams.get('filename'), `${slot}.jpg`),
      contentType,
      bytes: data.byteLength,
      uploadedAt: new Date().toISOString(),
    },
  });
  return json({ ok: true, submission, slot, bytes: data.byteLength });
}

async function handleFinalize(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return bad(400, 'bad_json');
  const submission = String(body.submissionId || '');
  const configCode = cleanConfigCode(body.configCode);
  if (!safeId(submission)) return bad(422, 'bad_submission_id');
  if (!configCode) return bad(422, 'bad_config_code');

  const store = getStore({ name: STORE, consistency: 'strong' });
  const [sourceImage, outputImage, fields] = await Promise.all([
    stagedImage(store, submission, 'source'),
    stagedImage(store, submission, 'output'),
    schemaFields(),
  ]);
  const missing = requiredExtras(fields);
  if (missing.length) return bad(428, 'missing_airtable_fields', { missing });

  const sourceFields = {
    [FIELD.source.photoshootName]: body.sourceIsBlenderRender ? 'Blender render' : 'Scene Studio upload',
    [FIELD.source.note]: [
      'Scene Studio source image.',
      `Original filename: ${body.sourceFilename || sourceImage.metadata?.filename || 'unknown'}.`,
      body.outputFilename ? `Output filename: ${body.outputFilename}.` : '',
    ].filter(Boolean).join('\n'),
  };
  includeIfPresent(sourceFields, fields[SOURCE_TABLE], EXTRA.configCode, configCode);
  includeIfPresent(sourceFields, fields[SOURCE_TABLE], EXTRA.blenderRender, !!body.sourceIsBlenderRender);
  includeIfPresent(sourceFields, fields[SOURCE_TABLE], EXTRA.originalFilename, cleanFilename(body.sourceFilename || sourceImage.metadata?.filename, 'source.jpg'));
  includeIfPresent(sourceFields, fields[SOURCE_TABLE], EXTRA.submissionId, submission);

  const sourceRecord = await airtable(`${BASE_ID}/${SOURCE_TABLE}`, {
    method: 'POST',
    body: JSON.stringify({ fields: sourceFields, returnFieldsByFieldId: true }),
  });
  await uploadAttachment(sourceRecord.id, FIELD.source.sourcePhoto, sourceImage, 'source.jpg');

  const contentFields = {
    [FIELD.content.status]: 'For Review',
    [FIELD.content.sourceImages]: [sourceRecord.id],
    [FIELD.content.notes]: [
      'Posted from Scene Studio.',
      body.sourceIsBlenderRender ? 'Source image was identified as a Blender render from its filename.' : 'Source image was not identified as a Blender render from its filename.',
      body.outputFilename ? `Output filename: ${body.outputFilename}.` : '',
    ].filter(Boolean).join('\n'),
  };
  if (body.prompt) contentFields[FIELD.content.prompt] = String(body.prompt).slice(0, 100000);
  includeIfPresent(contentFields, fields[CONTENT_TABLE], EXTRA.configCode, configCode);
  includeIfPresent(contentFields, fields[CONTENT_TABLE], EXTRA.submissionId, submission);

  const contentRecord = await airtable(`${BASE_ID}/${CONTENT_TABLE}`, {
    method: 'POST',
    body: JSON.stringify({ fields: contentFields, returnFieldsByFieldId: true }),
  });
  try {
    await uploadAttachment(contentRecord.id, FIELD.content.editedImage, outputImage, body.outputFilename || 'scene-output.jpg');
  } catch (error) {
    await airtable(`${BASE_ID}/${CONTENT_TABLE}/${contentRecord.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        fields: {
          [FIELD.content.status]: 'Failed',
          [FIELD.content.failureNote]: `Scene Studio Airtable upload failed: ${error.message || String(error)}`.slice(0, 500),
        },
      }),
    }).catch(() => {});
    throw error;
  }

  await Promise.all([
    store.delete(stageKey(submission, 'source')),
    store.delete(stageKey(submission, 'output')),
  ]);

  return json({
    ok: true,
    sourceRecordId: sourceRecord.id,
    contentRecordId: contentRecord.id,
    airtableUrl: `https://airtable.com/${BASE_ID}/${CONTENT_TABLE}/${contentRecord.id}`,
  });
}

export default async (request) => {
  const denied = refuse(request);
  if (denied) return denied;
  const url = new URL(request.url);
  try {
    if (request.method === 'PUT') return handleUpload(request, url);
    if (request.method === 'POST') return handleFinalize(request);
    return new Response('Method Not Allowed', { status: 405 });
  } catch (error) {
    console.error('scene-airtable failed', error);
    return bad(error.status || 500, error.code || 'scene_airtable_failed', { message: error.message || String(error) });
  }
};

export const config = { path: '/api/scene-airtable' };
