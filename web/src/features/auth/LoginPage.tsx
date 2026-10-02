import { ArrowLeft, Eye, EyeOff, FileText, Image, Languages, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { apiFetch, APIRequestError, setCSRFToken } from "../../lib/api";
import styles from "../admin/Admin.module.css";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
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
      setError(caught instanceof APIRequestError ? caught.message : "登录失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.authShell} data-testid="admin-login-shell">
      <section className={styles.authIntro}>
        <Link className={styles.authBrand} to="/zh">
          <span aria-hidden="true" className={styles.brandMark}>研</span>
          <span>作品集</span>
        </Link>
        <h1 className={styles.authTitle}>
          <span>让每一次创作，</span>
          <span>都有清晰的记录。</span>
        </h1>
        <p className={styles.authDescription}>
          在这里整理作品、打磨文章，更新关于你的每一个细节。
        </p>
        <div className={styles.authFeatures}>
          <div className={styles.authFeature}>
            <FileText aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>作品与写作</strong>
            <span>留住实践中的思考，让作品和文章有序呈现。</span>
          </div>
          <div className={styles.authFeature}>
            <Languages aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>多语言表达</strong>
            <span>细心校对英文与日文版本，与更多读者交流。</span>
          </div>
          <div className={styles.authFeature}>
            <Image aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>资料与素材</strong>
            <span>管理个人介绍与图片，让每个页面保持一致。</span>
          </div>
        </div>
      </section>
      <form aria-busy={isSubmitting} className={`${styles.panel} ${styles.stack} ${styles.authCard}`} data-testid="admin-login-card" onSubmit={onSubmit}>
        <div className={styles.authCardHeader}>
          <span className={styles.brandBadge}>内容管理台</span>
          <h2>后台登录</h2>
          <p>欢迎回来，继续你的创作。</p>
        </div>
        {error ? (
          <p aria-live="polite" className={styles.message}>
            {error}
          </p>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="admin-email">邮箱</label>
          <input
            autoComplete="email"
            id="admin-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="admin-password">密码</label>
          <div className={styles.passwordInputWrap}>
            <input
              autoComplete="current-password"
              id="admin-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type={isPasswordVisible ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={isPasswordVisible ? "隐藏密码" : "显示密码"}
              aria-pressed={isPasswordVisible}
              className={styles.passwordToggle}
              onClick={() => setIsPasswordVisible((current) => !current)}
              title={isPasswordVisible ? "隐藏密码" : "显示密码"}
              type="button"
            >
              {isPasswordVisible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
            </button>
          </div>
        </div>
        <button className={`${styles.button} ${styles.primary}`} disabled={isSubmitting} type="submit">
          <LogIn aria-hidden="true" size={18} />
          {isSubmitting ? "正在登录…" : "登录"}
        </button>
        <Link className={styles.authBackLink} to="/zh">
          <ArrowLeft aria-hidden="true" size={16} />
          返回前台
        </Link>
      </form>
    </main>
  );
}
