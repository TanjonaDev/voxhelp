import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { LectureTestPage } from "./LectureTestPage.tsx";
import { LectureTestErrorBoundary } from "./LectureTestErrorBoundary.tsx";
import { CoursPage } from "./lecture-cours/CoursPage.tsx";
import "./index.css";
import "./theme-v2.css";

const path = window.location.pathname;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {path === "/lecture-test" ? (
      <LectureTestErrorBoundary>
        <LectureTestPage />
      </LectureTestErrorBoundary>
    ) : path === "/cours" ? (
      <CoursPage />
    ) : (
      <App />
    )}
  </StrictMode>
);
