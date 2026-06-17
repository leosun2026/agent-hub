// P0 Test: Auth fields are not leaked or accidentally inlined as plaintext tokens
// Critical regression: Codex has previously replaced $AUTH_* env references with actual tokens

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { fetchJson, BASE } = require('./_helper');

describe('Auth Security', () => {

  it('No agents have plaintext bearer tokens in auth field', async () => {
    const agents = await fetchJson(`${BASE}/api/agents`);
    for (const agent of agents) {
      if (agent.auth) {
        // Auth should be either:
        // 1. $ENV_VAR (env reference)
        // 2. null/undefined (no auth)
        // NOT: a hardcoded key string
        const isEnvRef = agent.auth.startsWith('$');
        const isNull = agent.auth === null;
        if (!isEnvRef && !isNull) {
          // Check if it looks like a real key (long hex string, begins with sk- etc.)
          const looksLikeKey = /^[A-Za-z0-9_-]{20,}$/.test(agent.auth) ||
                               agent.auth.startsWith('sk-') ||
                               agent.auth.startsWith('Bearer ');
          if (looksLikeKey) {
            assert.fail(
              `Agent "${agent.id}" has a hardcoded auth value that looks like a real API key: "${agent.auth.slice(0, 12)}..." — must use $ENV_VAR instead`
            );
          }
        }
      }
    }
    // If we reach here, no hardcoded keys found — pass
  });

  it('agents.json file on disk does not contain actual tokens', async () => {
    // Check the agents.json file format via API
    const agents = await fetchJson(`${BASE}/api/agents`);
    for (const agent of agents) {
      if (agent.auth) {
        const isEnvRef = agent.auth.startsWith('$');
        if (!isEnvRef && !agent.auth.startsWith('Bearer $')) {
          // Even Bearer $ENV_VAR should be $ENV_VAR (agents.js handles the "Bearer " prefix)
          if (agent.auth.startsWith('Bearer ')) {
            const afterBearer = agent.auth.slice(7);
            if (!afterBearer.startsWith('$')) {
              assert.fail(
                `Agent "${agent.id}" has "Bearer " prefix with a non-env-var value — should use $ENV_VAR format`
              );
            }
          }
        }
      }
    }
  });

  it('No agent endpoint exposes a hardcoded key in the URL', async () => {
    const agents = await fetchJson(`${BASE}/api/agents`);
    for (const agent of agents) {
      if (agent.endpoint) {
        // Endpoint URL should not contain API keys
        const hasKeyInUrl = /key=|api[-_]?key=|token=|apikey=/i.test(agent.endpoint);
        if (hasKeyInUrl) {
          assert.fail(
            `Agent "${agent.id}" has what looks like an API key embedded in endpoint URL: "${agent.endpoint}"`
          );
        }
      }
    }
  });
});
