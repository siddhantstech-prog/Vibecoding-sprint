/**
 * Input validation helpers.
 *
 * Every helper throws an HttpError(400) with a human-readable message so the
 * client always gets a consistent { "error": "..." } shape. Nothing here trusts
 * the client: quantities, ids and numeric fields are always re-validated.
 */

import { badRequest } from './http.js';

/** Parses a positive-integer product id from the URL. */
export function parseProductId(raw) {
  const asString = String(raw ?? '').trim();
  if (!/^[0-9]+$/.test(asString)) throw badRequest('Invalid product id');
  const id = Number(asString);
  if (!Number.isSafeInteger(id) || id < 1) throw badRequest('Invalid product id');
  return id;
}

/**
 * Parses an integer field.
 * @returns {number|null|undefined} null when explicitly null, undefined when absent.
 */
export function parseInteger(value, field, opts = {}) {
  const { min, max, defaultValue, allowNull = true } = opts;

  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw badRequest(`"${field}" is required`);
  }
  if (value === null) {
    if (allowNull) return null;
    if (defaultValue !== undefined) return defaultValue;
    throw badRequest(`"${field}" is required`);
  }
  if (typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') {
    throw badRequest(`"${field}" must be an integer`);
  }

  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw badRequest(`"${field}" must be an integer`);
  }
  if (min !== undefined && num < min) throw badRequest(`"${field}" must be >= ${min}`);
  if (max !== undefined && num > max) throw badRequest(`"${field}" must be <= ${max}`);
  return num;
}

/** Parses a money value: finite, non-negative. Rounded to 2 decimals. */
export function parsePrice(value, field, opts = {}) {
  const { defaultValue, allowNull = true } = opts;

  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw badRequest(`"${field}" is required`);
  }
  if (value === null) {
    if (allowNull) return null;
    if (defaultValue !== undefined) return defaultValue;
    throw badRequest(`"${field}" is required`);
  }
  if (typeof value === 'boolean' || Array.isArray(value) || typeof value === 'object') {
    throw badRequest(`"${field}" must be a number`);
  }

  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(num)) throw badRequest(`"${field}" must be a number`);
  if (num < 0) throw badRequest(`"${field}" must be >= 0`);
  return Math.round(num * 100) / 100;
}

/** Parses a text field. Returns undefined when absent, null when blank/null. */
export function parseString(value, field, opts = {}) {
  const { required = false, maxLength = 255, allowNull = true, defaultValue } = opts;

  if (value === undefined) {
    if (required) throw badRequest(`"${field}" is required`);
    return defaultValue !== undefined ? defaultValue : (allowNull ? null : undefined);
  }
  if (value === null) {
    if (required) throw badRequest(`"${field}" is required`);
    return allowNull ? null : defaultValue;
  }
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);

  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw badRequest(`"${field}" is required`);
    return allowNull ? null : (defaultValue ?? null);
  }
  if (trimmed.length > maxLength) {
    throw badRequest(`"${field}" must be at most ${maxLength} characters`);
  }
  return trimmed;
}
