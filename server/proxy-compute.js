const MODEL_BY_NETWORK = {
  testnet: 'qwen2.5-omni',
  mainnet: 'zai-org/GLM-5-FP8',
};

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function getConfig(env = process.env) {
  const ROUTER_API =
    env.OG_ROUTER_API ||
    env.VITE_0G_ROUTER_API ||
    'https://router-api-testnet.integratenetwork.work/v1';

  const MODEL_ID =
    env.OG_MODEL_ID ||
    (ROUTER_API.includes('testnet') || ROUTER_API.includes('integratenetwork')
      ? MODEL_BY_NETWORK.testnet
      : MODEL_BY_NETWORK.mainnet);

  return {
    apiKey: env.OG_API_KEY || env.VITE_0G_API_KEY,
    routerApi: ROUTER_API,
    modelId: MODEL_ID,
  };
}

/**
 * Proxy a single compute request to 0G Router.
 */
export async function proxyCompute(body, env = process.env) {
  const { apiKey, routerApi, modelId } = getConfig(env);

  if (!apiKey) {
    return { status: 503, data: { error: 'OG_API_KEY not configured on server' } };
  }

  const { systemPrompt, testInput, model } = body || {};
  if (!systemPrompt || !testInput) {
    return { status: 400, data: { error: 'systemPrompt and testInput are required' } };
  }

  const requestedModel = model || modelId;
  const modelsToTry = unique([
    requestedModel,
    modelId,
    routerApi.includes('testnet') || routerApi.includes('integratenetwork')
      ? MODEL_BY_NETWORK.testnet
      : MODEL_BY_NETWORK.mainnet,
    MODEL_BY_NETWORK.testnet,
    MODEL_BY_NETWORK.mainnet,
  ]);

  let lastError = null;

  for (const modelIdTry of modelsToTry) {
    const payload = {
      model: modelIdTry,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Extract the name, date, and amount from this text. Return ONLY valid JSON with keys: name, date (YYYY-MM-DD format), amount (decimal number only).\n\nText:\n${testInput}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 256,
      response_format: { type: 'json_object' },
    };

    try {
      const response = await fetch(`${routerApi}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        lastError = {
          model: modelIdTry,
          status: response.status,
          error: data?.error?.message || data?.error || text.slice(0, 200),
        };
        if (response.status === 404) continue;
        return { status: response.status, data: { error: lastError.error, model: modelIdTry } };
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        lastError = { model: modelIdTry, status: 502, error: 'Empty model response' };
        continue;
      }

      return {
        status: 200,
        data: {
          output: content,
          model: modelIdTry,
          trace: data?.x_0g_trace || null,
        },
      };
    } catch (error) {
      lastError = {
        model: modelIdTry,
        status: 502,
        error: error instanceof Error ? error.message : 'Proxy request failed',
      };
    }
  }

  return {
    status: 502,
    data: {
      error:
        lastError?.error ||
        'All model attempts failed. On testnet use qwen2.5-omni; GLM-5 is mainnet-only.',
      attemptedModels: modelsToTry,
      router: routerApi,
    },
  };
}

export function getHealth(env = process.env) {
  const { apiKey, routerApi, modelId } = getConfig(env);
  return {
    ok: true,
    router: routerApi,
    model: modelId,
    hasApiKey: Boolean(apiKey),
  };
}