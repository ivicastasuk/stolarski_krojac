// Unit conversion utilities
export const FACTORS = { mm: 1, cm: 10, m: 1000 };

export function toMM(val, unit) {
    return parseFloat(val) * (FACTORS[unit] ?? 1);
}

export function fromMM(valueMM, unit) {
    return valueMM / (FACTORS[unit] ?? 1);
}

// Format mm value for display in given unit
export function fmt(valueMM, unit) {
    const v = fromMM(valueMM, unit);
    if (unit === 'mm') return Math.round(v).toString();
    if (unit === 'cm') return parseFloat(v.toFixed(1)).toString();
    return parseFloat(v.toFixed(3)).toString();
}
