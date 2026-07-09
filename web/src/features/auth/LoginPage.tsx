import { FileText, Image, Languages, LogIn, ShieldCheck } from "lucide-react";
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
        <h1 className={styles.authTitle}>
          <span>先维护中文主内容，</span>
          <span>再有序发布英日版本。</span>
        </h1>
        <p className={styles.authDescription}>
          以中文主表为准，英日内容走生成、编辑、审核流程，发布前保留完整控制。
        </p>
        <div className={styles.authFeatures}>
          <div className={styles.authFeature}>
            <FileText aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>资料与首页</strong>
            <span>统一维护个人资料、联系方式与首页模块。</span>
          </div>
          <div className={styles.authFeature}>
            <Languages aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>辅助语言发布</strong>
            <span>生成草稿后再审核，决定是否公开对应语言页面。</span>
          </div>
          <div className={styles.authFeature}>
            <Image aria-hidden="true" className={styles.authFeatureIcon} size={20} />
            <strong>媒体素材库</strong>
            <span>图片素材一次上传，在项目、写作和资料页复用。</span>
          </div>
        </div>
      </section>
      <form className={`${styles.panel} ${styles.stack} ${styles.authCard}`} data-testid="admin-login-card" onSubmit={onSubmit}>
        <div className={styles.authCardHeader}>
          <span className={styles.brandBadge}>内容管理台</span>
          <h2>后台登录</h2>
          <p>使用管理员账号进入中文主语言工作区。</p>
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
          <input
            autoComplete="current-password"
            id="admin-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>
        <button className={`${styles.button} ${styles.primary}`} type="submit">
          <LogIn aria-hidden="true" size={18} />
          登录
        </button>
        <div className={styles.authSecurityNote}>
          <ShieldCheck aria-hidden="true" size={16} />
          <span>管理员会话验证</span>
        </div>
      </form>
    </main>
  );
}
