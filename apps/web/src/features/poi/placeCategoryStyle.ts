/**
 * Maps a normalized POI category (code / id / name) to a soft, tasteful avatar
 * style for sidebar list rows. Presentation only — no data or map logic.
 *
 * Color comes from the normalized category, never from the individual place, so
 * the same category always renders the same soft color. Tokens stay subtle
 * (light bg-*-50 background, darker text-*-700 label, light border-*-100) to
 * match the colored search result avatars.
 */

export type PlaceCategoryStyle = {
  /** Tailwind classes for the avatar surface: background, text, and border. */
  readonly className: string;
  /** Single-character label shown inside the avatar. */
  readonly initial: string;
};

type CategoryGroup = {
  readonly className: string;
  readonly keywords: readonly string[];
};

/**
 * Ordered keyword groups. The first group whose keyword is found in the
 * normalized category key wins, so more specific groups should precede broader
 * ones where keywords could overlap.
 */
const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    // religion
    className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    keywords: [
      'religion',
      'pagoda',
      'monastery',
      'temple',
      'church',
      'mosque',
      'shrine',
      'worship',
    ],
  },
  {
    // hotel / lodging
    className: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    keywords: ['hotel', 'lodging', 'motel', 'guesthouse', 'guest_house', 'hostel', 'resort'],
  },
  {
    // health / hospital / pharmacy
    className: 'bg-red-50 text-red-700 border-red-100',
    keywords: ['health', 'hospital', 'clinic', 'pharmacy', 'medical', 'dental', 'dentist'],
  },
  {
    // food / cafe / restaurant
    className: 'bg-amber-50 text-amber-700 border-amber-100',
    keywords: ['food', 'restaurant', 'cafe', 'teashop', 'tea_shop', 'bar', 'bakery', 'eat'],
  },
  {
    // education / school
    className: 'bg-violet-50 text-violet-800 border-violet-100',
    keywords: ['education', 'school', 'university', 'college', 'library', 'kindergarten'],
  },
  {
    // shopping
    className: 'bg-rose-50 text-rose-700 border-rose-100',
    keywords: ['shopping', 'market', 'mall', 'supermarket', 'store', 'shop', 'convenience', 'retail'],
  },
  {
    // transport / bus / terminal
    className: 'bg-sky-50 text-sky-700 border-sky-100',
    keywords: [
      'transport',
      'bus',
      'terminal',
      'station',
      'train',
      'ferry',
      'fuel',
      'taxi',
      'airport',
    ],
  },
  {
    // service / facility
    className: 'bg-slate-100 text-slate-700 border-slate-200',
    keywords: [
      'service',
      'facility',
      'office',
      'police',
      'post',
      'government',
      'bank',
      'atm',
      'finance',
      'community',
      'charity',
    ],
  },
];

const DEFAULT_STYLE = 'bg-map-primary-soft text-map-primary border-map-primary/15';

/** Returns the soft avatar style for a place's normalized category. */
export function getPlaceCategoryStyle(
  category?: string | null,
  categoryName?: string | null,
  categoryCode?: string | null,
): PlaceCategoryStyle {
  const source = categoryCode ?? category ?? categoryName ?? '';
  const key = source.toLowerCase();
  const className =
    CATEGORY_GROUPS.find((group) => group.keywords.some((keyword) => key.includes(keyword)))
      ?.className ?? DEFAULT_STYLE;

  const label = categoryName ?? categoryCode ?? category ?? '';
  const trimmed = label.trim();
  const initial = trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : 'P';

  return { className, initial };
}
