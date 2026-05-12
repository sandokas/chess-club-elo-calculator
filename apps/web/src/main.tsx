import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { ThemeProvider } from "./components/layout/theme-provider.js";
import { ClubProvider } from "./contexts/club-context.js";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="light" defaultColorPalette="emerald">
      <BrowserRouter>
        <ClubProvider>
          <App />
        </ClubProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
