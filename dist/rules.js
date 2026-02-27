export function shouldBlock(args, patterns) {
    const values = extractStrings(args);
    for (const pattern of patterns) {
        for (const value of values) {
            if (value.toLowerCase().includes(pattern.toLowerCase())) {
                return { blocked: true, pattern };
            }
        }
    }
    return { blocked: false };
}
function extractStrings(obj) {
    const values = [];
    function walk(val) {
        if (typeof val === "string") {
            values.push(val);
        }
        else if (Array.isArray(val)) {
            val.forEach(walk);
        }
        else if (val != null && typeof val === "object") {
            Object.values(val).forEach(walk);
        }
    }
    walk(obj);
    return values;
}
//# sourceMappingURL=rules.js.map