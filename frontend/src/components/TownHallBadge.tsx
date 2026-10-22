import React from 'react';

interface TownHallBadgeProps {
  level?: number;
  size?: number;
  fontSize?: string;
  style?: React.CSSProperties;
  className?: string;
}

export const TownHallBadge: React.FC<TownHallBadgeProps> = ({
  level,
  size = 26,
  fontSize,
  style,
  className = '',
}) => {
  if (!level && level !== 0) {
    return (
      <span className={`th-badge ${className}`} style={{ fontSize, ...style }}>
        TH?
      </span>
    );
  }

  const localSrc = `/assets/townhalls/level_${level}.webp`;
  const remoteSrc = `https://raw.githubusercontent.com/ClashKingInc/ClashKingAssets/main/assets/buildings/home-village/town_hall/level_${level}.webp`;

  return (
    <span
      className={`th-badge ${className}`}
      style={{
        gap: '6px',
        padding: '3px 8px 3px 6px',
        fontSize,
        ...style,
      }}
      title={`Town Hall Level ${level}`}
    >
      <img
        src={localSrc}
        alt={`TH${level}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'contain',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))',
        }}
        onError={(e) => {
          const target = e.currentTarget;
          if (target.src !== remoteSrc) {
            target.src = remoteSrc;
          } else {
            target.style.display = 'none';
          }
        }}
      />
      <span>TH{level}</span>
    </span>
  );
};

export default TownHallBadge;
