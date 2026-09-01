import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { PlaceholderPage } from "./components/PlaceholderPage";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./contexts/AuthContext";
import { LoginPage } from "./features/auth/LoginPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { UsersPage } from "./features/users/UsersPage";
import { CompaniesPage } from "./features/companies/CompaniesPage";
import { SitesPage } from "./features/sites/SitesPage";
import { SiteGroupsPage } from "./features/site-groups/SiteGroupsPage";
import { SuppliersPage } from "./features/suppliers/SuppliersPage";
import { ItemsPage } from "./features/items/ItemsPage";
import { PermissionsPage } from "./features/users/PermissionsPage";
import { createQueryClient } from "./lib/query-client";
import { NAV } from "./navigation/nav";

const queryClient = createQueryClient();

/**
 * Screens with a real implementation; everything else in NAV gets a placeholder.
 *
 * Keep this in step with `status: "ready"` in nav.ts — a route that is `ready`
 * in the nav but missing here renders the placeholder under a menu entry that
 * promises a working screen, which is the one thing the "soon" chip exists to
 * avoid.
 */
const IMPLEMENTED: Record<string, React.ComponentType> = {
  "/": DashboardPage,
  "/users": UsersPage,
  "/permissions": PermissionsPage,
  "/companies": CompaniesPage,
  "/sites": SitesPage,
  "/site-groups": SiteGroupsPage,
  "/suppliers": SuppliersPage,
  "/items": ItemsPage,
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {NAV.flatMap((section) => section.items).map((item) => {
              const Screen = IMPLEMENTED[item.to] ?? PlaceholderPage;
              return (
                <Route
                  key={item.to}
                  path={item.to}
                  element={
                    <RequireAuth>
                      <AppShell>
                        <Screen />
                      </AppShell>
                    </RequireAuth>
                  }
                />
              );
            })}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
