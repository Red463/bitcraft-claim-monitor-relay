type DecimalParts = {
  coefficient: bigint;
  scale: number;
};

function serialize({ coefficient, scale }: DecimalParts): string {
  if (coefficient === 0n) return "0";
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}

function expandExponent(value: string): string {
  const [mantissa, exponentText] = value.toLowerCase().split("e");
  if (exponentText == null) return value;
  const exponent = Number(exponentText);
  const [whole, fraction = ""] = mantissa.replace(/^\+/, "").split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + exponent;
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${digits}${"0".repeat(point - digits.length)}`;
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function parseDecimal(decimal: string): DecimalParts {
  const canonical = canonicalNonNegativeDecimal(decimal, "Decimal");
  const [whole, fraction = ""] = canonical.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
}

export function canonicalNonNegativeDecimal(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a decimal string`);
  const decimal = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(decimal)) {
    throw new Error(`${label} must be a non-negative decimal`);
  }
  const [whole = "", fraction = ""] = decimal.split(".");
  return serialize({
    coefficient: BigInt(`${whole || "0"}${fraction}`),
    scale: fraction.length,
  });
}

export function canonicalF32Decimal(value: unknown, label: string): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  if (number < 0) throw new Error(`${label} must be non-negative`);
  return canonicalNonNegativeDecimal(expandExponent(Math.fround(number).toPrecision(7)), label);
}

export function addDecimal(left: string, right: string): string {
  const leftParts = parseDecimal(left);
  const rightParts = parseDecimal(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  return serialize({
    coefficient: leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale)
      + rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale),
    scale,
  });
}

export function multiplyDecimalByInteger(decimal: string, integer: string): string {
  const parts = parseDecimal(decimal);
  if (!/^\d+$/.test(integer)) throw new Error("Integer multiplier must be a non-negative integer");
  return serialize({ coefficient: parts.coefficient * BigInt(integer), scale: parts.scale });
}
