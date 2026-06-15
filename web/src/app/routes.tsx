import { createBrowserRouter, Navigate } from "react-router-dom";

import { AdminLayout } from "../features/admin/AdminLayout";
import { ContentEditPage } from "../features/admin/ContentEditPage";
import { ContentListPage } from "../features/admin/ContentListPage";
import { MediaPage } from "../features/admin/MediaPage";
import { ProfilePage } from "../features/admin/ProfilePage";
import { LoginPage } from "../features/auth/LoginPage";

function PublicPlaceholder() {
  return (
    <main className="app-shell">
      <section className="section">
        <h1>Portfolio</h1>
        <p className="lede">Profile, writing, talks, projects, and contact.</p>
      </section>
    </main>
  );
}

export const router = createBrowserRouter([
  { element: <PublicPlaceholder />, path: "/" },
  { element: <LoginPage />, path: "/admin/login" },
  {
    element: <AdminLayout />,
    path: "/admin",
    children: [
      { element: <Navigate replace to="/admin/profile" />, index: true },
      { element: <ProfilePage />, path: "profile" },
      { element: <ContentListPage resource="experience" />, path: "experience" },
      { element: <ContentListPage resource="talks" />, path: "talks" },
      { element: <ContentListPage resource="writing" />, path: "writing" },
      { element: <ContentListPage resource="projects" />, path: "projects" },
      { element: <ContentEditPage resource="experience" />, path: "experience/new" },
      { element: <ContentEditPage resource="talks" />, path: "talks/new" },
      { element: <ContentEditPage resource="writing" />, path: "writing/new" },
      { element: <ContentEditPage resource="projects" />, path: "projects/new" },
      { element: <ContentEditPage resource="preview" />, path: "preview/:resource/:id" },
      { element: <MediaPage />, path: "media" },
    ],
  },
]);
