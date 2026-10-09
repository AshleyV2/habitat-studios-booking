import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { AuthProvider } from './hooks/useAuth';
import { AdminLayout } from './layouts/AdminLayout';
import { BASE_PATH } from './lib/base';
import { AdminForgotPage, AdminLoginPage, AdminResetPage } from './pages/admin/AuthPages';
import { BookingDetailPage } from './pages/admin/BookingDetailPage';
import { BookingFormPage } from './pages/admin/BookingFormPage';
import { BookingsPage } from './pages/admin/BookingsPage';
import { CalendarPage } from './pages/admin/CalendarPage';
import { DashboardPage } from './pages/admin/DashboardPage';
import { SetupGate, SetupPage } from './pages/admin/SetupPage';
import { WebsitePage } from './pages/admin/WebsitePage';
import { WebsitePreview } from './pages/admin/WebsitePreview';
import { CustomerDetailPage, CustomersPage, PaymentsPage } from './pages/admin/PeoplePages';
import { PromoCodesPage } from './pages/admin/PromoCodesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { EquipmentPage, HoursPage, RoomsPage } from './pages/admin/SetupPages';
import { AccountPage, AuditPage, EmailPage, HealthPage, StaffPage } from './pages/admin/SystemPages';
import { BookingPage } from './pages/public/BookingPage';
import { BookingStatusPage } from './pages/public/BookingStatusPage';
import { Contained, HomeRoute, NotFoundRoute, PolicyRoute, PublicLayout, SlugRoute } from './pages/public/PublicLayout';

const router = createBrowserRouter(
  [
    {
      element: (
        <AuthProvider>
          <SetupGate>
            <Outlet />
          </SetupGate>
        </AuthProvider>
      ),
      children: [
        {
          element: <PublicLayout />,
          children: [
            { index: true, element: <HomeRoute /> },
            { path: 'book', element: <Contained><BookingPage /></Contained> },
            { path: 'terms', element: <PolicyRoute kind="terms" /> },
            { path: 'refunds', element: <PolicyRoute kind="refunds" /> },
            { path: 'privacy', element: <PolicyRoute kind="privacy" /> },
            { path: 'booking/:reference', element: <Contained><BookingStatusPage /></Contained> },
            // about, rooms, gallery (original site) or any page made in Admin › Website.
            { path: ':slug', element: <SlugRoute /> },
            { path: '*', element: <NotFoundRoute /> },
          ],
        },
        { path: 'setup', element: <SetupPage /> },
        { path: 'admin/login', element: <AdminLoginPage /> },
        { path: 'admin/website/preview', element: <WebsitePreview /> },
        { path: 'admin/forgot-password', element: <AdminForgotPage /> },
        { path: 'admin/reset-password', element: <AdminResetPage /> },
        {
          path: 'admin',
          element: <AdminLayout />,
          children: [
            { index: true, element: <DashboardPage /> },
            { path: 'calendar', element: <CalendarPage /> },
            { path: 'bookings', element: <BookingsPage /> },
            { path: 'bookings/new', element: <BookingFormPage /> },
            { path: 'bookings/:id', element: <BookingDetailPage /> },
            { path: 'bookings/:id/edit', element: <BookingFormPage /> },
            { path: 'customers', element: <CustomersPage /> },
            { path: 'customers/:id', element: <CustomerDetailPage /> },
            { path: 'payments', element: <PaymentsPage /> },
            { path: 'rooms', element: <RoomsPage /> },
            { path: 'promo-codes', element: <PromoCodesPage /> },
            { path: 'equipment', element: <EquipmentPage /> },
            { path: 'hours', element: <HoursPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'website', element: <WebsitePage /> },
            { path: 'email', element: <EmailPage /> },
            { path: 'health', element: <HealthPage /> },
            { path: 'staff', element: <StaffPage /> },
            { path: 'audit', element: <AuditPage /> },
            { path: 'account', element: <AccountPage /> },
          ],
        },
      ],
    },
  ],
  { basename: BASE_PATH || '/' },
);

export function App() {
  return <RouterProvider router={router} />;
}
