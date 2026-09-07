import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Suspense, lazy } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { AuthProvider } from '@/lib/auth';
import { ToastRegion } from '@/design/components';
import { CustomerLayout } from '@/customer/CustomerLayout';
import { DiscoveryPage } from '@/customer/DiscoveryPage';
import { BusinessPage } from '@/customer/BusinessPage';
import { CartPage } from '@/customer/CartPage';
import { CheckoutPage } from '@/customer/CheckoutPage';
import { OrderPage, OrdersPage } from '@/customer/OrderPages';
import { AccountPage, AddressesPage, FavoritesPage, NotificationsPage, LoyaltyPage } from '@/customer/AccountPages';
import { PhoneAuthPage } from '@/customer/PhoneAuthPage';
import { NotFound, PageFallback } from '@/app/Shell';

const BusinessRoutes = lazy(() => import('@/business/BusinessRoutes').then((m) => ({ default: m.BusinessRoutes })));
const AdminRoutes = lazy(() => import('@/admin/AdminRoutes').then((m) => ({ default: m.AdminRoutes })));

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<CustomerLayout />}>
              <Route index element={<DiscoveryPage />} />
              <Route path="b/:businessId/:branchId" element={<BusinessPage />} />
              <Route path="b/:businessId" element={<BusinessPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:orderId" element={<OrderPage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="account/addresses" element={<AddressesPage />} />
              <Route path="account/notifications" element={<NotificationsPage />} />
              <Route path="account/loyalty" element={<LoyaltyPage />} />
              <Route path="signin" element={<PhoneAuthPage />} />
            </Route>
            <Route path="business/*" element={<Suspense fallback={<PageFallback />}><BusinessRoutes /></Suspense>} />
            <Route path="admin/*" element={<Suspense fallback={<PageFallback />}><AdminRoutes /></Suspense>} />
            <Route path="explore" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <ToastRegion />
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
