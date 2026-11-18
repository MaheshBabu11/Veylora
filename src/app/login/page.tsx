"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, LoaderCircle, LockKeyhole } from "lucide-react";
import { fetchJson, useSession } from "@/services/library";
import styles from "./login.module.css";

type Mode = "login" | "register";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: user, isPending } = useSession();

  useEffect(() => {
    if (user) router.replace("/");
  }, [router, user]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await fetchJson("/api/auth/" + (mode === "register" ? "register" : "login"), {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      queryClient.clear();
      window.location.replace("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in.");
      setBusy(false);
    }
  };

  if (isPending || user) {
    return <main className={styles.page}><div className={styles.loading}><LoaderCircle size={20} /> Checking your session…</div></main>;
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}><span><BookOpen size={19} /></span><strong>veylora<span>.</span></strong></div>
        <p className={styles.eyebrow}>YOUR STORIES, CLOSE AT HAND</p>
        <h1>{mode === "register" ? "Make this space yours." : "Welcome back."}</h1>
        <p className={styles.description}>
          {mode === "register"
            ? "Create an account to keep your reading progress and preferences private."
            : "Sign in to pick up where you left off."}
        </p>
        <div className={styles.switch} role="tablist" aria-label="Account action">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? styles.selected : ""} onClick={() => { setMode("login"); setMessage(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? styles.selected : ""} onClick={() => { setMode("register"); setMessage(""); }}>Create account</button>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={mode === "register" ? 3 : 1}
            maxLength={32}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Your username"
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={mode === "register" ? 8 : 1}
            maxLength={128}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
          />
          {message && <p className={styles.error} role="alert">{message}</p>}
          <button className={styles.submit} type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={16} className={styles.spinner} /> : <LockKeyhole size={16} />}
            {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className={styles.privacy}>Your account and reading data stay in this Veylora database.</p>
      </section>
    </main>
  );
}
