import { cn } from '@/lib/utils';

type Kind = 'ok' | 'warn' | 'err';

type BrandColors = {
  ok?: string;
  warn?: string;
  err?: string;
};

const KIND_CLASSES: Record<Kind, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500 animate-pulse-dot',
  err: 'bg-red-500',
};

export function ConnectionDot({ kind, brand }: { kind: Kind; brand?: BrandColors }) {
  const brandColor = brand?.[kind];

  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        !brandColor && KIND_CLASSES[kind],
      )}
      style={brandColor ? { backgroundColor: brandColor } : undefined}
      aria-hidden="true"
    />
  );
}
