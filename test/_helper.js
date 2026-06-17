// Test helper — common utilities for Agent Hub integration tests

const BASE = process.env.AGENT_HUB_URL || 'http://127.0.0.1:3457';

/**
 * Fetch JSON from an endpoint, throwing on non-OK status
 */
async function fetchJson(url, opts) {
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json', ...(opts?.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} (${r.statusText}) for ${url}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * Generate a unique test ID to avoid collisions
 */
function testId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

module.exports = { BASE, fetchJson, testId };
