import { queryClient } from "@/lib/query-client";
import { AppRouter } from "@/router";
import { QueryClientProvider } from "@tanstack/react-query";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  );
}
