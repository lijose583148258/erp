import React, { useEffect, useState } from 'react';

const COLORS = ['#93C5FD', '#A7F3D0', '#DDD6FE', '#FDE047'];

const ClickSpark: React.FC = () => {
    const [sparks, setSparks] = useState<{ id: number; x: number; y: number; color: string; vx: number; vy: number; size: number }[]>([]);

    useEffect(() => {
        const handlePointer = (e: PointerEvent) => {
            const id = Date.now();
            const count = 3; // 减弱：原来 8，降为 3 颗
            const newSparks = Array.from({ length: count }).map((_, i) => {
                const angle = (i / count) * Math.PI * 2 + Math.random();
                const velocity = 1 + Math.random() * 2; // 减弱扩散速度
                return {
                    id: id + i,
                    x: e.clientX,
                    y: e.clientY,
                    vx: Math.cos(angle) * velocity,
                    vy: Math.sin(angle) * velocity,
                    size: 4 + Math.random() * 4, // 减小尺寸
                    color: COLORS[Math.floor(Math.random() * COLORS.length)],
                };
            });
            setSparks(prev => [...prev, ...newSparks].slice(-15)); // 控制最大存在数量
            window.setTimeout(() => {
                setSparks(prev => prev.filter(p => !newSparks.find(ns => ns.id === p.id)));
            }, 400); // 缩短生命周期
        };

        window.addEventListener('pointerdown', handlePointer);
        return () => window.removeEventListener('pointerdown', handlePointer);
    }, []);

    return (
        <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden">
            {sparks.map(s => (
                <div
                    key={s.id}
                    className="absolute rounded-full"
                    style={{
                        left: s.x,
                        top: s.y,
                        width: s.size,
                        height: s.size,
                        backgroundColor: s.color,
                        boxShadow: `0 0 6px ${s.color}`,
                        animation: 'spark-jelly 0.4s cubic-bezier(0.25, 1, 0.5, 1) forwards',
                        '--vx': `${s.vx * 20}px`, // 减弱扩散距离
                        '--vy': `${s.vy * 20}px`,
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
