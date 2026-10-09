import React from 'react';
import {
  ShoppingOutlined,
  ThunderboltOutlined,
  CarOutlined,
  CoffeeOutlined,
  PlaySquareOutlined,
  LaptopOutlined,
  FireOutlined,
  SendOutlined,
  SafetyCertificateOutlined,
  ShopOutlined,
  MedicineBoxOutlined,
} from '@ant-design/icons';

interface Props {
  description?: string;
  category?: string;
  mcc?: string;
  size?: number;
}

/**
 * Every tile is painted from the theme contract: a `-soft` tint for the
 * background and the matching `-text` variant for the glyph, so the same
 * markup reads correctly in dark and light mode.
 */
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'gold' | 'neutral';

const toneColor = (tone: Tone, part: 'bg' | 'fg'): string => {
  if (tone === 'neutral') return part === 'bg' ? 'var(--bg-subtle)' : 'var(--text-muted)';
  if (tone === 'gold') return part === 'bg' ? 'var(--gold-soft)' : 'var(--gold)';
  return part === 'bg' ? `var(--${tone}-soft)` : `var(--${tone}-text)`;
};

export const MerchantIcon: React.FC<Props> = ({ description = '', category = '', mcc = '', size = 42 }) => {
  const desc = description.toLowerCase();
  const cat = category.toLowerCase();

  let tone: Tone = 'neutral';
  let Glyph = ShopOutlined;

  if (desc.includes('steam')) {
    tone = 'info';
    Glyph = PlaySquareOutlined;
  } else if (desc.includes('вкусно') || desc.includes('точка')) {
    tone = 'warning';
    Glyph = FireOutlined;
  } else if (desc.includes('додо') || desc.includes('пицца')) {
    tone = 'warning';
    Glyph = CoffeeOutlined;
  } else if (desc.includes('перекрёсток') || desc.includes('перекресток')) {
    tone = 'success';
    Glyph = ShoppingOutlined;
  } else if (desc.includes('пятёрочка') || desc.includes('пятерочка')) {
    tone = 'success';
    Glyph = ShoppingOutlined;
  } else if (desc.includes('dns') || desc.includes('днс')) {
    tone = 'accent';
    Glyph = LaptopOutlined;
  } else if (desc.includes('яндекс') || desc.includes('такси')) {
    tone = 'info';
    Glyph = CarOutlined;
  } else if (desc.includes('озон') || desc.includes('ozon')) {
    tone = 'accent';
    Glyph = ShopOutlined;
  } else if (desc.includes('мосэнергосбыт') || desc.includes('жкх') || mcc === '4900') {
    tone = 'warning';
    Glyph = ThunderboltOutlined;
  } else if (desc.includes('лукойл') || desc.includes('азс')) {
    tone = 'danger';
    Glyph = FireOutlined;
  } else if (desc.includes('discord')) {
    tone = 'info';
    Glyph = PlaySquareOutlined;
  } else if (desc.includes('аптека') || desc.includes('столички')) {
    tone = 'success';
    Glyph = MedicineBoxOutlined;
  } else if (desc.includes('сбп') || mcc === '6538' || cat.includes('сбп')) {
    tone = 'accent';
    Glyph = SendOutlined;
  } else if (desc.includes('квест') || desc.includes('бонус')) {
    tone = 'gold';
    Glyph = SafetyCertificateOutlined;
  } else if (cat.includes('фастфуд')) {
    tone = 'warning';
    Glyph = CoffeeOutlined;
  } else if (cat.includes('развлечения') || cat.includes('игры')) {
    tone = 'info';
    Glyph = PlaySquareOutlined;
  } else if (cat.includes('супермаркет')) {
    tone = 'success';
    Glyph = ShoppingOutlined;
  } else if (cat.includes('транспорт')) {
    tone = 'accent';
    Glyph = CarOutlined;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: toneColor(tone, 'bg'),
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Glyph style={{ fontSize: size * 0.48, color: toneColor(tone, 'fg') }} />
    </div>
  );
};
