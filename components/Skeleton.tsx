import React from 'react';

interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
    width?: string | number;
    height?: string | number;
    animation?: 'pulse' | 'wave' | 'none';
}

/**
 * 骨架屏组件 - 用于加载状态的占位显示
 * 提供流畅的加载体验，减少用户等待焦虑
 */
const Skeleton: React.FC<SkeletonProps> = ({
    className = '',
    variant = 'text',
    width,
    height,
    animation = 'pulse'
}) => {
    const baseClasses = 'bg-slate-200 dark:bg-slate-700';

    const variantClasses = {
        text: 'rounded',
        circular: 'rounded-full',
        rectangular: 'rounded-none',
        rounded: 'rounded-2xl'
    };

    const animationClasses = {
        pulse: 'animate-pulse',
        wave: 'animate-shimmer',
        none: ''
    };

    const style: React.CSSProperties = {
        width: width || (variant === 'text' ? '100%' : undefined),
        height: height || (variant === 'text' ? '1em' : undefined),
    };

    return (
        <div
            className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
            style={style}
        />
    );
};

/**
 * 表格骨架屏 - 用于DataTable加载状态
 */
export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
    rows = 5,
    columns = 4
}) => {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-[40px] p-8 border border-slate-100 dark:border-slate-800">
            {/* 标题骨架 */}
            <div className="flex justify-between items-center mb-8">
                <Skeleton variant="rounded" width={200} height={32} />
                <div className="flex gap-3">
                    <Skeleton variant="rounded" width={200} height={44} />
                    <Skeleton variant="circular" width={44} height={44} />
                </div>
            </div>

            {/* 表头骨架 */}
            <div className="flex gap-4 mb-4 px-4">
                {Array.from({ length: columns }).map((_, i) => (
                    <Skeleton key={i} variant="text" width={`${100 / columns}%`} height={16} />
                ))}
            </div>

            {/* 表格行骨架 */}
            <div className="space-y-3">
                {Array.from({ length: rows }).map((_, rowIdx) => (
                    <div key={rowIdx} className="flex gap-4 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-2xl">
                        {Array.from({ length: columns }).map((_, colIdx) => (
                            <Skeleton key={colIdx} variant="text" width={`${100 / columns}%`} height={20} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * 卡片骨架屏 - 用于移动端卡片列表
 */
export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-[24px] p-5 border border-slate-100 dark:border-slate-700">
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                            <Skeleton variant="rounded" width="70%" height={20} className="mb-2" />
                            <Skeleton variant="text" width="50%" height={14} />
                        </div>
                        <Skeleton variant="circular" width={32} height={32} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        {Array.from({ length: 4 }).map((_, j) => (
                            <div key={j} className="bg-white dark:bg-slate-900/50 rounded-xl p-2">
                                <Skeleton variant="text" width="60%" height={10} className="mb-1" />
                                <Skeleton variant="text" width="80%" height={14} />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

/**
 * 表单骨架屏 - 用于表单加载状态
 */
export const FormSkeleton: React.FC<{ fields?: number }> = ({ fields = 6 }) => {
    return (
        <div className="space-y-6 p-6">
            {Array.from({ length: fields }).map((_, i) => (
                <div key={i}>
                    <Skeleton variant="text" width={100} height={12} className="mb-2" />
                    <Skeleton variant="rounded" width="100%" height={48} />
                </div>
            ))}
            <Skeleton variant="rounded" width="100%" height={56} className="mt-8" />
        </div>
    );
};

export default Skeleton;
