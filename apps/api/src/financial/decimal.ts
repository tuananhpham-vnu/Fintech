/** Exact rational Decimal. Arithmetic never rounds; only format() rounds (half away from zero). */
export interface ExactValue {
  numerator: string
  denominator: string
  /** Exact terminating decimal, or null when the decimal expansion repeats. */
  decimal: string | null
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a
  b = b < 0n ? -b : b
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function places(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10000)
    throw new RangeError('Decimal places must be an integer from 0 to 10000')
}

export class Decimal {
  readonly numerator: bigint
  readonly denominator: bigint

  private constructor(numerator: bigint, denominator: bigint) {
    if (denominator === 0n) throw new RangeError('Decimal division by zero')
    const divisor = gcd(numerator, denominator)
    const sign = denominator < 0n ? -1n : 1n
    this.numerator = (numerator / divisor) * sign
    this.denominator = (denominator / divisor) * sign
    Object.freeze(this)
  }

  /** Plain decimal strings only: no float conversion, exponents, separators or whitespace. */
  static parse(value: string): Decimal {
    if (typeof value !== 'string' || value.length > 1002)
      throw new TypeError('Expected a plain decimal string of at most 1000 digits')
    const match = /^[+-]?\d+(?:\.\d+)?$/.exec(value)
    if (!match || match[0] !== value || value.replace(/[^0-9]/g, '').length > 1000)
      throw new TypeError('Expected a plain decimal string of at most 1000 digits')
    const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.')
    const sign = value.startsWith('-') ? -1n : 1n
    return new Decimal(sign * BigInt(integer + fraction), 10n ** BigInt(fraction.length))
  }

  static fraction(numerator: bigint, denominator: bigint): Decimal {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint')
      throw new TypeError('Exact fractions require bigint inputs')
    return new Decimal(numerator, denominator)
  }

  add(other: Decimal): Decimal {
    return new Decimal(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    )
  }

  sub(other: Decimal): Decimal {
    return new Decimal(
      this.numerator * other.denominator - other.numerator * this.denominator,
      this.denominator * other.denominator,
    )
  }

  mul(other: Decimal): Decimal {
    return new Decimal(this.numerator * other.numerator, this.denominator * other.denominator)
  }

  div(other: Decimal): Decimal {
    return new Decimal(this.numerator * other.denominator, this.denominator * other.numerator)
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator
    return difference < 0n ? -1 : difference > 0n ? 1 : 0
  }

  /** Fixed decimal places, HALF_UP on magnitude, with no negative zero. Display only. */
  format(decimalPlaces: number): string {
    places(decimalPlaces)
    const magnitude = this.numerator < 0n ? -this.numerator : this.numerator
    const scaled = magnitude * 10n ** BigInt(decimalPlaces)
    let rounded = scaled / this.denominator
    if ((scaled % this.denominator) * 2n >= this.denominator) rounded += 1n
    const digits = rounded.toString().padStart(decimalPlaces + 1, '0')
    const sign = this.numerator < 0n && rounded !== 0n ? '-' : ''
    return (
      sign +
      (decimalPlaces === 0
        ? digits
        : `${digits.slice(0, -decimalPlaces)}.${digits.slice(-decimalPlaces)}`)
    )
  }

  toExact(): ExactValue {
    let remainder = this.denominator
    let twos = 0
    let fives = 0
    while (remainder % 2n === 0n) {
      remainder /= 2n
      twos++
    }
    while (remainder % 5n === 0n) {
      remainder /= 5n
      fives++
    }
    let decimal: string | null = null
    if (remainder === 1n) {
      const scale = Math.max(twos, fives)
      const magnitude = this.numerator < 0n ? -this.numerator : this.numerator
      const digits = (magnitude * (10n ** BigInt(scale) / this.denominator))
        .toString()
        .padStart(scale + 1, '0')
      const unsigned = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
      decimal = (this.numerator < 0n ? '-' : '') + unsigned
    }
    return {
      numerator: this.numerator.toString(),
      denominator: this.denominator.toString(),
      decimal,
    }
  }

  /** A repeating value is represented as an exact fraction, never a truncated decimal. */
  toString(): string {
    return this.toExact().decimal ?? `${this.numerator}/${this.denominator}`
  }

  toJSON(): ExactValue {
    return this.toExact()
  }
}
