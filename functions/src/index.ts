/**
 * Qareeb Cloud Functions entry point. Every mutation that matters is a callable that independently
 * verifies authentication, suspension, role, branch membership, payload and ownership.
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { REGION } from './lib/firebase.js';

setGlobalOptions({ region: REGION, maxInstances: 20, concurrency: 40 });

export { ensureProfile, saveAddress, deleteAddress, setDefaultAddress, updateProfile } from './domain/users.js';
export { createBusiness, updateBusiness, setBusinessImage, setLoyaltyRules, createBranch, updateBranch, setOrdersPaused, inviteMember, getInvitation, acceptInvitation, updateMembership, listMembers } from './domain/businesses.js';
export { saveCategory, setCategoryArchived, reorderCategories, saveProduct, setProductArchived, reorderProducts, adjustStock, setProductImage, copyToBranch } from './domain/catalog.js';
export { quoteOrder, placeOrder, decideOrder, reviseOrder, recordCash, reverseCash } from './domain/orders.js';
export { savePrinter, deactivatePrinter, markPrinterVerified, registerStation, stationHeartbeat, releaseStation, enqueuePrint, claimPrintJob, reportPrintAttempt, resolvePrintJob } from './domain/printing.js';
export { decideApproval, setUserSuspended, inviteOwner, saveCity, adminAdjustLoyalty, adminReverseCash, moderateProduct, setPlatformConfig, getAdminMetrics, adminListUsers } from './domain/admin.js';
export { whatsappStart, whatsappCheck, authOptions } from './domain/whatsapp.js';
export { onOutboxCreated, scheduledSweeps, onImageUploaded } from './triggers.js';
