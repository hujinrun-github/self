import { createBrowserRouter, Navigate } from "react-router-dom";

import { AdminLayout } from "../features/admin/AdminLayout";
import { ContentEditPage } from "../features/admin/ContentEditPage";
import { ContentListPage } from "../features/admin/ContentListPage";
import { MediaPage } from "../features/admin/MediaPage";
import { ProfilePage } from "../features/admin/ProfilePage";
import { LoginPage } from "../features/auth/LoginPage";
import { HomePage } from "../features/public/HomePage";
import { ProjectDetailPage } from "../features/public/ProjectDetailPage";
import { PublicLayout } from "../features/public/PublicLayout";
import { PublicListPage } from "../features/public/PublicListPage";
import { TalkDetailPage } from "../features/public/TalkDetailPage";
import { WritingDetailPage } from "../features/public/WritingDetailPage";

export const router = createBrowserRouter([
  { element: <HomePage />, path: "/" },
  {
    element: (
      <PublicLayout>
        <section className="section">
          <h1>Bio</h1>
          <p className="lede">Profile, background, and current focus.</p>
        </section>
      </PublicLayout>
    ),
    path: "/bio",
  },
  { element: <PublicListPage resource="talks" />, path: "/talks" },
  { element: <TalkDetailPage />, path: "/talks/:slug" },
  { element: <PublicListPage resource="writing" />, path: "/writing" },
  { element: <WritingDetailPage />, path: "/writing/:slug" },
  { element: <PublicListPage resource="projects" />, path: "/projects" },
  { element: <ProjectDetailPage />, path: "/projects/:slug" },
  {
    element: (
      <PublicLayout>
        <section className="section">
          <h1>Contact</h1>
          <p className="lede">Email and social links.</p>
        </section>
      </PublicLayout>
    ),
    path: "/contact",
  },
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
