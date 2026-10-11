import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from "./config";

export default getRequestConfig(async () => {
  const store = await cookies();

  // 1. Check cookie
  let locale: string = store.get("locale")?.value ?? "";

  // 2. Fall back to Accept-Language header
  if (!locale || !SUPPORTED_LOCALES.includes(locale as Locale)) {
    const headersList = await headers();
    const acceptLanguage = headersList.get("accept-language") ?? "";
    if (acceptLanguage.includes("ko")) {
      locale = "ko";
    } else {
      locale = DEFAULT_LOCALE;
    }
  }

  // 3. Validate
  if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
    locale = DEFAULT_LOCALE;
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return { locale, messages };
});
