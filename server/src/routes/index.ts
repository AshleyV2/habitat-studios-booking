import express, { Router } from 'express';
import { adminController as admin } from '../controllers/admin.controller';
import { authController as auth } from '../controllers/auth.controller';
import { publicController as pub } from '../controllers/public.controller';
import { siteController as site } from '../controllers/site.controller';
import { requireAuth, requirePermission as can } from '../middleware/auth';
import { bookingLimiter, emailLimiter, loginAccountLimiter, loginLimiter, manageLimiter } from '../middleware/rate-limit';

// --- Public booking API (no customer data except through a booking's private link) ---
const publicRoutes = Router();
publicRoutes.get('/config', pub.config);
publicRoutes.get('/site', site.published);
publicRoutes.get('/rooms', pub.rooms);
publicRoutes.get('/availability', pub.availability);
publicRoutes.get('/equipment', pub.equipment);
publicRoutes.get('/equipment-list', pub.equipmentList);
publicRoutes.post('/quote', pub.quote);
publicRoutes.post('/bookings', bookingLimiter, pub.createBooking);
publicRoutes.get('/bookings/:reference', manageLimiter, pub.viewBooking);
publicRoutes.post('/bookings/:reference/cancel', manageLimiter, pub.cancelBooking);

// --- Staff authentication ----------------------------------------------------------
const authRoutes = Router();
authRoutes.get('/csrf', auth.csrf);
authRoutes.post('/login', loginLimiter, loginAccountLimiter, auth.login);
authRoutes.get('/setup', auth.setupStatus);
authRoutes.post('/setup', loginLimiter, auth.setup);
authRoutes.post('/logout', auth.logout);
authRoutes.post('/forgot-password', emailLimiter, auth.forgot);
authRoutes.post('/reset-password', loginLimiter, auth.reset);
authRoutes.post('/change-password', requireAuth, loginLimiter, auth.changePassword);

// --- Admin (every route requires a signed-in staff member with the named permission) ---
const r = Router();
r.get('/dashboard', can('dashboard:read'), admin.dashboard);
r.get('/calendar', can('bookings:read'), admin.calendar);
r.get('/health', can('system:read'), admin.health);

r.get('/bookings', can('bookings:read'), admin.listBookings);
r.post('/bookings', can('bookings:write'), admin.createBooking);
r.post('/quote', can('bookings:read'), admin.quote);
r.get('/equipment-availability', can('bookings:read'), admin.equipmentAvailability);
r.get('/bookings/:id', can('bookings:read'), admin.getBooking);
r.put('/bookings/:id', can('bookings:write'), admin.updateBooking);
r.post('/bookings/:id/cancel', can('bookings:write'), admin.cancelBooking);
r.post('/bookings/:id/complete', can('bookings:write'), admin.complete);
r.post('/bookings/:id/no-show', can('bookings:write'), admin.noShow);
r.patch('/bookings/:id/notes', can('bookings:write'), admin.notes);
r.post('/bookings/:id/resend-confirmation', can('bookings:write'), admin.resendConfirmation);
r.post('/bookings/:id/payments', can('payments:write'), admin.recordPayment);
r.post('/bookings/:id/payment-link', can('payments:write'), admin.paymentLink);
r.post('/bookings/:id/reconcile', can('payments:read'), admin.reconcile);
r.get('/payments', can('payments:read'), admin.listPayments);
r.post('/payments/:id/refund', can('payments:refund'), admin.refund);

r.get('/customers', can('customers:read'), admin.listCustomers);
r.get('/customers/:id', can('customers:read'), admin.getCustomer);
r.put('/customers/:id', can('customers:write'), admin.updateCustomer);

r.get('/promo-codes', can('rooms:write'), admin.listPromoCodes);
r.post('/promo-codes', can('rooms:write'), admin.createPromoCode);
r.put('/promo-codes/:id', can('rooms:write'), admin.updatePromoCode);
r.delete('/promo-codes/:id', can('rooms:write'), admin.deletePromoCode);
r.get('/rooms', can('bookings:read'), admin.listRooms);
r.post('/rooms', can('rooms:write'), admin.createRoom);
r.put('/rooms/:id', can('rooms:write'), admin.updateRoom);
r.delete('/rooms/:id', can('rooms:write'), admin.deleteRoom);
r.post('/rooms/:id/price-rules', can('rooms:write'), admin.addPriceRule);
r.delete('/rooms/:id/price-rules/:ruleId', can('rooms:write'), admin.deletePriceRule);

r.get('/equipment', can('bookings:read'), admin.listEquipment);
r.post('/equipment', can('equipment:write'), admin.createEquipment);
r.put('/equipment/:id', can('equipment:write'), admin.updateEquipment);
r.delete('/equipment/:id', can('equipment:write'), admin.deleteEquipment);

r.get('/opening-hours', can('bookings:read'), admin.getHours);
r.put('/opening-hours', can('hours:write'), admin.setHours);
r.get('/blocks', can('bookings:read'), admin.listBlocks);
r.post('/blocks', can('hours:write'), admin.createBlock);
r.delete('/blocks/:id', can('hours:write'), admin.deleteBlock);

r.get('/settings', can('settings:write'), admin.getSettings);
r.put('/settings', can('settings:write'), admin.updateSettings);
r.get('/settings/connections', can('settings:write'), admin.getConnections);
r.put('/settings/connections', can('settings:write'), admin.updateConnections);
r.post('/settings/connections/test', can('settings:write'), emailLimiter, admin.testConnection);
r.get('/settings/transfer/export', can('settings:write'), admin.exportSetup);
r.post('/settings/transfer/photos/:id', can('settings:write'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), admin.importSetupPhoto);
r.post('/settings/transfer/import', can('settings:write'), admin.importSetup);

r.get('/email', can('system:read'), admin.email);
r.post('/email/verify', can('settings:write'), admin.verifyEmail);
r.post('/email/test', can('settings:write'), emailLimiter, admin.testEmail);
r.post('/email/:id/retry', can('system:read'), admin.retryEmail);

// Website builder
r.get('/site/draft', can('website:write'), site.draft);
r.put('/site/draft', can('website:write'), site.save);
r.post('/site/publish', can('website:write'), site.publish);
r.post('/site/discard', can('website:write'), site.discard);
r.post('/site/reset', can('website:write'), site.reset);
r.post('/site/use-original', can('website:write'), site.useOriginal);
r.get('/site/versions', can('website:write'), site.versions);
r.post('/site/versions/:id/restore', can('website:write'), site.restore);
r.get('/site/assets', can('website:write'), site.assets);
r.post('/site/assets', can('website:write'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), site.upload);
r.delete('/site/assets/:id', can('website:write'), site.deleteAsset);

r.get('/staff', can('staff:manage'), admin.listStaff);
r.post('/staff', can('staff:manage'), admin.inviteStaff);
r.put('/staff/:id', can('staff:manage'), admin.updateStaff);
r.get('/audit', can('audit:read'), admin.audit);

export const apiRouter = Router();
apiRouter.use('/public', publicRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.get('/me', requireAuth, auth.me);
apiRouter.use('/admin', r);
