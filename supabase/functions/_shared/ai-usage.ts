// _shared/ai-usage.ts — fire-and-forget helper used by edge functions to log
// each outbound AI API call to ai_usage_logs. Failures are swallowed so that
// logging never breaks the main request.

export interface AiUsageLog {
  platform: string;
  operation: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  units?: number | null;
  status?: 'success' | 'error';
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Rough pricing used to compute estimated_cost_usd at log-time.
// Prices are in USD per token / per call. Update when vendor changes pricing.
const PRICING: Record<string, { inputPerToken?: number; outputPerToken?: number; perUnit?: number }> = {
  // Anthropic — per token
  'claude-sonnet-4-6':           { inputPerToken: 3 / 1_000_000,    outputPerToken: 15 / 1_000_000 },
  'claude-sonnet-4-5':           { inputPerToken: 3 / 1_000_000,    outputPerToken: 15 / 1_000_000 },
  'claude-3-5-haiku-20241022':   { inputPerToken: 0.25 / 1_000_000, outputPerToken: 1.25 / 1_000_000 },
  'claude-haiku-4-5-20251001':   { inputPerToken: 0.8 / 1_000_000,  outputPerToken: 4 / 1_000_000 },
  // Per-call services
  serpapi:                        { perUnit: 0.005 },
  rainforest:                     { perUnit: 0.01 },
  twelvelabs:                     { perUnit: 0.005 },
  fal:                            { perUnit: 0.10 },
};

function estimateCost(log: AiUsageLog): number | null {
  const model = log.model ?? log.platform;
  const rates = PRICING[model] ?? PRICING[log.platform];
  if (!rates) return null;

  if (rates.perUnit !== undefined && log.units != null) {
    return rates.perUnit * log.units;
  }
  if (rates.inputPerToken !== undefined && (log.input_tokens != null || log.output_tokens != null)) {
    const inputCost  = (log.input_tokens  ?? 0) * rates.inputPerToken;
    const outputCost = (log.output_tokens ?? 0) * (rates.outputPerToken ?? 0);
    return inputCost + outputCost;
  }
  return null;
}

export async function logAiUsage(log: AiUsageLog): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) return;

  try {
    const row = {
      platform:           log.platform,
      operation:          log.operation,
      model:              log.model ?? null,
      input_tokens:       log.input_tokens ?? null,
      output_tokens:      log.output_tokens ?? null,
      units:              log.units ?? null,
      estimated_cost_usd: estimateCost(log),
      status:             log.status ?? 'success',
      error_message:      log.error_message ?? null,
      metadata:           log.metadata ?? null,
    };

    await fetch(`${supabaseUrl}/rest/v1/ai_usage_logs`, {
      method: 'POST',
      headers: {
        Authorization:   `Bearer ${serviceKey}`,
        apikey:          serviceKey,
        'Content-Type':  'application/json',
        Prefer:          'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    // Logging is best-effort — never throw from here.
  }
}
