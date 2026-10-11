import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';

interface AnimatedCounterProps {
  value: number;
  className?: string;
  duration?: number;
}

/**
 * Flüssig zählende Monospace-Zahl für Terminzähler und Statistiken
 */
export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  className = '',
  duration = 0.5,
}) => {
  const [displayValue, setDisplayValue] = useState<number>(value);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;

    if (from === to) return;

    const controls = animate(from, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        setDisplayValue(Math.round(latest));
      },
    });

    return () => controls.stop();
  }, [value, duration]);

  return (
    <span className={`tabular-nums font-mono ${className}`}>
      {displayValue}
    </span>
  );
};
