import { LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiFetch, APIRequestError, setCSRFToken } from "../../lib/api";
import styles from "../admin/Admin.module.css";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiFetch("/api/admin/login", {
        body: JSON.stringify({ email, password }),
        method: "POST",
      });
      const csrf = await apiFetch<{ csrf_token: string }>("/api/admin/csrf");
      setCSRFToken(csrf.csrf_token);
      navigate("/admin/profile");
    } catch (caught) {
      setError(caught instanceof APIRequestError ? caught.message : "Login failed");
    }
  }

  return (
    <main className={styles.main}>
      <form className={`${styles.panel} ${styles.stack}`} onSubmit={onSubmit}>
        <h1>Admin sign in</h1>
        {error ? <p className={styles.message}>{error}</p> : null}
        <div className={styles.field}>
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        <button className={`${styles.button} ${styles.primary}`} type="submit">
          <LogIn aria-hidden="true" size={18} />
          Sign in
        </button>
      </form>
    </main>
  );
}
