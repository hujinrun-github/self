import { createBrowserRouter, Navigate, Outlet, redirect, useParams, type LoaderFunctionArgs } from "react-router-dom";

import { AdminLayout } from "../features/admin/AdminLayout";
import { ContentEditPage } from "../features/admin/ContentEditPage";
import { ContentListPage } from "../features/admin/ContentListPage";
import { MediaPage } from "../features/admin/MediaPage";
import { ProfilePage } from "../features/admin/ProfilePage";
import { LoginPage } from "../features/auth/LoginPage";
import { HomePage } from "../features/public/HomePage";
import { BioPage, ContactPage } from "../features/public/ProfilePages";
import { ProjectDetailPage } from "../features/public/ProjectDetailPage";
import { PublicListPage } from "../features/public/PublicListPage";
import { isSupportedLocale } from "../features/public/locale";
import { WritingDetailPage } from "../features/public/WritingDetailPage";

export const publicRoutes = [
  { element: <Navigate replace to="/zh" />, path: "/" },
  { element: <Navigate replace to="/zh/bio" />, path: "/bio" },
  { element: <Navigate replace to="/zh" />, path: "/talks" },
  { element: <Navigate replace to="/zh" />, path: "/talks/:slug" },
  { element: <Navigate replace to="/zh/writing" />, path: "/writing" },
  { element: <LegacySlugRedirect resource="writing" />, path: "/writing/:slug" },
  { element: <Navigate replace to="/zh/projects" />, path: "/projects" },
  { element: <LegacySlugRedirect resource="projects" />, path: "/projects/:slug" },
  { element: <Navigate replace to="/zh/contact" />, path: "/contact" },
  {
    element: <Outlet />,
    loader: localeLoader,
    path: "/:locale",
    children: [
      { element: <HomePage />, index: true },
      { element: <BioPage />, path: "bio" },
      { element: <LocaleHomeRedirect />, path: "talks" },
      { element: <LocaleHomeRedirect />, path: "talks/:slug" },
      { element: <PublicListPage resource="writing" />, path: "writing" },
      { element: <WritingDetailPage />, path: "writing/:slug" },
      { element: <PublicListPage resource="projects" />, path: "projects" },
      { element: <ProjectDetailPage />, path: "projects/:slug" },
      { element: <ContactPage />, path: "contact" },
    ],
  },
];

export const routes = [
  ...publicRoutes,
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
      { element: <ContentEditPage resource="experience" />, path: "experience/:id" },
      { element: <ContentEditPage resource="talks" />, path: "talks/new" },
      { element: <ContentEditPage resource="talks" />, path: "talks/:id" },
      { element: <ContentEditPage resource="writing" />, path: "writing/new" },
      { element: <ContentEditPage resource="writing" />, path: "writing/:id" },
      { element: <ContentEditPage resource="projects" />, path: "projects/new" },
      { element: <ContentEditPage resource="projects" />, path: "projects/:id" },
      { element: <ContentEditPage resource="preview" />, path: "preview/:resource/:id" },
      { element: <MediaPage />, path: "media" },
    ],
  },
];

export const router = createBrowserRouter(routes);

function LegacySlugRedirect({ resource }: { resource: "projects" | "writing" }) {
  const { slug = "" } = useParams();
  return <Navigate replace to={`/zh/${resource}/${slug}`} />;
}

function LocaleHomeRedirect() {
  const { locale = "zh" } = useParams();
  return <Navigate replace to={`/${locale}`} />;
}

function localeLoader({ params, request }: LoaderFunctionArgs) {
  if (isSupportedLocale(params.locale)) {
    return null;
  }
  const url = new URL(request.url);
  const remainder = url.pathname.replace(/^\/[^/]+/, "");
  throw redirect(`/zh${remainder || ""}${url.search}${url.hash}`);
}
