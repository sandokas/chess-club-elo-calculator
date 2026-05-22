import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { ThemeProvider } from "./components/layout/theme-provider.js";
import { ClubProvider } from "./contexts/club-context.js";
import { AuthProvider } from "./contexts/auth-context.js";
import { queryClient } from "./lib/query-client.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" defaultColorPalette="emerald">
        <BrowserRouter>
          <AuthProvider>
            <ClubProvider>
              <App />
            </ClubProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
