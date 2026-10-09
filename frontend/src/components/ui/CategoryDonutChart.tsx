import React, { useState } from 'react';
import type { CategoryExpense } from '../../types';

interface Props {
  expenses: CategoryExpense[];
  size?: number;
}

/**
 * Category colours come from the theme contract, so slices stay legible
 * on `--bg-surface` in both dark and light mode.
 */
const PALETTE = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  'var(--gold)',
  'var(--info)',
  'var(--danger)',
  'var(--accent-strong)',
  'var(--text-muted)',
];

export const CategoryDonutChart: React.FC<Props> = ({ expenses = [], size = 220 }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = expenses.reduce((acc, curr) => acc + (curr.total || 0), 0) || 1;
  const radius = size * 0.38;
  const strokeWidth = size * 0.14;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const fractions = expenses.map((item) => (item.total || 0) / total);
  const arcBefore = (index: number) =>
    fractions.slice(0, index).reduce((sum, fraction) => sum + fraction, 0) * circumference;

  const slices = expenses.map((item, idx) => {
    const fraction = fractions[idx];
    return {
      ...item,
      color: PALETTE[idx % PALETTE.length],
      fraction,
      strokeDasharray: `${fraction * circumference} ${circumference}`,
      strokeDashoffset: -arcBefore(idx),
      pct: Math.round(fraction * 100),
    };
  });

  const activeItem = hoveredIdx !== null ? slices[hoveredIdx] : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Background track */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            style={{ stroke: 'var(--border)' }}
            strokeWidth={strokeWidth}
          />

          {/* The stroke colour is set through CSS so var() resolves */}
          {slices.map((slice, idx) => (
            <circle
              key={`${slice.category}-${idx}`}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              strokeWidth={hoveredIdx === idx ? strokeWidth + 4 : strokeWidth}
              strokeDasharray={slice.strokeDasharray}
              strokeDashoffset={slice.strokeDashoffset}
              strokeLinecap="round"
              style={{
                stroke: slice.color,
                transition: 'stroke-width 0.25s ease, opacity 0.25s ease',
                cursor: 'pointer',
                opacity: hoveredIdx === null || hoveredIdx === idx ? 1 : 0.45,
              }}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
        </svg>

        {/* Center label */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
            padding: '0 12%',
          }}
        >
          {activeItem ? (
            <>
              <span
                style={{
                  fontSize: 11,
                  color: activeItem.color,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                {activeItem.category}
              </span>
              <span className="tnum" style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
                {activeItem.total.toLocaleString('ru-RU')} ₽
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{activeItem.pct}% расходов</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Всего расходов</span>
              <span className="tnum" style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                {total.toLocaleString('ru-RU')} ₽
              </span>
              <span style={{ fontSize: 10, color: 'var(--accent-text)' }}>
                {expenses.length} категорий
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          justifyContent: 'center',
          marginTop: 16,
          maxWidth: 360,
        }}
      >
        {slices.slice(0, 6).map((item, idx) => (
          <div
            key={`${item.category}-${idx}`}
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: hoveredIdx === idx ? 'var(--bg-hover)' : 'var(--bg-subtle)',
              padding: '4px 10px',
              borderRadius: 999,
              cursor: 'pointer',
              fontSize: 11,
              border: `1px solid ${hoveredIdx === idx ? item.color : 'var(--border)'}`,
              transition: 'background 0.2s ease, border-color 0.2s ease',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: item.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: 'var(--text-primary)' }}>{item.category}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{item.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
