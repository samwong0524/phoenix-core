import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const locales = ['zh', 'en'];
const defaultLocale = 'en';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Check if the path already has a locale
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameHasLocale) return;

  // 2. Ignore /demo, static files, and internal paths
  if (
    pathname.startsWith('/demo') ||
    pathname.includes('.') ||
    pathname.startsWith('/_next')
  ) {
    return;
  }

  // 3. Determine locale
  let locale = defaultLocale;
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  
  if (cookieLocale && locales.includes(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = request.headers.get('accept-language');
    if (acceptLanguage && acceptLanguage.toLowerCase().includes('zh')) {
      locale = 'zh';
    }
  }

  // 4. Redirect
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Skip all internal paths (_next)
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};