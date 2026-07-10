import type { LanguageMode } from '@local-map/localized-name';

export type PublicSearchApiLang = 'my' | 'en' | 'und';

/** Map UI language mode to the public search API `lang` query parameter. */
export function publicSearchApiLang(languageMode: LanguageMode): PublicSearchApiLang {
  if (languageMode === 'en') {
    return 'en';
  }
  if (languageMode === 'both') {
    return 'und';
  }
  return 'my';
}
