import { riderDocumentSettings } from '../../src/modules/riders/rider.documents.settings.js';

// Rider documents (migration 039; owner, 2026-10-10): by default every motor
// vehicle must upload four documents before applying, and have them verified
// before approval. Suites written before documents existed apply and approve
// without any, so pin "nothing required" here; tests/rider-documents.test.ts
// switches back to riderDocumentSettings.realRead to test the real setting.
// The two switches (owner, 2026-10-11) keep their stored values.
riderDocumentSettings.read = async () => {
  const real = await riderDocumentSettings.realRead();
  return { ...real, documents: real.documents.map((d) => ({ ...d, required_for: [] })) };
};
