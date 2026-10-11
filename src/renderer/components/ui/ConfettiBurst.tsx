import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface Particle {
  id: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  rotation: number;
  scale: number;
  color: string;
  shape: 'circle' | 'rect' | 'pill';
  delay: number;
}

const COLORS = [
  '#ef4444', // Brand Rot
  '#f59e0b', // Bernstein/Gold
  '#10b981', // Erfolg/Smaragd
  '#3b82f6', // Himmelblau
  '#8b5cf6', // Violett
  '#ec4899', // Pink
];

export const ConfettiBurst: React.FC<{ onComplete?: () => void }> = ({ onComplete }) => {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isVisible, setIsVisible] = useState<boolean>(true);

  useEffect(() => {
    // 36 Partikel rund um die Bildschirm-Mitte / Erfolgs-Zone
    const count = 36;
    const newParticles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
      const distance = 80 + Math.random() * 160;
      const color = COLORS[i % COLORS.length];
      const shapeType = i % 3 === 0 ? 'rect' : i % 3 === 1 ? 'circle' : 'pill';

      newParticles.push({
        id: i,
        x: 0,
        y: 0,
        targetX: Math.cos(angle) * distance,
        targetY: Math.sin(angle) * distance - (30 + Math.random() * 40), // Aufwärts-Drall
        rotation: (Math.random() - 0.5) * 720,
        scale: 0.6 + Math.random() * 0.6,
        color,
        shape: shapeType,
        delay: Math.random() * 0.08,
      });
    }

    setParticles(newParticles);

    const timer = setTimeout(() => {
      setIsVisible(false);
      onComplete?.();
    }, 2200);

    return () => clearTimeout(timer);
  }, [onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      <AnimatePresence>
        {particles.map((p) => (
          <motion.div
            key={p.id}
            initial={{
              x: 0,
              y: 0,
              scale: 0,
              opacity: 1,
              rotate: 0,
            }}
            animate={{
              x: p.targetX,
              y: p.targetY + 80, // Schwerkraft-Senkung
              scale: p.scale,
              opacity: [1, 1, 0],
              rotate: p.rotation,
            }}
            transition={{
              duration: 1.6,
              delay: p.delay,
              ease: [0.12, 0.8, 0.32, 1],
              opacity: { duration: 1.6, times: [0, 0.7, 1] },
            }}
            style={{
              position: 'absolute',
              backgroundColor: p.color,
              width: p.shape === 'pill' ? '12px' : p.shape === 'rect' ? '8px' : '7px',
              height: p.shape === 'pill' ? '6px' : '8px',
              borderRadius: p.shape === 'circle' ? '50%' : p.shape === 'pill' ? '999px' : '2px',
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
