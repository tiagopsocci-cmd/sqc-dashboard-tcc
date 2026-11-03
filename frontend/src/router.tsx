import { EngenhariaPage } from "@/pages/sqc/EngenhariaPage";
import { ImportPage } from "@/pages/sqc/ImportPage";
import { InstrumentsPage } from "@/pages/sqc/InstrumentsPage";
import { SQCDashboard } from "@/pages/sqc/SQCDashboard";
import {
  Link,
  Navigate,
  Outlet,
  RootRoute,
  Route,
  Router,
  type RouterHistory,
  RouterProvider,
  createBrowserHistory,
  useRouterState,
} from "@tanstack/react-router";
import {
  Activity,
  ChartNoAxesCombined,
  DraftingCompass,
  Gauge,
  Menu,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";

const defaultDashboardSearch = {
  mode: "single" as const,
  part: null,
  batch: null,
  batches: null,
  dim: null,
  tab: null,
  cavity: null,
};

const navItems = [
  { to: "/sqc", label: "Painel SQC", icon: ChartNoAxesCombined },
  { to: "/sqc/import", label: "Importação", icon: Upload },
  { to: "/sqc/engenharia", label: "Engenharia", icon: DraftingCompass },
  { to: "/sqc/instruments", label: "Instrumentos", icon: Gauge },
] as const;

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (pathname === "/") return <Navigate to="/sqc" search={defaultDashboardSearch} replace />;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
          <Link
            to="/sqc"
            search={defaultDashboardSearch}
            className="flex min-w-0 items-center gap-3"
            onClick={() => setMenuOpen(false)}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-800 text-white">
              <Activity className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900 sm:text-base">
                Painel de Controle Estatístico da Qualidade
              </span>
              <span className="hidden text-xs text-slate-500 sm:block">Análise e gestão SQC</span>
            </span>
          </Link>

          <nav
            className="ml-auto hidden items-center gap-1 lg:flex"
            aria-label="Navegação principal"
          >
            {navItems.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: true }}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 [&.active]:bg-slate-800 [&.active]:text-white"
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            className="ml-auto grid size-10 place-items-center rounded-md border border-slate-200 text-slate-700 lg:hidden"
            aria-label={menuOpen ? "Fechar navegação" : "Abrir navegação"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {menuOpen && (
          <nav
            className="border-t border-slate-100 bg-white p-3 lg:hidden"
            aria-label="Navegação móvel"
          >
            <div className="mx-auto grid max-w-screen-2xl gap-1">
              {navItems.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: true }}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 [&.active]:bg-slate-800 [&.active]:text-white"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main id="conteudo-principal">
        <Outlet />
      </main>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Página não encontrada
      </p>
      <h1 className="mt-2 text-2xl font-bold">A rota informada não existe.</h1>
      <Link
        to="/sqc"
        search={defaultDashboardSearch}
        className="mt-6 inline-flex rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Voltar ao painel SQC
      </Link>
    </div>
  );
}

const rootRoute = new RootRoute({ component: AppShell, notFoundComponent: NotFoundPage });

const dashboardRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sqc",
  component: SQCDashboard,
  validateSearch: (search: Record<string, unknown>) => ({
    mode: search.mode === "multi" ? ("multi" as const) : ("single" as const),
    part: typeof search.part === "string" && search.part ? search.part : null,
    batch: typeof search.batch === "string" && search.batch ? search.batch : null,
    batches: typeof search.batches === "string" && search.batches ? search.batches : null,
    dim: typeof search.dim === "string" && search.dim ? search.dim : null,
    tab: typeof search.tab === "string" && search.tab ? search.tab : null,
    cavity:
      search.cavity !== undefined &&
      search.cavity !== null &&
      Number.isFinite(Number(search.cavity))
        ? Number(search.cavity)
        : null,
  }),
});

const importRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sqc/import",
  component: ImportPage,
});

const engineeringRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sqc/engenharia",
  component: EngenhariaPage,
});

const instrumentsRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/sqc/instruments",
  component: InstrumentsPage,
});

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  importRoute,
  engineeringRoute,
  instrumentsRoute,
]);

export function createAppRouter(history?: RouterHistory) {
  return new Router({
    routeTree,
    history,
    defaultPreload: "intent",
  });
}

export const router = createAppRouter(createBrowserHistory());

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return <RouterProvider router={router} />;
}
