/**
 * 0G Compute Integration
 * Calls the backend proxy — API key stays server-side.
 *
 * IMPORTANT: Does not fake results. Failures return honest errors unless
 * demo mode is explicitly enabled by the caller.
 */

const PROXY_URL = '/api/compute';

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
  model?: string;
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

  lastError = null;

  try {
    console.log('[0G Compute] Calling backend proxy...');

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemPrompt, testInput }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorText = data?.error || `Proxy error ${response.status}`;
      lastError = {
        message: errorText,
        status: response.status,
        body: JSON.stringify(data),
      };
      console.error('[0G Compute] Proxy error:', response.status, errorText);

      return {
        success: false,
        output: null,
        error: errorText,
      };
    }

    if (data?.output) {
      console.log('[0G Compute] Success via', data.model || '0G Router');
      return {
        success: true,
        output: data.output,
        model: data.model,
      };
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
      error: `Compute proxy unavailable: ${errorMsg}. Is the API server running? (npm run dev)`,
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