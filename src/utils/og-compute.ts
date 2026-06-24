/**
 * 0G Compute Integration
 * Sends prompts to zai-org/GLM-5-FP8 via the 0G Compute Router.
 *
 * IMPORTANT: Does not fake results. Failures return honest errors unless
 * demo mode is explicitly enabled by the caller.
 */

const MODEL_PROVIDER = '0xd9966e13a6026fcca4b13e7ff95c94de268c471c';
const MODEL_ID = 'zai-org/GLM-5-FP8';
const ROUTER_API =
  import.meta.env.VITE_0G_ROUTER_API ?? 'https://router-api-testnet.integratenetwork.work/v1';

interface ComputeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ComputeResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

let lastError: { message: string; status?: number; body?: string } | null = null;

export function getLastError() {
  return lastError;
}

export function clearLastError() {
  lastError = null;
}

export interface ComputeResult {
  success: boolean;
  output: string | null;
  error?: string;
  isDemo?: boolean;
}

/**
 * Run a prompt against a single test case input.
 */
export async function runPromptEvaluation(
  systemPrompt: string,
  testInput: string,
  allowDemoFallback = false
): Promise<ComputeResult> {
  if (allowDemoFallback) {
    const output = generateDemoExtraction(testInput);
    return { success: true, output, isDemo: true };
  }

  const messages: ComputeMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Extract the name, date, and amount from this text. Return ONLY valid JSON with keys: name, date (YYYY-MM-DD format), amount (decimal number only).\n\nText:\n${testInput}`,
    },
  ];

  lastError = null;
  const apiKey = import.meta.env.VITE_0G_API_KEY as string | undefined;

  if (!apiKey) {
    const error =
      '0G Compute API key not configured. Set VITE_0G_API_KEY in .env.local, or enable Demo Mode.';
    lastError = { message: error };
    return { success: false, output: null, error };
  }

  try {
    console.log('[0G Compute] Calling model:', MODEL_ID);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Provider-Address': MODEL_PROVIDER,
    };

    const response = await fetch(`${ROUTER_API}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: MODEL_ID,
        messages,
        temperature: 0.1,
        max_tokens: 256,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      lastError = {
        message: `0G Compute API error: ${response.status}`,
        status: response.status,
        body: errorText,
      };
      console.error('[0G Compute] API error:', response.status, errorText);

      return {
        success: false,
        output: null,
        error: `API returned ${response.status}: ${errorText.slice(0, 120) || 'request failed'}`,
      };
    }

    const data: ComputeResponse = await response.json();

    if (data.choices?.[0]?.message?.content) {
      const output = data.choices[0].message.content;
      console.log('[0G Compute] Success:', output.slice(0, 100));
      return { success: true, output };
    }

    return {
      success: false,
      output: null,
      error: 'Model returned empty response',
    };
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : 'Network error';
    lastError = { message: errorMsg };
    console.error('[0G Compute] Network error:', errorMsg);

    return {
      success: false,
      output: null,
      error: `Network error: ${errorMsg}`,
    };
  }
}

function generateDemoExtraction(input: string): string {
  const nameMatch = input.match(
    /(?:Billed To|From|Guest|Cashier|Dr\.)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i
  );
  const dateMatch = input.match(
    /(?:Date|Sent|Visit|When)\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4})/i
  );
  const amountMatch = input.match(/\$?([\d,]+\.?\d*)\s*(?:USD|EUR|0G)?/i);

  const name = nameMatch ? nameMatch[1].trim() : 'Unknown';

  let date = '2024-01-01';
  if (dateMatch) {
    const dateStr = dateMatch[1];
    const months: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };

    const mdMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (mdMatch) {
      const year = mdMatch[3].length === 2 ? `20${mdMatch[3]}` : mdMatch[3];
      date = `${year}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
    } else {
      const longMatch = dateStr.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})/i);
      if (longMatch) {
        const month = months[longMatch[1].toLowerCase()];
        if (month) {
          date = `${longMatch[3]}-${month}-${longMatch[2].padStart(2, '0')}`;
        }
      }
    }
  }

  let amount = '0.00';
  if (amountMatch) {
    amount = amountMatch[1].replace(/,/g, '');
    const allAmounts = input.match(/\$?([\d,]+\.?\d*)/g);
    if (allAmounts && allAmounts.length > 1) {
      const nums = allAmounts
        .map((a) => parseFloat(a.replace(/[$,]/g, '')))
        .filter((n) => n > 10);
      if (nums.length > 0) {
        amount = Math.max(...nums).toFixed(2);
      }
    }
  }

  return JSON.stringify({ name, date, amount });
}

export function parseExtractionOutput(output: string): {
  name: string;
  date: string;
  amount: string;
} {
  if (!output) {
    return { name: '', date: '', amount: '' };
  }

  try {
    let cleaned = output.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    return {
      name: String(parsed.name || parsed.Name || parsed.person || '').trim(),
      date: normalizeDate(String(parsed.date || parsed.Date || parsed.date_extracted || '')),
      amount: normalizeAmount(
        String(parsed.amount || parsed.Amount || parsed.total || parsed.price || '')
      ),
    };
  } catch {
    const nameMatch = output.match(/(?:name|Name|person)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);
    const dateMatch = output.match(/(?:date|Date)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);
    const amountMatch = output.match(/(?:amount|Amount|total|price)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);

    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      date: dateMatch ? normalizeDate(dateMatch[1].trim()) : '',
      amount: amountMatch ? normalizeAmount(amountMatch[1].trim()) : '',
    };
  }
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const mdMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdMatch) {
    return `${mdMatch[3]}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }

  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const longMatch = dateStr.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})$/i);
  if (longMatch) {
    const month = months[longMatch[1].toLowerCase()];
    if (month) {
      return `${longMatch[3]}-${month}-${longMatch[2].padStart(2, '0')}`;
    }
  }

  return dateStr;
}

function normalizeAmount(amountStr: string): string {
  if (!amountStr) return '';
  const cleaned = amountStr.replace(/[$€£¥USD\s,]/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : cleaned;
}

export function compareExtracted(extracted: string, expected: string): boolean {
  const normExtracted = extracted.toLowerCase().trim();
  const normExpected = expected.toLowerCase().trim();

  if (!normExtracted || !normExpected) return false;
  if (normExtracted === normExpected) return true;
  if (normExtracted.includes(normExpected) || normExpected.includes(normExtracted)) return true;

  const eWords = normExpected.split(/\s+/);
  const xWords = normExtracted.split(/\s+/);
  if (eWords.every((w) => xWords.some((xw) => xw.includes(w) || w.includes(xw)))) {
    return true;
  }

  const eNum = parseFloat(normExpected.replace(/,/g, ''));
  const xNum = parseFloat(normExtracted.replace(/,/g, ''));
  if (!Number.isNaN(eNum) && !Number.isNaN(xNum) && Math.abs(eNum - xNum) < 0.01) {
    return true;
  }

  return false;
}