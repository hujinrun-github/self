export const supportedLocales = ["zh", "en", "ja"] as const;

export type Locale = (typeof supportedLocales)[number];

type PublicCopy = {
  aboutMore: string;
  bio: string;
  bioDescription: string;
  contact: string;
  contactDescription: string;
  emptyCollectionDescription: string;
  emptyCollectionTitle: string;
  emptyList: string;
  experience: string;
  home: string;
  homeDescription: string;
  menuToggle: string;
  notFound: string;
  now: string;
  nowDescription: string;
  placeholderBio: string;
  placeholderHeadline: string;
  placeholderSummary: string;
  portfolio: string;
  profileDescription: string;
  projects: string;
  stayInTouch: string;
  viewAllProjects: string;
  viewAllWriting: string;
  writing: string;
};

const publicCopy: Record<Locale, PublicCopy> = {
  zh: {
    aboutMore: "了解更多",
    bio: "简介",
    bioDescription: "这里整理了我的背景、链接与当前关注重点。",
    contact: "联系",
    contactDescription: "邮箱与社交链接。",
    emptyCollectionDescription: "内容发布后会自动出现在这里。",
    emptyCollectionTitle: "内容更新中",
    emptyList: "暂无已发布内容。",
    experience: "经历",
    home: "首页",
    homeDescription: "精选项目、写作与职业记录。",
    menuToggle: "切换导航",
    notFound: "未找到",
    now: "近况",
    nowDescription: "正在构建可靠的软件系统与清晰的产品体验。",
    placeholderBio:
      "这里会展示更完整的个人介绍、关注主题与工作方式。\n\n可以把它理解成一张持续更新的创作者名片：做过什么、在思考什么、下一步想把哪些作品打磨得更好。",
    placeholderHeadline: "构建 AI 产品、设计系统与开发者工具。",
    placeholderSummary: "专注于把清晰的信息结构、可靠的软件体验和有节奏的内容表达，放进同一个作品集中。",
    portfolio: "作品集",
    profileDescription: "个人背景、经历与当前关注重点。",
    projects: "项目",
    stayInTouch: "保持联系",
    viewAllProjects: "查看全部项目",
    viewAllWriting: "查看全部写作",
    writing: "写作",
  },
  en: {
    aboutMore: "More about me",
    bio: "Bio",
    bioDescription: "A concise profile with links, background, and current focus.",
    contact: "Contact",
    contactDescription: "Email and social links.",
    emptyCollectionDescription: "Published work will appear here automatically.",
    emptyCollectionTitle: "Updates in progress",
    emptyList: "No published entries yet.",
    experience: "Experience",
    home: "Home",
    homeDescription: "Selected work, writing, and professional notes.",
    menuToggle: "Toggle navigation",
    notFound: "Not found",
    now: "Now",
    nowDescription: "Building reliable software systems and clear product experiences.",
    placeholderBio:
      "This space is reserved for a fuller introduction, current themes, and the way the work comes together.\n\nThink of it as a living creator profile: what has been shipped, what is being explored, and what is being refined next.",
    placeholderHeadline: "I build AI products, design systems, and developer tools.",
    placeholderSummary: "The focus is on bringing structured information, dependable software, and thoughtful storytelling into one portfolio.",
    portfolio: "Portfolio",
    profileDescription: "Profile, background, and current focus.",
    projects: "Projects",
    stayInTouch: "Stay in touch",
    viewAllProjects: "View all projects",
    viewAllWriting: "View all writing",
    writing: "Writing",
  },
  ja: {
    aboutMore: "プロフィールを見る",
    bio: "紹介",
    bioDescription: "プロフィール、リンク、経歴、現在の関心をまとめています。",
    contact: "連絡先",
    contactDescription: "メールとソーシャルリンク。",
    emptyCollectionDescription: "公開された内容はここに自動で表示されます。",
    emptyCollectionTitle: "準備中です",
    emptyList: "公開済みの項目はまだありません。",
    experience: "経歴",
    home: "ホーム",
    homeDescription: "制作物、文章、そして仕事の記録。",
    menuToggle: "ナビゲーションを切り替える",
    notFound: "見つかりません",
    now: "最近",
    nowDescription: "信頼できるソフトウェアシステムと明快なプロダクト体験をつくっています。",
    placeholderBio:
      "ここには、より詳しい自己紹介や最近の関心、制作の進め方が入ります。\n\nこれまでの仕事、いま試していること、次に磨きたい作品をまとめる、更新され続けるプロフィールです。",
    placeholderHeadline: "AI プロダクト、デザインシステム、開発者向けツールをつくっています。",
    placeholderSummary: "情報設計、信頼できるソフトウェア、読みやすい発信をひとつのポートフォリオにまとめることに取り組んでいます。",
    portfolio: "ポートフォリオ",
    profileDescription: "プロフィール、経歴、そして現在の関心です。",
    projects: "プロジェクト",
    stayInTouch: "つながる",
    viewAllProjects: "すべてのプロジェクトを見る",
    viewAllWriting: "すべての文章を見る",
    writing: "文章",
  },
};

export function isSupportedLocale(value: string | undefined): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function coerceLocale(value: string | undefined): Locale {
  return isSupportedLocale(value) ? value : "zh";
}

export function publicLocaleCopy(locale: Locale) {
  return publicCopy[locale];
}

export function withLocale(locale: Locale, path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return normalized === "/" ? `/${locale}` : `/${locale}${normalized}`;
}

export function withLocaleQuery(path: string, locale: Locale) {
  const url = new URL(path, "http://localhost");
  url.searchParams.set("locale", locale);
  return `${url.pathname}${url.search}`;
}
