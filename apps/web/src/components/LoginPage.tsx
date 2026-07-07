import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { VHMark } from "./ui.js";

function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

const inputStyle: CSSProperties = {
  all: "unset" as "unset",
  fontSize: 13,
  color: "var(--text)",
  background: "var(--card-hi)",
  borderRadius: 9,
  padding: "10px 12px",
  boxShadow: "0 0 0 1px var(--stroke) inset",
  fontFamily: "var(--font)",
};

export function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleGoogle = async () => {
    setError(null);
    await signInWithGoogle();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: authError } =
        mode === "signin"
          ? await signInWithEmail(email, password)
          : await signUpWithEmail(email, password, fullName);
      if (authError) setError(authError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 380, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <VHMark size={48} glow />
          </div>
          <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
            VoxHelp
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-3)" }}>
            Copilote d'entretien technique en temps réel
          </p>
        </div>

        <div
          style={{
            borderRadius: 18,
            padding: 20,
            background: "var(--card)",
            boxShadow: "0 0 0 1px var(--stroke) inset, var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={handleGoogle}
            style={{
              all: "unset" as "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              padding: "10px 14px",
              borderRadius: 11,
              background: "var(--card-hi)",
              boxShadow: "0 0 0 1px var(--stroke-2) inset",
              color: "var(--text)",
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: "var(--font)",
            }}
          >
            <GoogleMark />
            Continuer avec Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--stroke)" }} />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>ou</span>
            <div style={{ flex: 1, height: 1, background: "var(--stroke)" }} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {mode === "signup" && (
              <input
                type="text"
                placeholder="Nom complet"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={inputStyle}
                required
              />
            )}
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              required
            />
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              required
              minLength={6}
            />

            {error && <p style={{ margin: 0, fontSize: 12.5, color: "var(--risk)" }}>{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              style={{
                all: "unset" as "unset",
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.6 : 1,
                textAlign: "center",
                padding: "10px 14px",
                borderRadius: 11,
                background: "var(--accent)",
                color: "white",
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: "var(--font)",
              }}
            >
              {submitting ? "…" : mode === "signin" ? "Se connecter" : "Créer un compte"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            style={{
              all: "unset" as "unset",
              cursor: "pointer",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--text-3)",
              fontFamily: "var(--font)",
            }}
          >
            {mode === "signin" ? "Pas de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
}
