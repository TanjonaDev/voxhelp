import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { LectureTestPage } from "./LectureTestPage.tsx";
import { LectureTestErrorBoundary } from "./LectureTestErrorBoundary.tsx";
import "./index.css";

const isLectureTest = window.location.pathname === "/lecture-test";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isLectureTest ? (
      <LectureTestErrorBoundary>
        <LectureTestPage />
      </LectureTestErrorBoundary>
    ) : (
      <App />
    )}
  </StrictMode>
);
