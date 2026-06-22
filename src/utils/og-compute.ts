/**
 * 0G Compute Integration
 * Sends prompts to zai-org/GLM-5-FP8 model for evaluation
 * 
 * IMPORTANT: This module does NOT fake results.
 * If 0G Compute fails, we return an error, not fabricated data.
 */

const MODEL_PROVIDER = '0xd9966e13a6026fcca4b13e7ff95c94de268c471c';
const MODEL_ID = 'zai-org/GLM-5-FP8';

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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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
 * Call 0G Compute to run a prompt against test input
 */
export async function runPromptEvaluation(
  systemPrompt: string,
  testInput: string,
  allowDemoFallback: boolean = false
): Promise<ComputeResult> {
  const messages: ComputeMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Extract the name, date, and amount from this text. Return ONLY valid JSON with keys: name, date (YYYY-MM-DD format), amount (decimal number only).\n\nText:\n${testInput}` }
  ];

  lastError = null;

  try {
    console.log('[0G Compute] Calling model:', MODEL_ID);
    
    const response = await fetch('https://router-api.0g.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Provider-Address': MODEL_PROVIDER,
      },
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
        error: `API returned ${response.status}: ${errorText.slice(0, 100)}`,
      };
    }

    const data: ComputeResponse = await response.json();
    
    if (data.choices && data.choices.length > 0 && data.choices[0].message.content) {
      const output = data.choices[0].message.content;
      console.log('[0G Compute] Success:', output.slice(0, 100));
      return {
        success: true,
        output,
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
    
    if (allowDemoFallback) {
      console.warn('[0G Compute] Using demo mode (user was warned)');
      const demoOutput = generateDemoExtraction(testInput);
      return {
        success: true,
        output: demoOutput,
        isDemo: true,
      };
    }
    
    return {
      success: false,
      output: null,
      error: `Network error: ${errorMsg}`,
    };
  }
}

/**
 * Demo mode: Generate extraction based on pattern matching
 */
function generateDemoExtraction(input: string): string {
  const nameMatch = input.match(/(?:Billed To|From|Guest|Cashier|Dr\.)\s*:?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  const dateMatch = input.match(/(?:Date|Sent|Visit|When)\s*:?\s*(\w+\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{4})/i);
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
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
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
      const nums = allAmounts.map(a => parseFloat(a.replace(/[$,]/g, ''))).filter(n => n > 10);
      if (nums.length > 0) {
        amount = Math.max(...nums).toFixed(2);
      }
    }
  }

  return JSON.stringify({ name, date, amount });
}

/**
 * Parse model output to extract name, date, amount
 */
export function parseExtractionOutput(output: string): {
  name: string;
  date: string;
  amount: string;
} {
  if (!output) {
    return { name: '', date: '', amount: '' };
  }
  
  console.log('[0G Compute] Parsing output:', output);
  
  try {
    let cleaned = output.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const parsed = JSON.parse(cleaned);
    const result = {
      name: String(parsed.name || parsed.Name || parsed.person || '').trim(),
      date: normalizeDate(String(parsed.date || parsed.Date || parsed.date_extracted || '')),
      amount: normalizeAmount(String(parsed.amount || parsed.Amount || parsed.total || parsed.price || '')),
    };
    console.log('[0G Compute] Parsed result:', result);
    return result;
  } catch (parseError) {
    console.error('[0G Compute] Parse error:', parseError);
    const nameMatch = output.match(/(?:name|Name|person)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);
    const dateMatch = output.match(/(?:date|Date)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);
    const amountMatch = output.match(/(?:amount|Amount|total|price)["']?\s*[:=]\s*["']?([^"'\n,}]+)/i);
    
    const result = {
      name: nameMatch ? nameMatch[1].trim() : '',
      date: dateMatch ? normalizeDate(dateMatch[1].trim()) : '',
      amount: amountMatch ? normalizeAmount(amountMatch[1].trim()) : '',
    };
    console.log('[0G Compute] Fallback parsed result:', result);
    return result;
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
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
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
  let cleaned = amountStr.replace(/[$€£¥USD\s,]/g, '');
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : cleaned;
}

export function compareExtracted(extracted: string, expected: string): boolean {
  const normExtracted = extracted.toLowerCase().trim();
  const normExpected = expected.toLowerCase().trim();
  
  if (!normExtracted || !normExpected) return false;
  if (normExtracted === normExpected) return true;
  if (normExtracted.includes(normExpected) || normExpected.includes(normExtracted)) return true;
  
  return false;
}
