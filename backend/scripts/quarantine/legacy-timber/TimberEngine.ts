/**
 * LEGACY DISCONNECTED.
 *
 * Historical timber-specific calculator. Do not wire this utility into active
 * routes. Current barter/payment-in-goods logic lives under `/api/barter`.
 *
 * 木材与板材行业专用计算引擎 (跨国版)
 * 处理算方、材积转换及规格校验，内置国际木材密度库
 */
export class TimberEngine {
    // 常见木材密度表 (kg/m³)
    public static SPECIES_DENSITY: Record<string, number> = {
        'SPF': 450,        // 云杉-松-冷杉
        'HEMLOCK': 500,    // 铁杉
        'PINE': 550,       // 樟子松/辐射松
        'OAK': 750,        // 橡木
        'ASH': 680,        // 水曲柳
        'WALNUT': 640,     // 核桃木
        'BIRCH': 620,      // 桦木
        'TEAK': 660,       // 柚木
        'DEFAULT': 650     // 默认板材
    };

    /**
     * 计算材积 (Cubic Meters)
     */
    static calculateCBM(length: number, width: number, thickness: number, pieces: number = 1): number {
        if (length <= 0 || width <= 0 || thickness <= 0) return 0;
        const volume = (length * width * thickness * pieces) / 1_000_000_000;
        return Number(volume.toFixed(4));
    }

    /**
     * 计算总面积 (Square Meters)
     */
    static calculateSQM(length: number, width: number, pieces: number = 1): number {
        if (length <= 0 || width <= 0) return 0;
        const area = (length * width * pieces) / 1_000_000;
        return Number(area.toFixed(2));
    }

    /**
     * 按树种计算估计重量
     */
    static calculateWeightBySpecies(volume: number, species: string = 'DEFAULT'): number {
        const key = species.toUpperCase();
        const density = this.SPECIES_DENSITY[key] || this.SPECIES_DENSITY['DEFAULT'];
        return Number((volume * density).toFixed(2));
    }

    /**
     * 根据总材积和单片规格反求件数 (PCS)
     */
    static resolvePieces(totalCBM: number, length: number, width: number, thickness: number): number {
        const singleCBM = (length * width * thickness) / 1_000_000_000;
        if (singleCBM <= 0) return 0;
        return Math.round(totalCBM / singleCBM);
    }

    /**
     * 规格解析助手: 支持 "1220*2440*18" 或 "1220x2440x18"
     */
    static parseSpec(spec: string): { l: number; w: number; t: number } | null {
        if (!spec) return null;
        const parts = spec.toLowerCase().split(/[x*]/).map(p => parseFloat(p.trim()));
        if (parts.length === 3 && parts.every(p => !isNaN(p))) {
            return { l: parts[0], w: parts[1], t: parts[2] };
        }
        return null;
    }
}

