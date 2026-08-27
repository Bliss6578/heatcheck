import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import OperationsApp from "./pages/OperationsApp";
import { CompanyPage, IntelligencePage, PlatformPage, SolutionsPage } from "./pages/PublicDetail";

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/platform"} component={PlatformPage} />
      <Route path={"/intelligence"} component={IntelligencePage} />
      <Route path={"/solutions"} component={SolutionsPage} />
      <Route path={"/company"} component={CompanyPage} />
      <Route path={"/app"} component={OperationsApp} />
      <Route path={"/app/locations"} component={OperationsApp} />
      <Route path={"/app/incidents"} component={OperationsApp} />
      <Route path={"/app/actions"} component={OperationsApp} />
      <Route path={"/app/settings"} component={OperationsApp} />
      <Route path={"/app/agent-runs/:runId"} component={OperationsApp} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
