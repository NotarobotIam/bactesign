'use client';
import type { PlateReading } from '../lib/zone-reader';

// Draws automatically detected discs and inhibition zones over a plate photo.
// Sits absolutely on top of the <img>; coordinates are fractions of the image.
export default function ZoneOverlay({ reading, selected, onSelect, animate = true, compact = false, labels = true }: {
  reading: PlateReading; selected?: number | null; onSelect?: (i: number) => void; animate?: boolean; compact?: boolean; labels?: boolean;
}) {
  const W = 1000, H = (1000 * reading.height) / reading.width;
  const font = compact ? 30 : 24;
  return (
    <svg className={'zone-overlay' + (animate ? ' animate' : '')} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`${reading.zones.length} detected zones`}>
      {reading.zones.map((z, i) => {
        const cx = z.x * W, cy = z.y * H, rz = z.zoneRadius * W, rd = z.discRadius * W;
        const review = z.confidence === 'low';
        const cls = 'zo ' + (z.noZone ? 'nozone' : review ? 'review' : 'ok') + (selected === i ? ' selected' : '');
        const label = (z.noZone ? 'No zone' : `${z.diameterMm.toFixed(1)} mm`) + (review && !compact ? ' · review' : '');
        const lw = label.length * font * 0.56 + 16, lx = Math.min(W - lw - 4, cx + rd * 0.9), ly = Math.max(font + 6, cy - rd * 1.1);
        return (
          <g key={i} className={cls} style={{ animationDelay: `${i * 90}ms` }} onClick={onSelect ? e => { e.stopPropagation(); onSelect(i); } : undefined}>
            <circle className="zo-hit" cx={cx} cy={cy} r={Math.max(rz, rd * 1.6)} />
            {!z.noZone && <circle className="zo-zone" cx={cx} cy={cy} r={rz} pathLength={100} />}
            <circle className="zo-disc" cx={cx} cy={cy} r={rd} />
            {!z.noZone && <line className="zo-dia" x1={cx - rz} y1={cy} x2={cx + rz} y2={cy} />}
            {labels && <g className="zo-label">
              <rect x={lx} y={ly - font} width={lw} height={font + 10} rx={6} />
              <text x={lx + 8} y={ly - 2} fontSize={font}>{label}</text>
            </g>}
          </g>
        );
      })}
    </svg>
  );
}
