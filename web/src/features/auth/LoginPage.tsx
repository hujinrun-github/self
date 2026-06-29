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
      setError(caught instanceof APIRequestError ? caught.message : "登录失败");
    }
  }

  return (
    <main className={styles.authShell} data-testid="admin-login-shell">
      <section className={styles.authIntro}>
        <span className={styles.authBadge}>中文主语言后台</span>
        <h1 className={styles.authTitle}>用中文维护主内容，再把英日版本作为辅助语言有序发布。</h1>
        <p className={styles.authDescription}>
          后台以中文主表为准，英文和日文通过辅助语言流程生成、编辑与审核，确保线上每个页面都可控可发布。
        </p>
        <div className={styles.authFeatures}>
          <div className={styles.authFeature}>
            <strong>资料与首页</strong>
            <span>统一维护中文主叙事、联系方式与首页模块展示。</span>
          </div>
          <div className={styles.authFeature}>
            <strong>辅助语言发布</strong>
            <span>先生成英日草稿，再审核后决定是否公开对应语言页面。</span>
          </div>
          <div className={styles.authFeature}>
            <strong>媒体素材库</strong>
            <span>图片素材一次上传，项目、写作和资料页都能复用。</span>
          </div>
        </div>
      </section>
      <form className={`${styles.panel} ${styles.stack} ${styles.authCard}`} data-testid="admin-login-card" onSubmit={onSubmit}>
        <div className={styles.authCardHeader}>
          <span className={styles.brandBadge}>内容管理台</span>
          <h2>后台登录</h2>
          <p>使用管理员账号进入中文主语言工作区。</p>
        </div>
        {error ? <p className={styles.message}>{error}</p> : null}
        <div className={styles.field}>
          <label htmlFor="admin-email">邮箱</label>
          <input
            id="admin-email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="admin-password">密码</label>
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
          登录
        </button>
      </form>
    </main>
  );
}
