import { get } from '../api'

// Split payment (Seva / Donation): availability, the document's own payment modes, the usual cash / bank account per mode
export const getSplitMeta = (docType) => get('/split-payments/meta', { params: { doc_type: docType } })
