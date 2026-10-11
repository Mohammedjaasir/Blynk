import { BLYNK_WHATSAPP, BLYNK_WHATSAPP_URL } from '../api/applicant';

/**
 * (owner, 2026-10-11) "Mainly I am going to approve the drivers manually;
 * they will send docs on WhatsApp." Shown instead of the document uploads
 * while "Riders upload documents in the app" is off.
 */
export function WhatsAppDocs() {
  return (
    <p className="wa-docs" role="note">
      <span>
        Send your documents to Blynk on WhatsApp <strong>{BLYNK_WHATSAPP}</strong>
      </span>
      <a className="wa-docs__link" href={BLYNK_WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
        Open WhatsApp
      </a>
    </p>
  );
}
