import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Police des titres (Cinzel, licence OFL), hébergée avec le jeu : pas d'appel à Google Fonts (RGPD).
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/cinzel/latin-900.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
