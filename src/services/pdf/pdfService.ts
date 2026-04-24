import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { ExtractedField } from '../ai/extractService';

// ─── Logo ─────────────────────────────────────────────────────────────────────

function resolveLogoPath(): string {
  const candidates = [
    path.resolve(__dirname, '../../assets/clerra-logo.png'),
    path.resolve(process.cwd(), 'src/assets/clerra-logo.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

function getLogoDataUrl(): string {
  try {
    const logoBuffer = fs.readFileSync(resolveLogoPath());
    return `data:image/png;base64,${logoBuffer.toString('base64')}`;
  } catch {
    logger.warn('Could not read Clerra logo file, falling back to text icon');
    return '';
  }
}

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
  sender?: string | null;
  recipient?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signatureImgSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('http')) return value;
  return `data:image/png;base64,${value}`;
}

// Supports multiple fallback keys (UI uses party1Name, extraction uses partyOneName)
function getField(fields: ExtractedField[], ...keys: string[]): string {
  for (const key of keys) {
    const val = fields.find((f) => f.key === key)?.value;
    if (val && val !== 'null') return val;
  }
  return '';
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '_______________';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount?: string | null, currency?: string | null): string {
  if (!amount) return 'As agreed';
  const symbols: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$',
    JPY: '¥', CHF: 'CHF ', INR: '₹', SGD: 'S$', HKD: 'HK$',
  };
  const sym = symbols[(currency ?? 'USD').toUpperCase()] ?? `${currency ?? 'USD'} `;
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return `${sym}${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function contractTypeLabel(type: ContractType): string {
  const labels: Record<ContractType, string> = {
    SERVICE_AGREEMENT:  'Service Agreement',
    FREELANCE_AGREEMENT: 'Freelance Agreement',
    PAYMENT_AGREEMENT:  'Payment Agreement',
    GENERAL_AGREEMENT:  'General Agreement',
  };
  return labels[type] ?? 'Agreement';
}

// ─── Section Builder ──────────────────────────────────────────────────────────

function buildSections(type: ContractType, fields: ExtractedField[]): string {
  const partyOne      = getField(fields, 'party1Name', 'partyOneName') || 'Party One';
  const partyTwo      = getField(fields, 'party2Name', 'partyTwoName') || 'Party Two';
  const partyOneAddr  = getField(fields, 'partyOneAddress');
  const partyTwoAddr  = getField(fields, 'partyTwoAddress');
  const serviceDesc   = getField(fields, 'serviceDescription') || 'As described between the parties.';
  const paymentAmount = getField(fields, 'paymentAmount');
  const paymentCurrency = getField(fields, 'paymentCurrency') || 'USD';
  const startDate     = getField(fields, 'startDate');
  const endDate       = getField(fields, 'endDate');
  const dueDate       = getField(fields, 'dueDate');
  const deliverables  = getField(fields, 'deliverables');
  const terms         = getField(fields, 'terms');

  const payment       = formatCurrency(paymentAmount, paymentCurrency);
  const effectiveDate = startDate ? formatDate(startDate) : today();

  let n = 1;
  const parts: string[] = [];

  const sec = (title: string, body: string) => {
    parts.push(`
      <div class="section">
        <div class="section-header">
          <span class="sec-num">§ ${n++}</span>
          <span class="sec-title">${title}</span>
        </div>
        <div class="sec-body">${body}</div>
      </div>`);
  };

  const dataRow = (label: string, value: string) =>
    `<div class="data-row"><span class="dl">${label}</span><span class="dv">${value}</span></div>`;

  const highlight = (text: string) =>
    `<div class="highlight-block">${text}</div>`;

  const list = (csv: string) =>
    `<ul>${csv.split(',').map((d) => `<li>${d.trim()}</li>`).join('')}</ul>`;

  switch (type) {
    case 'SERVICE_AGREEMENT':
      sec('Services',
        `<p>${partyOne} ("Service Provider") agrees to provide the following services to ${partyTwo} ("Client"):</p>
         ${highlight(serviceDesc)}
         ${startDate ? dataRow('Commencement Date', formatDate(startDate)) : ''}
         ${endDate   ? dataRow('Completion Date',   formatDate(endDate))   : ''}`);

      if (deliverables) sec('Deliverables', list(deliverables));

      sec('Compensation',
        `${dataRow('Total Fee', payment)}
         ${dueDate ? dataRow('Payment Due', formatDate(dueDate)) : ''}
         <p>Payment shall be remitted via the method agreed upon in writing. Invoices unpaid after thirty (30) days shall accrue interest at 1.5% per month (18% per annum) on the outstanding balance. The Client shall also be responsible for reasonable collection costs.</p>`);

      sec('Intellectual Property',
        `<p>Upon receipt of full payment, all work product created specifically under this Agreement shall become the exclusive property of the Client. The Service Provider retains all rights in pre-existing materials and tools ("Background IP"). Any Background IP incorporated into deliverables is licensed to the Client on a non-exclusive, perpetual, royalty-free basis.</p>`);

      sec('Confidentiality',
        `<p>Each party shall hold in strict confidence all non-public information received from the other party ("Confidential Information") and shall not disclose it to any third party without prior written consent. This obligation survives termination of this Agreement for two (2) years.</p>`);

      if (terms) sec('Additional Terms', `<p>${terms}</p>`);

      sec('Termination',
        `<p>Either party may terminate this Agreement upon thirty (30) days' prior written notice. Upon termination, the Client shall pay for all services satisfactorily rendered through the termination date, and the Service Provider shall deliver all completed work product.</p>`);

      sec('Limitation of Liability',
        `<p>Neither party shall be liable for indirect, incidental, consequential, special, or exemplary damages arising from this Agreement. Each party's total aggregate liability shall not exceed the total fees paid or payable hereunder.</p>`);

      sec('Governing Law & Disputes',
        `<p>This Agreement is governed by applicable law. Disputes shall first be addressed through thirty (30) days of good-faith negotiation, and if unresolved, through binding arbitration under the rules of the American Arbitration Association.</p>`);

      sec('Entire Agreement',
        `<p>This Agreement constitutes the entire understanding between the parties regarding its subject matter and supersedes all prior agreements and representations. Amendments must be in a written instrument signed by both parties.</p>`);
      break;

    case 'FREELANCE_AGREEMENT':
      sec('Independent Contractor Status',
        `<p>${partyOne} ("Contractor") is engaged as an independent contractor and not as an employee of ${partyTwo} ("Client"). Nothing herein creates a partnership, joint venture, employment, or agency relationship. The Contractor bears sole responsibility for all applicable taxes and maintains adequate professional liability insurance at their own expense.</p>`);

      sec('Project Scope',
        `<p>The Contractor agrees to perform the following for the Client:</p>
         ${highlight(serviceDesc)}
         ${startDate ? dataRow('Start Date', formatDate(startDate)) : ''}`);

      if (deliverables)
        sec('Deliverables & Milestones',
          `${list(deliverables)}
           ${endDate ? dataRow('Project Deadline', formatDate(endDate)) : ''}`);

      sec('Compensation & Payment',
        `${dataRow('Project Fee', payment)}
         ${dueDate ? dataRow('Payment Due', formatDate(dueDate)) : ''}
         <p>Invoices are payable within fourteen (14) days of receipt. The Contractor may suspend work if payment is more than fourteen (14) days overdue. Outstanding balances accrue interest at 1.5% per month.</p>`);

      sec('Intellectual Property',
        `<p>Upon receipt of full payment, the Contractor assigns to the Client all rights, title, and interest in the final deliverables created hereunder. The Contractor retains all rights in Background IP; any Background IP incorporated into deliverables is licensed to the Client on a non-exclusive, perpetual, royalty-free basis for use of the final deliverable only.</p>`);

      sec('Revisions & Change Orders',
        `<p>This Agreement includes up to two (2) rounds of revisions per deliverable. Additional revisions or material scope changes shall be billed at the Contractor's standard rate, agreed in writing before additional work commences.</p>`);

      sec('Confidentiality',
        `<p>The Contractor shall maintain strict confidentiality of all Client information and shall not disclose it to any third party without prior written consent. This obligation survives termination for two (2) years.</p>`);

      if (terms) sec('Additional Terms', `<p>${terms}</p>`);

      sec('Termination',
        `<p>Either party may terminate this Agreement upon fourteen (14) days' written notice. Upon early termination by the Client, the Client shall pay for all work completed to date. The Contractor shall deliver all completed deliverables upon receipt of outstanding payment.</p>`);

      sec('Governing Law',
        `<p>This Agreement is governed by applicable law. Disputes shall be resolved through negotiation, and if unresolved, through binding arbitration.</p>`);
      break;

    case 'PAYMENT_AGREEMENT':
      sec('Acknowledgment of Obligation',
        `<p>${partyTwo} ("Obligor") hereby unconditionally acknowledges and confirms owing to ${partyOne} ("Obligee") the principal sum of <strong>${payment}</strong> arising from:</p>
         ${highlight(serviceDesc)}`);

      sec('Payment Terms',
        `${dueDate ? dataRow('Payment Due Date', formatDate(dueDate)) : ''}
         ${deliverables
           ? `<p><strong>Installment Schedule:</strong></p>${list(deliverables)}`
           : `<p>The full amount of <strong>${payment}</strong> is due in a single payment${dueDate ? ` on or before <strong>${formatDate(dueDate)}</strong>` : ' as agreed by the parties'}.</p>`}`);

      sec('Late Payment',
        `<p>Any amount not received by the due date shall accrue interest at <strong>1.5% per month</strong> (18% per annum), calculated daily from the due date until actual receipt of payment. The Obligor shall also be liable for all reasonable collection costs and attorneys' fees incurred by the Obligee.</p>`);

      sec('Method of Payment',
        `<p>All payments shall be made by bank wire transfer, ACH, certified check, or such other method as designated in writing by the Obligee. Payment is deemed received only upon clearance of funds in the Obligee's designated account.</p>`);

      sec('Default',
        `<p>If the Obligor fails to make any payment when due and does not cure such failure within ten (10) business days after written notice from the Obligee, the entire unpaid principal balance, together with all accrued interest, shall become immediately due and payable at the Obligee's election.</p>`);

      if (terms) sec('Additional Terms', `<p>${terms}</p>`);

      sec('Governing Law',
        `<p>This Agreement is governed by applicable law. Any dispute shall be resolved through negotiation, and if unresolved, through binding arbitration.</p>`);
      break;

    case 'GENERAL_AGREEMENT':
    default:
      sec('Purpose & Background',
        `<p>The parties enter into this Agreement to memorialize the terms and conditions governing their mutual obligations as set forth herein. The parties acknowledge that this Agreement is binding and enforceable.</p>`);

      sec('Terms & Obligations',
        `${highlight(serviceDesc)}
         ${terms ? `<p>${terms}</p>` : ''}`);

      if (deliverables) sec('Specific Obligations', list(deliverables));

      if (paymentAmount)
        sec('Consideration',
          `${dataRow('Agreed Amount', payment)}
           ${dueDate ? dataRow('Due Date', formatDate(dueDate)) : ''}`);

      sec('Term',
        `${startDate ? dataRow('Effective Date', formatDate(startDate)) : ''}
         ${endDate   ? dataRow('Expiry Date',    formatDate(endDate))   : ''}
         <p>This Agreement shall remain in effect until all obligations have been fulfilled or until terminated by mutual written agreement of the parties.</p>`);

      sec('Confidentiality',
        `<p>Each party shall maintain the confidentiality of all non-public information received from the other party and shall not disclose it to any third party without prior written consent. This obligation survives termination.</p>`);

      sec('Governing Law',
        `<p>This Agreement is governed by applicable law. Disputes shall be resolved through good-faith negotiation, and if necessary, binding arbitration.</p>`);

      sec('Entire Agreement',
        `<p>This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations. Any amendment must be in writing and signed by both parties.</p>`);
      break;
  }

  return parts.join('\n');
}

// ─── HTML Template ────────────────────────────────────────────────────────────

function buildContractHtml(contract: ContractData): string {
  const fields    = contract.extractedFields as ExtractedField[];
  const partyOne  = getField(fields, 'party1Name', 'partyOneName') || 'Party One';
  const partyTwo  = getField(fields, 'party2Name', 'partyTwoName') || 'Party Two';
  const p1Addr    = getField(fields, 'partyOneAddress');
  const p2Addr    = getField(fields, 'partyTwoAddress');
  const sections  = buildSections(contract.type, fields);
  const typeLabel = contractTypeLabel(contract.type);
  const refId     = `CF-${contract.id.slice(0, 8).toUpperCase()}`;
  const genDate   = today();
  const logoDataUrl = getLogoDataUrl();

  const senderSrc    = signatureImgSrc(contract.mySignature);
  const recipientSrc = signatureImgSrc(contract.otherPartySignature);

  const sigBox = (name: string, role: string, imgSrc: string | null) => `
    <div class="sig-block">
      <div class="sig-role">${role}</div>
      ${imgSrc
        ? `<img src="${imgSrc}" class="sig-img" alt="Signature" />`
        : `<div class="sig-line"></div>`}
      <div class="sig-meta">
        <div class="sig-field">
          <div class="sf-label">Printed Name</div>
          <div class="sf-value">${name}</div>
        </div>
        <div class="sig-field">
          <div class="sf-label">Date</div>
          <div class="sf-value">&nbsp;</div>
        </div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${contract.title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body { width: 816px; }

    body {
      font-family: 'Georgia', 'Times New Roman', Times, serif;
      font-size: 10.5pt;
      line-height: 1.78;
      color: #1c1c2e;
      background: #ffffff;
    }

    .page { max-width: 816px; margin: 0 auto; }

    /* ── Top bar ── */
    .top-bar {
      height: 7px;
      background: linear-gradient(90deg, #0a1f44 0%, #1e3a8a 60%, #2563eb 100%);
    }

    /* ── Letterhead ── */
    .letterhead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 56px 18px;
      border-bottom: 1px solid #e2e8f0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }

    .brand-logo {
      height: 32px;
      width: auto;
      object-fit: contain;
    }

    .brand-icon-fallback {
      width: 30px; height: 30px;
      background: #0a1f44;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      color: #ffffff;
      font-size: 14px;
      font-weight: bold;
      font-family: 'Georgia', serif;
      letter-spacing: -1px;
    }

    .brand-name {
      font-size: 13pt;
      font-weight: 800;
      color: #0a1f44;
      letter-spacing: -0.4px;
    }

    .brand-sub {
      font-size: 6.5pt;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin-top: 1px;
    }

    .doc-info {
      text-align: right;
      font-family: 'Helvetica Neue', Arial, sans-serif;
    }

    .doc-ref {
      font-size: 8pt;
      font-weight: 700;
      color: #0a1f44;
      letter-spacing: 0.5px;
    }

    .doc-date {
      font-size: 7.5pt;
      color: #64748b;
      margin-top: 2px;
    }

    /* ── Title area ── */
    .title-area {
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 30px 56px 28px;
      text-align: center;
    }

    .type-badge {
      display: inline-block;
      background: #0a1f44;
      color: #ffffff;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 2.5px;
      text-transform: uppercase;
      padding: 4px 14px 3px;
      border-radius: 3px;
      margin-bottom: 14px;
    }

    .contract-title {
      font-size: 20pt;
      font-weight: bold;
      color: #0a1f44;
      line-height: 1.25;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }

    .contract-ref {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      color: #94a3b8;
      letter-spacing: 1.2px;
    }

    /* ── Parties bar ── */
    .parties-bar {
      display: flex;
      margin: 24px 56px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
    }

    .party-card {
      flex: 1;
      padding: 16px 22px;
      background: #ffffff;
    }

    .party-card + .party-card {
      border-left: 1px solid #cbd5e1;
    }

    .party-role-label {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #2563eb;
      margin-bottom: 4px;
    }

    .party-name {
      font-size: 11.5pt;
      font-weight: bold;
      color: #0a1f44;
      margin-bottom: 2px;
    }

    .party-addr {
      font-size: 8.5pt;
      font-style: italic;
      color: #64748b;
      line-height: 1.45;
      margin-top: 3px;
    }

    /* ── Body ── */
    .body-wrap {
      padding: 4px 56px 0;
    }

    /* ── Preamble ── */
    .preamble {
      font-size: 10pt;
      color: #475569;
      line-height: 1.8;
      margin-bottom: 26px;
      padding-bottom: 20px;
      border-bottom: 1px solid #f1f5f9;
      text-align: justify;
    }

    /* ── Section ── */
    .section {
      margin-bottom: 22px;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding-bottom: 7px;
      border-bottom: 1px solid #e2e8f0;
    }

    .sec-num {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 7pt;
      font-weight: 700;
      color: #1e3a8a;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 3px;
      padding: 2px 8px;
      letter-spacing: 0.3px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .sec-title {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #0f172a;
    }

    .sec-body p {
      font-size: 10.5pt;
      line-height: 1.78;
      color: #334155;
      margin-bottom: 8px;
      text-align: justify;
    }

    .sec-body ul {
      margin: 6px 0 8px 20px;
    }

    .sec-body ul li {
      font-size: 10.5pt;
      color: #334155;
      margin-bottom: 4px;
      line-height: 1.65;
    }

    /* ── Highlight block ── */
    .highlight-block {
      font-size: 10.5pt;
      line-height: 1.72;
      color: #1e293b;
      background: #f8fafc;
      border-left: 3px solid #2563eb;
      border-radius: 0 5px 5px 0;
      padding: 10px 16px;
      margin: 8px 0 10px;
    }

    /* ── Data rows ── */
    .data-row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 5px;
    }

    .dl {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      min-width: 130px;
      flex-shrink: 0;
    }

    .dv {
      font-size: 10.5pt;
      font-weight: 600;
      color: #0f172a;
    }

    /* ── Signature section ── */
    .sig-section {
      margin-top: 30px;
      padding: 26px 56px 28px;
      background: #f8fafc;
      border-top: 2px solid #0a1f44;
    }

    .sig-heading {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #0a1f44;
      margin-bottom: 8px;
    }

    .sig-witness {
      font-size: 9.5pt;
      font-style: italic;
      color: #475569;
      line-height: 1.7;
      margin-bottom: 26px;
    }

    .sig-row {
      display: flex;
      gap: 48px;
    }

    .sig-block {
      flex: 1;
      min-width: 0;
    }

    .sig-role {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #2563eb;
      margin-bottom: 8px;
    }

    .sig-img {
      display: block;
      max-height: 58px;
      max-width: 220px;
      object-fit: contain;
      margin-bottom: 0;
    }

    .sig-line {
      border-bottom: 1.5px solid #475569;
      height: 56px;
      width: 100%;
    }

    .sig-meta {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 12px;
      margin-top: 10px;
    }

    .sig-field {
      border-bottom: 1px solid #94a3b8;
      padding-bottom: 3px;
    }

    .sf-label {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #94a3b8;
      margin-bottom: 2px;
    }

    .sf-value {
      font-size: 9pt;
      font-weight: 600;
      color: #0f172a;
      min-height: 13px;
    }

    /* ── Footer ── */
    .doc-footer {
      padding: 12px 56px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .footer-left {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      color: #94a3b8;
      line-height: 1.6;
    }

    .footer-right {
      text-align: right;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 6.5pt;
      color: #94a3b8;
    }

    .confidential-tag {
      display: inline-block;
      border: 1px solid #cbd5e1;
      border-radius: 3px;
      padding: 2px 8px;
      font-size: 6pt;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Top accent bar -->
  <div class="top-bar"></div>

  <!-- Letterhead -->
  <div class="letterhead">
    <div class="brand">
      ${logoDataUrl
        ? `<img src="${logoDataUrl}" class="brand-logo" alt="Clerra" />`
        : `<div class="brand-icon-fallback">C</div>`}
    </div>
    <div class="doc-info">
      <div class="doc-ref">${refId}</div>
      <div class="doc-date">Generated ${genDate}</div>
    </div>
  </div>

  <!-- Title -->
  <div class="title-area">
    <div class="type-badge">${typeLabel}</div>
    <div class="contract-title">${contract.title}</div>
    <div class="contract-ref">Document Reference: ${refId} &nbsp;·&nbsp; Effective ${contract.createdAt ? formatDate(contract.createdAt.toISOString()) : genDate}</div>
  </div>

  <!-- Party cards -->
  <div class="parties-bar">
    <div class="party-card">
      <div class="party-role-label">First Party</div>
      <div class="party-name">${partyOne}</div>
      ${p1Addr ? `<div class="party-addr">${p1Addr}</div>` : ''}
    </div>
    <div class="party-card">
      <div class="party-role-label">Second Party</div>
      <div class="party-name">${partyTwo}</div>
      ${p2Addr ? `<div class="party-addr">${p2Addr}</div>` : ''}
    </div>
  </div>

  <!-- Body -->
  <div class="body-wrap">

    <div class="preamble">
      This ${typeLabel} (the "Agreement") is entered into as of <strong>${genDate}</strong> by and between <strong>${partyOne}</strong> and <strong>${partyTwo}</strong> (each a "Party," collectively the "Parties"). The Parties, intending to be legally bound, hereby agree to the following terms and conditions:
    </div>

    ${sections}

  </div>

  <!-- Signature block -->
  <div class="sig-section">
    <div class="sig-heading">Signatures</div>
    <div class="sig-witness">
      IN WITNESS WHEREOF, the Parties hereto have executed this Agreement as of the date first written above.
      This Agreement may be executed in one or more counterparts, each of which shall be deemed an original,
      and all of which together shall constitute one and the same instrument. Electronic signatures are
      legally binding and have the same force and effect as original ink signatures.
    </div>
    <div class="sig-row">
      ${sigBox(partyOne, 'First Party', senderSrc)}
      ${sigBox(partyTwo, 'Second Party', recipientSrc)}
    </div>
  </div>

  <!-- Footer -->
  <div class="doc-footer">
    <div class="footer-left">
      <span class="confidential-tag">Confidential</span><br />
      This document was generated by Clerra. Both parties should retain a copy.
    </div>
    <div class="footer-right">
      ${refId}<br />
      Page 1 of 1
    </div>
  </div>

</div>
</body>
</html>`;
}

// ─── Puppeteer ────────────────────────────────────────────────────────────────

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

    // Set a wide viewport so layout matches the 816px design width
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Measure the full rendered content height so the PDF is one continuous
    // page — no mid-sentence page breaks, no Chromium break-inside quirks.
    const contentHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );

    const pdfUint8Array = await page.pdf({
      width: '816px',
      height: `${contentHeight}px`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
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
    if (browser) await browser.close();
  }
}

export async function embedSignatureInPdf(
  contract: ContractData,
  signatures: SignatureSet
): Promise<Buffer> {
  logger.info('Embedding signatures in PDF', {
    contractId: contract.id,
    hasSender: !!signatures.sender,
    hasRecipient: !!signatures.recipient,
  });

  return generateContractPdf({
    ...contract,
    mySignature: signatures.sender ?? contract.mySignature,
    otherPartySignature: signatures.recipient ?? contract.otherPartySignature,
  });
}
