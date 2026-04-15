import puppeteer from 'puppeteer';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { ExtractedField } from '../ai/extractService';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContractType =
  | 'SERVICE_AGREEMENT'
  | 'FREELANCE_AGREEMENT'
  | 'PAYMENT_AGREEMENT'
  | 'GENERAL_AGREEMENT';

export interface ContractData {
  id: string;
  title: string;
  type: ContractType;
  extractedFields: ExtractedField[];
  mySignature?: string | null;
  otherPartySignature?: string | null;
  otherPartyName?: string | null;
  otherPartyEmail?: string | null;
  createdAt: Date;
}

export interface SignatureSet {
  sender?: string | null;   // base64 data URL
  recipient?: string | null; // base64 data URL
}

// ─── Field Accessors ─────────────────────────────────────────────────────────

function getField(fields: ExtractedField[], key: string): string {
  return fields.find((f) => f.key === key)?.value ?? '';
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '___________________';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount?: string | null, currency?: string | null): string {
  if (!amount) return 'As agreed';
  const symbol = currencySymbol(currency ?? 'USD');
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return `${symbol}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$',
    JPY: '¥', CHF: 'CHF ', INR: '₹', SGD: 'S$', HKD: 'HK$',
  };
  return map[code.toUpperCase()] ?? `${code} `;
}

function currentDateFormatted(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── HTML Contract Sections by Type ──────────────────────────────────────────

function buildSections(type: ContractType, fields: ExtractedField[]): string {
  const partyOne = getField(fields, 'partyOneName') || 'Party One';
  const partyTwo = getField(fields, 'partyTwoName') || 'Party Two';
  const partyOneAddr = getField(fields, 'partyOneAddress');
  const partyTwoAddr = getField(fields, 'partyTwoAddress');
  const serviceDesc = getField(fields, 'serviceDescription') || 'As described between the parties.';
  const paymentAmount = getField(fields, 'paymentAmount');
  const paymentCurrency = getField(fields, 'paymentCurrency') || 'USD';
  const startDate = getField(fields, 'startDate');
  const endDate = getField(fields, 'endDate');
  const dueDate = getField(fields, 'dueDate');
  const deliverables = getField(fields, 'deliverables');
  const terms = getField(fields, 'terms');

  const formattedPayment = formatCurrency(paymentAmount, paymentCurrency);
  const sectionClass = 'section';

  switch (type) {
    case 'SERVICE_AGREEMENT':
      return `
        <div class="${sectionClass}">
          <h2>1. Parties</h2>
          <p>This Service Agreement ("Agreement") is entered into as of <strong>${formatDate(startDate) !== '___________________' ? formatDate(startDate) : currentDateFormatted()}</strong> between:</p>
          <p><strong>Service Provider:</strong> ${partyOne}${partyOneAddr ? `<br><span class="address">${partyOneAddr}</span>` : ''}</p>
          <p><strong>Client:</strong> ${partyTwo}${partyTwoAddr ? `<br><span class="address">${partyTwoAddr}</span>` : ''}</p>
        </div>

        <div class="${sectionClass}">
          <h2>2. Scope of Work</h2>
          <p>${serviceDesc}</p>
        </div>

        ${deliverables ? `
        <div class="${sectionClass}">
          <h2>3. Deliverables</h2>
          <ul>
            ${deliverables.split(',').map((d) => `<li>${d.trim()}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${deliverables ? '4' : '3'}. Payment Terms</h2>
          <p><strong>Total Amount:</strong> ${formattedPayment}</p>
          ${dueDate ? `<p><strong>Payment Due Date:</strong> ${formatDate(dueDate)}</p>` : ''}
          <p>Payment shall be made via the method agreed upon by both parties. Late payments may incur interest at the rate of 1.5% per month on outstanding balances.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '5' : '4'}. Timeline</h2>
          ${startDate ? `<p><strong>Commencement Date:</strong> ${formatDate(startDate)}</p>` : ''}
          ${endDate ? `<p><strong>Completion Date:</strong> ${formatDate(endDate)}</p>` : ''}
          <p>Both parties agree to use best efforts to meet any stated timelines. Material changes to the timeline require written consent from both parties.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '6' : '5'}. Intellectual Property</h2>
          <p>Upon receipt of full payment, all work product, deliverables, and materials created specifically for the Client under this Agreement shall become the exclusive property of the Client. The Service Provider retains the right to use general skills, knowledge, and methods gained during the engagement.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '7' : '6'}. Confidentiality</h2>
          <p>Each party agrees to keep confidential all non-public information received from the other party and to use such information solely for the purposes of this Agreement. This obligation survives termination of the Agreement for a period of two (2) years.</p>
        </div>

        ${terms ? `
        <div class="${sectionClass}">
          <h2>${deliverables ? '8' : '7'}. Additional Terms</h2>
          <p>${terms}</p>
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${deliverables ? (terms ? '9' : '8') : (terms ? '8' : '7')}. Termination</h2>
          <p>Either party may terminate this Agreement with thirty (30) days' written notice. In the event of termination, the Client shall pay for all services satisfactorily rendered up to the date of termination.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? (terms ? '10' : '9') : (terms ? '9' : '8')}. Governing Law</h2>
          <p>This Agreement shall be governed by and construed in accordance with applicable law. Any disputes arising under this Agreement shall be resolved through good-faith negotiation, and if necessary, binding arbitration.</p>
        </div>
      `;

    case 'FREELANCE_AGREEMENT':
      return `
        <div class="${sectionClass}">
          <h2>1. Parties</h2>
          <p>This Freelance Agreement ("Agreement") is entered into as of <strong>${startDate ? formatDate(startDate) : currentDateFormatted()}</strong> between:</p>
          <p><strong>Freelancer / Independent Contractor:</strong> ${partyOne}${partyOneAddr ? `<br><span class="address">${partyOneAddr}</span>` : ''}</p>
          <p><strong>Client:</strong> ${partyTwo}${partyTwoAddr ? `<br><span class="address">${partyTwoAddr}</span>` : ''}</p>
        </div>

        <div class="${sectionClass}">
          <h2>2. Independent Contractor Relationship</h2>
          <p>${partyOne} is an independent contractor and not an employee of ${partyTwo}. Nothing in this Agreement shall be construed to create a partnership, joint venture, employment, or agency relationship. ${partyOne} is solely responsible for all taxes on compensation received under this Agreement.</p>
        </div>

        <div class="${sectionClass}">
          <h2>3. Project Description</h2>
          <p>${serviceDesc}</p>
        </div>

        ${deliverables ? `
        <div class="${sectionClass}">
          <h2>4. Deliverables & Milestones</h2>
          <ul>
            ${deliverables.split(',').map((d) => `<li>${d.trim()}</li>`).join('')}
          </ul>
          ${endDate ? `<p><strong>Project Deadline:</strong> ${formatDate(endDate)}</p>` : ''}
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${deliverables ? '5' : '4'}. Rate & Payment Schedule</h2>
          <p><strong>Project Fee:</strong> ${formattedPayment}</p>
          ${dueDate ? `<p><strong>Payment Due:</strong> ${formatDate(dueDate)}</p>` : ''}
          <p>Invoices are payable within fourteen (14) days of receipt. ${partyOne} reserves the right to suspend work if payment is more than 14 days overdue.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '6' : '5'}. Intellectual Property & Ownership</h2>
          <p>Upon receipt of full payment, ${partyOne} assigns to ${partyTwo} all rights, title, and interest in the final deliverables created specifically under this Agreement. ${partyOne} retains ownership of all pre-existing work, tools, frameworks, and generic components ("Background IP"). Any Background IP incorporated into deliverables is licensed to ${partyTwo} on a non-exclusive, perpetual, royalty-free basis solely for use of the final deliverable.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '7' : '6'}. Revisions</h2>
          <p>This Agreement includes up to two (2) rounds of revisions per deliverable. Additional revision rounds will be billed at the freelancer's standard hourly rate, to be agreed in writing before work commences.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? '8' : '7'}. Confidentiality</h2>
          <p>${partyOne} agrees to keep all Client information confidential and not to disclose it to any third party without prior written consent. This obligation survives termination of the Agreement for a period of two (2) years.</p>
        </div>

        ${terms ? `
        <div class="${sectionClass}">
          <h2>${deliverables ? '9' : '8'}. Additional Terms</h2>
          <p>${terms}</p>
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${deliverables ? (terms ? '10' : '9') : (terms ? '9' : '8')}. Governing Law</h2>
          <p>This Agreement shall be governed by applicable law. Disputes shall be resolved by good-faith negotiation, and if unresolved, by binding arbitration.</p>
        </div>
      `;

    case 'PAYMENT_AGREEMENT':
      return `
        <div class="${sectionClass}">
          <h2>1. Parties</h2>
          <p>This Payment Agreement ("Agreement") is entered into as of <strong>${currentDateFormatted()}</strong> between:</p>
          <p><strong>Creditor / Payee:</strong> ${partyOne}${partyOneAddr ? `<br><span class="address">${partyOneAddr}</span>` : ''}</p>
          <p><strong>Debtor / Payor:</strong> ${partyTwo}${partyTwoAddr ? `<br><span class="address">${partyTwoAddr}</span>` : ''}</p>
        </div>

        <div class="${sectionClass}">
          <h2>2. Amount Owed</h2>
          <p>${partyTwo} ("Debtor") acknowledges owing ${partyOne} ("Creditor") the sum of <strong>${formattedPayment}</strong> in connection with the following:</p>
          <p>${serviceDesc}</p>
        </div>

        <div class="${sectionClass}">
          <h2>3. Payment Schedule</h2>
          ${dueDate ? `<p><strong>Payment Due Date:</strong> ${formatDate(dueDate)}</p>` : ''}
          ${deliverables ? `
          <p><strong>Payment Installments:</strong></p>
          <ul>
            ${deliverables.split(',').map((d) => `<li>${d.trim()}</li>`).join('')}
          </ul>` : `<p>The full amount of ${formattedPayment} is due in a single payment${dueDate ? ` on or before ${formatDate(dueDate)}` : ' as agreed by both parties'}.</p>`}
        </div>

        <div class="${sectionClass}">
          <h2>4. Late Payment Penalties</h2>
          <p>In the event that any payment is not received by the due date, the outstanding balance shall accrue interest at the rate of <strong>1.5% per month</strong> (18% per annum), calculated daily from the due date until the date of actual payment. ${partyTwo} shall also be responsible for any reasonable costs incurred by ${partyOne} in collecting overdue amounts.</p>
        </div>

        <div class="${sectionClass}">
          <h2>5. Method of Payment</h2>
          <p>All payments shall be made by bank transfer, certified check, or other method agreed upon in writing by both parties. Payments shall be considered received on the date cleared funds are received by ${partyOne}.</p>
        </div>

        <div class="${sectionClass}">
          <h2>6. Default</h2>
          <p>If ${partyTwo} fails to make any payment when due and such failure is not remedied within ten (10) days after written notice from ${partyOne}, the entire unpaid balance shall become immediately due and payable at ${partyOne}'s option.</p>
        </div>

        ${terms ? `
        <div class="${sectionClass}">
          <h2>7. Additional Terms</h2>
          <p>${terms}</p>
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${terms ? '8' : '7'}. Governing Law</h2>
          <p>This Agreement shall be governed by applicable law. Any dispute arising under this Agreement shall be resolved through negotiation, and if unresolved, through binding arbitration.</p>
        </div>
      `;

    case 'GENERAL_AGREEMENT':
    default:
      return `
        <div class="${sectionClass}">
          <h2>1. Parties</h2>
          <p>This Agreement ("Agreement") is entered into as of <strong>${startDate ? formatDate(startDate) : currentDateFormatted()}</strong> between:</p>
          <p><strong>First Party:</strong> ${partyOne}${partyOneAddr ? `<br><span class="address">${partyOneAddr}</span>` : ''}</p>
          <p><strong>Second Party:</strong> ${partyTwo}${partyTwoAddr ? `<br><span class="address">${partyTwoAddr}</span>` : ''}</p>
        </div>

        <div class="${sectionClass}">
          <h2>2. Purpose & Background</h2>
          <p>The parties enter into this Agreement to formalize the terms and conditions governing their mutual obligations as set forth herein.</p>
        </div>

        <div class="${sectionClass}">
          <h2>3. Terms & Obligations</h2>
          <p>${serviceDesc}</p>
          ${terms ? `<p>${terms}</p>` : ''}
        </div>

        ${deliverables ? `
        <div class="${sectionClass}">
          <h2>4. Specific Obligations</h2>
          <ul>
            ${deliverables.split(',').map((d) => `<li>${d.trim()}</li>`).join('')}
          </ul>
        </div>` : ''}

        ${paymentAmount ? `
        <div class="${sectionClass}">
          <h2>${deliverables ? '5' : '4'}. Payment</h2>
          <p><strong>Agreed Amount:</strong> ${formattedPayment}</p>
          ${dueDate ? `<p><strong>Due Date:</strong> ${formatDate(dueDate)}</p>` : ''}
        </div>` : ''}

        <div class="${sectionClass}">
          <h2>${deliverables ? (paymentAmount ? '6' : '5') : (paymentAmount ? '5' : '4')}. Duration</h2>
          ${startDate ? `<p><strong>Effective Date:</strong> ${formatDate(startDate)}</p>` : ''}
          ${endDate ? `<p><strong>Expiry Date:</strong> ${formatDate(endDate)}</p>` : ''}
          <p>This Agreement shall remain in effect until all obligations have been fulfilled or it is terminated by mutual written agreement of the parties.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? (paymentAmount ? '7' : '6') : (paymentAmount ? '6' : '5')}. Confidentiality</h2>
          <p>Each party agrees to maintain the confidentiality of the other party's proprietary information and not to disclose such information to any third party without prior written consent.</p>
        </div>

        <div class="${sectionClass}">
          <h2>${deliverables ? (paymentAmount ? '8' : '7') : (paymentAmount ? '7' : '6')}. Governing Law</h2>
          <p>This Agreement shall be governed by applicable law. Any disputes shall be resolved through good-faith negotiation, and if necessary, binding arbitration.</p>
        </div>
      `;
  }
}

function contractTypeLabel(type: ContractType): string {
  const labels: Record<ContractType, string> = {
    SERVICE_AGREEMENT: 'Service Agreement',
    FREELANCE_AGREEMENT: 'Freelance Agreement',
    PAYMENT_AGREEMENT: 'Payment Agreement',
    GENERAL_AGREEMENT: 'General Agreement',
  };
  return labels[type] ?? 'Agreement';
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function buildContractHtml(contract: ContractData): string {
  const fields = contract.extractedFields as ExtractedField[];
  const partyOne = getField(fields, 'partyOneName') || 'Party One';
  const partyTwo = getField(fields, 'partyTwoName') || 'Party Two';
  const sections = buildSections(contract.type, fields);
  const typeLabel = contractTypeLabel(contract.type);

  const sigSenderHtml = contract.mySignature
    ? `<img src="${contract.mySignature}" alt="Signature" class="sig-image" />`
    : `<div class="sig-line"></div>`;

  const sigRecipientHtml = contract.otherPartySignature
    ? `<img src="${contract.otherPartySignature}" alt="Signature" class="sig-image" />`
    : `<div class="sig-line"></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${contract.title}</title>
  <style>
    /* ── Reset & Base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.7;
      color: #1a1a1a;
      background: #ffffff;
      padding: 0;
    }

    /* ── Page Wrapper ── */
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 50px 60px;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 18px;
      margin-bottom: 30px;
    }

    .header-brand {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 9pt;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #666;
    }

    .header-meta {
      text-align: right;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5pt;
      color: #888;
      line-height: 1.5;
    }

    /* ── Title Block ── */
    .title-block {
      text-align: center;
      margin-bottom: 36px;
    }

    .contract-type-label {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 10px;
    }

    .contract-title {
      font-size: 20pt;
      font-weight: bold;
      color: #111;
      line-height: 1.3;
      margin-bottom: 6px;
    }

    .contract-id {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      color: #aaa;
      letter-spacing: 1px;
    }

    /* ── Divider ── */
    .divider {
      border: none;
      border-top: 1px solid #ddd;
      margin: 24px 0;
    }

    /* ── Sections ── */
    .section {
      margin-bottom: 26px;
    }

    .section h2 {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #333;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 5px;
      margin-bottom: 12px;
    }

    .section p {
      margin-bottom: 10px;
    }

    .section ul {
      margin: 10px 0 10px 22px;
    }

    .section ul li {
      margin-bottom: 5px;
    }

    .address {
      font-style: italic;
      color: #555;
      font-size: 10pt;
    }

    /* ── Signature Block ── */
    .signature-section {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #1a1a1a;
    }

    .signature-section h2 {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #333;
      margin-bottom: 24px;
    }

    .sig-row {
      display: flex;
      gap: 60px;
      justify-content: space-between;
    }

    .sig-block {
      flex: 1;
      min-width: 0;
    }

    .sig-label {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
      margin-bottom: 6px;
    }

    .sig-image {
      display: block;
      max-height: 60px;
      max-width: 220px;
      object-fit: contain;
      margin-bottom: 4px;
    }

    .sig-line {
      border-bottom: 1px solid #555;
      height: 50px;
      margin-bottom: 6px;
      width: 100%;
    }

    .sig-name {
      font-size: 10pt;
      font-weight: bold;
      color: #222;
      border-top: 1px solid #ccc;
      padding-top: 4px;
    }

    .sig-date-label {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8.5pt;
      color: #888;
      margin-top: 10px;
    }

    .sig-date-line {
      border-bottom: 1px solid #555;
      height: 22px;
      width: 160px;
      margin-top: 4px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 40px;
      border-top: 1px solid #ddd;
      padding-top: 12px;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      color: #aaa;
      text-align: center;
      line-height: 1.6;
    }

    /* ── Print / PDF ── */
    @page {
      size: A4;
      margin: 20mm;
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="header">
      <div class="header-brand">ContractFlow</div>
      <div class="header-meta">
        Document ID: ${contract.id.slice(0, 8).toUpperCase()}<br />
        Generated: ${currentDateFormatted()}
      </div>
    </div>

    <!-- Title -->
    <div class="title-block">
      <div class="contract-type-label">${typeLabel}</div>
      <div class="contract-title">${contract.title}</div>
      <div class="contract-id">REF: CF-${contract.id.slice(0, 8).toUpperCase()}</div>
    </div>

    <hr class="divider" />

    <!-- Contract Sections -->
    ${sections}

    <!-- Signature Block -->
    <div class="signature-section">
      <h2>Signatures</h2>
      <p style="margin-bottom: 24px; font-size: 10pt; color: #555;">
        By signing below, both parties agree to be bound by the terms and conditions of this Agreement.
        This Agreement may be signed in counterparts, each of which shall be deemed an original.
      </p>
      <div class="sig-row">
        <div class="sig-block">
          <div class="sig-label">First Party / Sender</div>
          ${sigSenderHtml}
          <div class="sig-name">${partyOne}</div>
          <div class="sig-date-label">Date:</div>
          <div class="sig-date-line"></div>
        </div>
        <div class="sig-block">
          <div class="sig-label">Second Party / Recipient</div>
          ${sigRecipientHtml}
          <div class="sig-name">${partyTwo}</div>
          <div class="sig-date-label">Date:</div>
          <div class="sig-date-line"></div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      This document was generated by ContractFlow. The parties acknowledge that electronic signatures
      are legally binding. Both parties should retain a copy of this Agreement.
      &nbsp;|&nbsp; Generated ${currentDateFormatted()}
    </div>

  </div>
</body>
</html>`;
}

// ─── Puppeteer Helpers ────────────────────────────────────────────────────────

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a PDF Buffer from contract data using Puppeteer.
 */
export async function generateContractPdf(contract: ContractData): Promise<Buffer> {
  logger.info('Generating contract PDF', {
    contractId: contract.id,
    type: contract.type,
    title: contract.title,
  });

  let browser;
  try {
    const html = buildContractHtml(contract);
    browser = await launchBrowser();
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfUint8Array = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm',
      },
    });

    const pdfBuffer = Buffer.from(pdfUint8Array);

    logger.info('PDF generated successfully', {
      contractId: contract.id,
      sizeBytes: pdfBuffer.length,
    });

    return pdfBuffer;
  } catch (err) {
    logger.error('PDF generation failed', {
      contractId: contract.id,
      error: (err as Error).message,
    });
    throw new AppError(
      `Failed to generate contract PDF: ${(err as Error).message}`,
      500
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Embed sender and/or recipient signatures into an existing contract PDF
 * by re-rendering the HTML with signature images included.
 *
 * Rather than trying to overlay onto an opaque PDF buffer, we regenerate
 * the full HTML with the signatures injected, which is more reliable.
 */
export async function embedSignatureInPdf(
  contract: ContractData,
  signatures: SignatureSet
): Promise<Buffer> {
  logger.info('Embedding signatures in PDF', {
    contractId: contract.id,
    hasSender: !!signatures.sender,
    hasRecipient: !!signatures.recipient,
  });

  // Merge signatures into the contract data object before regenerating
  const updatedContract: ContractData = {
    ...contract,
    mySignature: signatures.sender ?? contract.mySignature,
    otherPartySignature: signatures.recipient ?? contract.otherPartySignature,
  };

  return generateContractPdf(updatedContract);
}
