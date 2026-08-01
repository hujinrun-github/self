import { APIRequestError } from "../../lib/api";

export function translationActionError(error: unknown, fallback: string) {
  if (!(error instanceof APIRequestError)) {
    return fallback;
  }
  if (error.status === 503) {
    return "翻译服务未配置。线上请配置 GitHub Variable PORTFOLIO_TRANSLATION_PROVIDER=deepseek 和 Secret PORTFOLIO_TRANSLATION_API_KEY 后重新部署；本地请设置 TRANSLATION_PROVIDER 和 TRANSLATION_API_KEY 后重启。";
  }
  if (error.status === 502) {
    return "翻译服务请求失败，请检查翻译服务配置或稍后重试。";
  }
  return error.message;
}
