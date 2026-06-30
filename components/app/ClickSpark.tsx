import React, { useEffect, useState } from 'react';

const COLORS = ['#93C5FD', '#A7F3D0', '#DDD6FE', '#FDE047'];

const ClickSpark: React.FC = () => {
  const [sparks, setSparks] = useState<{ id: number; x: number; y: number; color: string; vx: number; vy: number; size: number }[]>([]);

  useEffect(() => {
    const handlePointer = (event: PointerEvent) => {
      const id = Date.now();
      const count = 3;
      const newSparks = Array.from({ length: count }).map((_, index) => {
        const angle = (index / count) * Math.PI * 2 + Math.random();
        const velocity = 1 + Math.random() * 2;
        return {
          id: id + index,
          x: event.clientX,
          y: event.clientY,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          size: 4 + Math.random() * 4,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        };
      });
      setSparks(prev => [...prev, ...newSparks].slice(-15));
      window.setTimeout(() => {
        setSparks(prev => prev.filter(item => !newSparks.find(newSpark => newSpark.id === item.id)));
      }, 400);
    };

    window.addEventListener('pointerdown', handlePointer);
    return () => window.removeEventListener('pointerdown', handlePointer);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
      {sparks.map(spark => (
        <div
          key={spark.id}
          className="absolute rounded-full"
          style={{
            left: spark.x,
            top: spark.y,
            width: spark.size,
            height: spark.size,
            backgroundColor: spark.color,
            boxShadow: `0 0 6px ${spark.color}`,
            animation: 'spark-jelly 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards',
            '--vx': `${spark.vx * 20}px`,
            '--vy': `${spark.vy * 20}px`,
          } as React.CSSProperties}
        />
      ))}
      <style>{`
        @keyframes spark-jelly {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
          100% { transform: translate(calc(var(--vx) - 50%), calc(var(--vy) - 50%)) scale(0); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default ClickSpark;
