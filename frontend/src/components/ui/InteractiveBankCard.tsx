import React from 'react';
import { WifiOutlined } from '@ant-design/icons';
import { PROFILE_LABELS } from '../../types';
import type { Role } from '../../types';

interface Props {
  role: Role;
  balance: number;
  cardNumber?: string;
  cardType?: string;
  holderName: string;
}

/** Fallback for a card whose number is not available yet. */
const MASKED_NUMBER = '•••• ••••';

/**
 * A card is an object, not a widget: it keeps the physical proportions and the
 * gold chip, and it does not tilt, glow or spin. The badge names the product.
 */
export const InteractiveBankCard: React.FC<Props> = ({
  role,
  balance,
  cardNumber,
  cardType,
  holderName,
}) => {
  const badgeText = cardType || PROFILE_LABELS[role];

  return (
    <div
      style={{
        background: 'var(--accent-strong)',
        borderRadius: 'var(--radius)',
        padding: 24,
        color: 'var(--text-on-accent)',
        border: '1px solid var(--accent)',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 220,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        maxWidth: 380,
      }}
    >
      {/* Top row: bank mark, card product, contactless */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '0.08em',
              color: 'var(--text-on-accent)',
              whiteSpace: 'nowrap',
              flex: '0 0 auto',
            }}
          >
            СЕМЕЙНЫЙ БАНК
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              border: '1px solid var(--border-strong)',
              color: 'var(--text-on-accent)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {badgeText}
          </span>
        </div>
        <WifiOutlined
          style={{ fontSize: 18, color: 'var(--text-on-accent)', transform: 'rotate(90deg)', flexShrink: 0 }}
        />
      </div>

      {/* Chip and balance */}
      <div style={{ margin: '14px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 38,
            height: 28,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--gold)',
            border: '1px solid var(--border-strong)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 22,
              height: 14,
              border: '1px solid var(--text-primary)',
              opacity: 0.35,
              borderRadius: 'var(--radius-sm)',
            }}
          />
        </div>

        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-on-accent)',
              opacity: 0.78,
              display: 'block',
            }}
          >
            Баланс
          </span>
          <span className="tnum" style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-on-accent)' }}>
            {(balance || 0).toLocaleString('ru-RU')} ₽
          </span>
        </div>
      </div>

      {/* Bottom row: number, holder, payment system */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginTop: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 15, letterSpacing: '0.14em', color: 'var(--text-on-accent)' }}>
            {cardNumber || MASKED_NUMBER}
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              marginTop: 4,
              textTransform: 'uppercase',
              color: 'var(--text-on-accent)',
              opacity: 0.9,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {holderName}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-on-accent)' }}>
            МИР
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-on-accent)', opacity: 0.7 }}>PAY</div>
        </div>
      </div>
    </div>
  );
};
