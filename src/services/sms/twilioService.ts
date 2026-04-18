import twilio from 'twilio';
import { config } from '../../config/env';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export async function sendVerification(phone: string): Promise<void> {
  await client.verify.v2
    .services(config.twilio.verifyServiceSid)
    .verifications.create({ to: phone, channel: 'sms' });
}

export async function checkVerification(phone: string, code: string): Promise<boolean> {
  try {
    const result = await client.verify.v2
      .services(config.twilio.verifyServiceSid)
      .verificationChecks.create({ to: phone, code });
    return result.status === 'approved';
  } catch (err: any) {
    // 20404 = verification not found (expired or already used) — treat as invalid
    if (err?.code === 20404 || err?.status === 404) return false;
    throw err;
  }
}
