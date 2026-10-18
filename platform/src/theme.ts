import type { ContentRating } from '@/content/catalog';

export const colors = {
  brand: '#E23433',
  brandPressed: '#C42B2A',
  brandTint: '#FDECEC',

  background: '#F3F4F6',
  surface: '#FFFFFF',

  ink: '#14161B',
  body: '#374151',
  muted: '#6B7280',
  line: '#E5E7EB',

  success: '#15803D',
  successBg: '#E1F5E8',
  notice: '#92400E',
  noticeBg: '#FEF3C7',
} as const;

export const radii = {
  card: 22,
  control: 14,
  pill: 999,
} as const;

export const shadow = {
  shadowColor: '#0B1220',
  shadowOpacity: 0.08,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

export const ratingTheme: Record<
  ContentRating,
  { label: string; fg: string; bg: string }
> = {
  everyone: { label: 'Everyone', fg: '#166534', bg: '#E1F5E8' },
  '12+': { label: '12+', fg: '#92400E', bg: '#FEF0D2' },
  '18+': { label: '18+', fg: '#5B21B6', bg: '#EDE4FD' },
};
