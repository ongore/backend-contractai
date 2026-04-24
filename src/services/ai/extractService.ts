import { openai } from '../../config/openai';
import logger from '../../utils/logger';
import { ServiceUnavailableError, ValidationError } from '../../utils/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContractType =
  | 'SERVICE_AGREEMENT'
  | 'FREELANCE_AGREEMENT'
  | 'PAYMENT_AGREEMENT'
  | 'GENERAL_AGREEMENT';

export interface ExtractedField {
  label: string;
  key: string;
  value: string;
  required: boolean;
}

export interface ExtractionInput {
  method: 'text' | 'image' | 'pdf';
  text?: string;
  imageBuffer?: Buffer;
  mimeType?: string;
}

export interface ExtractionResult {
  fields: ExtractedField[];
  suggestedTitle: string;
  suggestedContractType: ContractType;
  rawExtraction: RawExtraction;
}

interface RawExtraction {
  partyOneName: string;
  partyTwoName: string;
  partyOneAddress?: string;
  partyTwoAddress?: string;
  serviceDescription: string;
  paymentAmount?: string;
  paymentCurrency?: string;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
  deliverables?: string;
  terms?: string;
  suggestedTitle: string;
  suggestedContractType: ContractType;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert contract analyst and legal document parser. Your job is to extract structured information from contract-related content — which may be a photograph of a document, a scanned invoice, a screenshot of a conversation, handwritten notes, or typed text.

Extract all available contract fields and return ONLY a valid JSON object. Do not include any explanation, markdown, or code fences — just raw JSON.

Return exactly this JSON shape:
{
  "partyOneName": "string — full legal name of the first party (sender/service provider/creditor)",
  "partyTwoName": "string — full legal name of the second party (recipient/client/debtor)",
  "partyOneAddress": "string or null — address of first party if visible",
  "partyTwoAddress": "string or null — address of second party if visible",
  "serviceDescription": "string — clear 1-3 sentence description of the service, work, or obligation",
  "paymentAmount": "string or null — numeric amount (e.g. '2500.00'), no currency symbol",
  "paymentCurrency": "string or null — ISO 4217 currency code (e.g. 'USD', 'EUR', 'GBP')",
  "startDate": "string or null — ISO 8601 date (YYYY-MM-DD) when work/agreement starts",
  "endDate": "string or null — ISO 8601 date (YYYY-MM-DD) when work/agreement ends",
  "dueDate": "string or null — ISO 8601 date (YYYY-MM-DD) when payment is due",
  "deliverables": "string or null — comma-separated list of specific deliverables or milestones",
  "terms": "string or null — any special conditions, payment terms, penalties, or notable clauses",
  "suggestedTitle": "string — a concise, professional contract title (e.g. 'Web Development Agreement – Acme Corp')",
  "suggestedContractType": "one of: SERVICE_AGREEMENT | FREELANCE_AGREEMENT | PAYMENT_AGREEMENT | GENERAL_AGREEMENT"
}

Guidelines for suggestedContractType:
- SERVICE_AGREEMENT: ongoing or project-based services between a company/individual and a client
- FREELANCE_AGREEMENT: independent contractor or freelance work, often creative or technical
- PAYMENT_AGREEMENT: primarily about money owed, repayment plans, invoices, or debt
- GENERAL_AGREEMENT: any other agreement, MOU, NDA, or document that doesn't fit the above

If a field cannot be determined from the content, use null (not an empty string).
Always infer context intelligently — if you see "John Smith" is billing "Acme Corp", John is partyOne and Acme Corp is partyTwo.
Normalize dates to ISO 8601 format even if they appear as "March 15, 2024" or "15/03/2024".
Extract payment amounts without currency symbols — put the currency in paymentCurrency.`;

const USER_TEXT_PROMPT = (text: string) =>
  `Extract all contract fields from the following text and return the JSON object as instructed.\n\n---\n${text}\n---`;

const USER_IMAGE_PROMPT =
  'Extract all contract fields from this document image and return the JSON object as instructed. Carefully read all visible text, dates, names, and amounts.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapRawToFields(raw: RawExtraction): ExtractedField[] {
  const fieldDefinitions: Array<{
    key: keyof RawExtraction;
    label: string;
    required: boolean;
  }> = [
    { key: 'partyOneName', label: 'First Party (You)', required: true },
    { key: 'partyTwoName', label: 'Second Party', required: true },
    { key: 'partyOneAddress', label: 'First Party Address', required: false },
    { key: 'partyTwoAddress', label: 'Second Party Address', required: false },
    { key: 'serviceDescription', label: 'Service Description', required: true },
    { key: 'paymentAmount', label: 'Payment Amount', required: false },
    { key: 'paymentCurrency', label: 'Currency', required: false },
    { key: 'startDate', label: 'Start Date', required: false },
    { key: 'endDate', label: 'End Date', required: false },
    { key: 'dueDate', label: 'Payment Due Date', required: false },
    { key: 'deliverables', label: 'Deliverables', required: false },
    { key: 'terms', label: 'Special Terms', required: false },
  ];

  const fields: ExtractedField[] = [];

  for (const def of fieldDefinitions) {
    const rawValue = raw[def.key];
    const strValue = rawValue != null ? String(rawValue) : '';
    const value = strValue !== '' && strValue !== 'null' ? strValue : '';

    // Always include required fields; only include optional fields if they have a value
    if (def.required || value) {
      fields.push({
        key: def.key,
        label: def.label,
        value,
        required: def.required,
      });
    }
  }

  return fields;
}

function parseJsonResponse(content: string): RawExtraction {
  // Strip potential markdown code fences the model may have added despite instructions
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as RawExtraction;
  } catch {
    // Last-ditch: find the first { ... } block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as RawExtraction;
    }
    throw new Error('Could not parse JSON from model response');
  }
}

function validateSuggestedContractType(type: string): ContractType {
  const valid: ContractType[] = [
    'SERVICE_AGREEMENT',
    'FREELANCE_AGREEMENT',
    'PAYMENT_AGREEMENT',
    'GENERAL_AGREEMENT',
  ];
  return valid.includes(type as ContractType)
    ? (type as ContractType)
    : 'GENERAL_AGREEMENT';
}

// ─── Main Service ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export async function extractContractFields(
  input: ExtractionInput
): Promise<ExtractionResult> {
  if (!input.text && !input.imageBuffer) {
    throw new ValidationError(
      'Extraction requires either text content or an image/PDF file'
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      logger.debug(`AI extraction attempt ${attempt + 1}/${MAX_RETRIES}`, {
        method: input.method,
        hasText: !!input.text,
        hasImage: !!input.imageBuffer,
      });

      const raw = await runExtraction(input);

      const fields = mapRawToFields(raw);
      const suggestedContractType = validateSuggestedContractType(
        raw.suggestedContractType
      );

      logger.info('Contract fields extracted successfully', {
        method: input.method,
        fieldCount: fields.length,
        contractType: suggestedContractType,
        title: raw.suggestedTitle,
      });

      return {
        fields,
        suggestedTitle: raw.suggestedTitle || 'Contract Agreement',
        suggestedContractType,
        rawExtraction: raw,
      };
    } catch (err) {
      lastError = err as Error;
      logger.warn(`Extraction attempt ${attempt + 1} failed`, {
        error: (err as Error).message,
        attempt: attempt + 1,
      });

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS_MS[attempt])
        );
      }
    }
  }

  throw new ServiceUnavailableError(
    `AI extraction failed after ${MAX_RETRIES} attempts: ${lastError?.message ?? 'Unknown error'}`
  );
}

async function runExtraction(input: ExtractionInput): Promise<RawExtraction> {
  let completion: Awaited<ReturnType<typeof openai.chat.completions.create>>;

  if (input.method === 'text' && input.text) {
    // ── Text path ──────────────────────────────────────────────────────────
    completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1, // Low temperature for structured extraction
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: USER_TEXT_PROMPT(input.text) },
      ],
    });
  } else if (input.imageBuffer) {
    // ── Vision path ────────────────────────────────────────────────────────
    const mimeType = input.mimeType ?? 'image/jpeg';
    const base64Image = input.imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 1500, // Vision responses may be more verbose
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'high', // Use high detail for document OCR
              },
            },
            {
              type: 'text',
              text: USER_IMAGE_PROMPT,
            },
          ],
        },
      ],
    });
  } else {
    throw new ValidationError(
      'Invalid extraction input: provide text or an image buffer'
    );
  }

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned an empty response');
  }

  logger.debug('Raw OpenAI response received', {
    finishReason: completion.choices[0]?.finish_reason,
    promptTokens: completion.usage?.prompt_tokens,
    completionTokens: completion.usage?.completion_tokens,
  });

  return parseJsonResponse(content);
}
