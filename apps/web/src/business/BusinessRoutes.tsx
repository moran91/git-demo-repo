import { Route, Routes, Navigate } from 'react-router';
import { DashboardShell } from './shell';
import { BusinessHome } from './BusinessHome';
import { IncomingOrdersPage, OrderHistoryPage, OrderDetailPage } from './OrdersPages';
import { CatalogPage } from './CatalogPages';
import { BranchSettingsPage, NewBranchPage, BusinessProfilePage, StaffPage, LoyaltySettingsPage, CashRecordsPage, NewBusinessPage } from './SettingsPages';
import { PrintersPage } from './PrintersPage';
import { EmailSignInPage, OwnerRegisterPage, ResetPasswordPage, VerifyEmailPage, InviteAcceptPage } from './AuthPages';
import { NotFound } from '@/app/Shell';

export function BusinessRoutes() {
  return (
    <Routes>
      <Route index element={<BusinessHome />} />
      <Route path="signin" element={<EmailSignInPage />} />
      <Route path="register" element={<OwnerRegisterPage />} />
      <Route path="reset" element={<ResetPasswordPage />} />
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="invite/:id" element={<InviteAcceptPage />} />
      <Route path="new" element={<NewBusinessPage />} />
      <Route path=":businessId/_/branches/new" element={<NewBranchPage />} />
      <Route path=":businessId" element={<DashboardShell />} />
      <Route path=":businessId/:branchId" element={<DashboardShell />}>
        <Route index element={<Navigate to="orders" replace />} />
        <Route path="orders" element={<IncomingOrdersPage />} />
        <Route path="orders/:orderId" element={<OrderDetailPage />} />
        <Route path="history" element={<OrderHistoryPage />} />
        <Route path="catalog" element={<CatalogPage />} />
        <Route path="branch" element={<BranchSettingsPage />} />
        <Route path="printers" element={<PrintersPage />} />
        <Route path="cash" element={<CashRecordsPage />} />
        <Route path="loyalty" element={<LoyaltySettingsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="business" element={<BusinessProfilePage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
