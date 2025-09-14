'use strict';

/* !simple-compilation */
class BloomFilter {

    /**
     * Constructor options:
     * - capacity, errorRate  : target n and p (e.g., 1e6, 0.01)
     * - bitCount, hashCount  : explicit definitions
     * - usePowerOfTwoBits    : round bitCount to power-of-two (default: true)
     */
    constructor({ capacity, errorRate, bitCount, hashCount, usePowerOfTwoBits = true } = {}) {

        this._bitCount = 0;          // number of bits
        this._hashCount = 0;         // number of hash functions
        this._indexMask = 0;         // (m - 1) if bitCount is power of two, else 0
        this._bitset = null;         // Uint32Array of packed bits
        this._utf8 = new TextEncoder();
        this._addCalls = 0;          // number of add() invocations (heuristic)

        if (Number.isInteger(bitCount) && Number.isInteger(hashCount) && bitCount > 0 && hashCount > 0) {
            const mAligned = roundUpToMultipleOf32(bitCount);
            this._initialize(mAligned, hashCount, usePowerOfTwoBits);
        } else {
            if (!(Number.isFinite(capacity) && capacity > 0 && errorRate > 0 && errorRate < 1)) {
                throw new Error("Provide either {bitCount, hashCount} or valid {capacity, errorRate} with 0 < errorRate < 1.");
            }
            const { bitCount: m0, hashCount: k0 } = computeOptimalParameters(capacity, errorRate);
            this._initialize(m0, k0, usePowerOfTwoBits);
        }
    }

    /** Insert a single key. Accepts string, Uint8Array, ArrayBuffer(View), or anything coercible to string. */
    add(key) {
        const { h1, h2 } = this._hashPair(key);

        const m = this._bitCount;
        const k = this._hashCount;
        const mask = this._indexMask;

        // Cheap mixing + Enhanced Double Hashing (ENH)
        let h = (h1 ^ 0x6740bca3) >>> 0;       // cheap XOR mix
        let delta = (h2 | 1) >>> 0;            // keep odd; will evolve per-iteration

        for (let i = 0; i < k; i++) {
            const idx = mask ? (h & mask) : (h % m);
            setBit(this._bitset, idx);

            // ENH: evolve delta and base so we don't rely on gcd(step, m)
            delta = (delta + i) >>> 0;
            h = (h + delta) >>> 0;
        }
        this._addCalls++;
        return this;
    }

    /** Insert many keys from any iterable. */
    addAll(iterable) {

        for (const v of iterable) {
            this.add(v);
        }
        return this;
    }

    /**
     * Membership test.
     * Returns false => definitely not present; true => possibly present (subject to FP rate).
     */
    mightContain(key) {
        const { h1, h2 } = this._hashPair(key);

        const m = this._bitCount;
        const k = this._hashCount;
        const mask = this._indexMask;

        // Cheap mixing + Enhanced Double Hashing (ENH)
        let h = (h1 ^ 0x6740bca3) >>> 0;       // cheap XOR mix
        let delta = (h2 | 1) >>> 0;            // keep odd; will evolve per-iteration

        for (let i = 0; i < k; i++) {
            const idx = mask ? (h & mask) : (h % m);
            if (!getBit(this._bitset, idx)) return false; // definitely not present

            // ENH progression
            delta = (delta + i) >>> 0;
            h = (h + delta) >>> 0;
        }
        return true; // possibly present
    }

    /** Clear all bits. */
    clear() {
        this._bitset.fill(0);
        this._addCalls = 0;
    }

    /** Number of bits (m). */
    get bitCount() { return this._bitCount; }
    /** Number of hash functions (k). */
    get hashCount() { return this._hashCount; }
    /** Underlying Uint32Array. */
    get bitset() { return this._bitset; }
    /** Number of add() calls made (heuristic load). */
    get addCalls() { return this._addCalls; }

    /** Count of bits currently set (popcount). */
    countSetBits() {
        let sum = 0;
        const a = this._bitset;
        for (let i = 0; i < a.length; i++) {
            sum += popcount32(a[i]);
        }
        return sum;
    }

    /** Fraction of bits set in the filter. */
    fillRatio() {
        // Alternatively with Fraction.js: new Fraction(x.countSetBits(), x.bitCount)
        return this.countSetBits() / this._bitCount;
    }

    /**
     * Estimate cardinality (number of distinct inserted items),
     * using standard Bloom estimator: n ≈ -(m/k) * ln(1 - X/m).
     */
    estimatedCardinality() {
        const n = this.countSetBits();
        const m = this._bitCount;
        const k = this._hashCount;
        if (n === 0) return 0;
        if (n >= m) return Infinity;
        return - (m / k) * Math.log(1 - n / m);
    }

    /**
     * Estimated false-positive rate given current fill:
     * p ≈ (X/m)^k, where X is the number of set bits.
     */
    estimatedFalsePositiveRate() {
        const ratio = this.fillRatio();
        return Math.pow(ratio, this._hashCount);
    }

    /** Serialize to JSON with base64-encoded bitset (btoa). */
    toJSON() {
        return {
            bitCount: this._bitCount,
            hashCount: this._hashCount,
            data: u32ToBase64(this._bitset)
        };
    }

    /** Restore from JSON produced by toJSON(). */
    static fromJSON({ bitCount, hashCount, data }) {

        if (!Number.isInteger(bitCount) || !Number.isInteger(hashCount) || typeof data !== 'string') {
            throw new Error("Invalid BloomFilter JSON.");
        }
        const bf = new BloomFilter({ bitCount, hashCount, usePowerOfTwoBits: false });
        const words = (bitCount + 31) >>> 5;
        const arr = base64ToU32(data, words);
        bf._bitset.set(arr.subarray(0, words));
        // Recompute mask for the exact bitCount given:
        bf._indexMask = isPowerOfTwo(bitCount) ? (bitCount - 1) : 0;
        return bf;
    }

    /** Compute optimal m,k for capacity and error rate (public convenience). */
    static optimalParameters(capacity, errorRate) {
        return computeOptimalParameters(capacity, errorRate);
    }

    /** Bitwise union (a ∪ b). Requires identical m,k. */
    static union(a, b) {
        ensureCompatible(a, b);
        const out = new BloomFilter({ bitCount: a._bitCount, hashCount: a._hashCount, usePowerOfTwoBits: false });
        const A = a._bitset;
        const B = b._bitset;
        const C = out._bitset;
        for (let i = 0; i < A.length; i++)
            C[i] = A[i] | B[i];
        return out;
    }

    /** Bitwise intersection (a ∩ b). Requires identical m,k. */
    static intersection(a, b) {
        ensureCompatible(a, b);
        const out = new BloomFilter({ bitCount: a._bitCount, hashCount: a._hashCount, usePowerOfTwoBits: false });
        const A = a._bitset;
        const B = b._bitset;
        const C = out._bitset;
        for (let i = 0; i < A.length; i++)
            C[i] = A[i] & B[i];
        return out;
    }

    _initialize(mAligned, k, usePowerOfTwoBits) {
        let m = mAligned;
        if (usePowerOfTwoBits) {
            const pow2 = nextPowerOfTwo(m);
            if (pow2 > m)
                m = pow2; // slightly oversize for mask speed
        }
        const words = (m + 31) >>> 5;
        this._bitset = new Uint32Array(words);
        this._bitCount = m;
        this._hashCount = k;
        this._indexMask = isPowerOfTwo(m) ? (m - 1) : 0;
        this._addCalls = 0;
    }

    _hashPair(key) {
        const bytes = coerceToBytes(this._utf8, key);
        // Two independent seeded 32-bit hashes (one pass over the bytes each).
        // This avoids 64-bit emulation and keeps high throughput in JS.
        const h1 = murmur32(bytes, 0x9747b28c) >>> 0;
        const h2 = murmur32(bytes, 0x85ebca6b) >>> 0;
        return { h1, h2 };
    }
}

/** Compute optimal bitCount and hashCount for capacity n and error rate p. */
function computeOptimalParameters(n, p) {
    const ln2 = Math.LN2;
    let m = Math.ceil((-n * Math.log(p)) / (ln2 * ln2));   // m = -n ln p / (ln 2)^2
    let k = Math.max(1, Math.round((m / n) * ln2));        // k = m/n * ln 2

    return {
        bitCount: roundUpToMultipleOf32(m),
        hashCount: k
    };
}

/** Murmur3-style fast 32-bit hash for Uint8Array. */
function murmur32(bytes, seed = 0) {
    let h = seed >>> 0;
    const c1 = 0xcc9e2d51 | 0, c2 = 0x1b873593 | 0;
    const len = bytes.length >>> 0;
    const blockCount = len >>> 2;

    // body
    for (let i = 0, off = 0; i < blockCount; i++, off += 4) {
        let k =
            (bytes[off] |
                (bytes[off + 1] << 8) |
                (bytes[off + 2] << 16) |
                (bytes[off + 3] << 24)) >>> 0;
        k = Math.imul(k, c1);
        k = (k << 15) | (k >>> 17);
        k = Math.imul(k, c2);
        h ^= k;
        h = (h << 13) | (h >>> 19);
        h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    }

    // tail
    let k1 = 0;
    const rem = len & 3;
    if (rem === 3) k1 ^= bytes[len - 3] << 16;
    if (rem >= 2) k1 ^= bytes[len - 2] << 8;
    if (rem >= 1) {
        k1 ^= bytes[len - 1];
        k1 = Math.imul(k1, c1);
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = Math.imul(k1, c2);
        h ^= k1 >>> 0;
    }

    // fmix
    h ^= len;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** Convert key to Uint8Array once (strings via TextEncoder). */
function coerceToBytes(utf8, x) {
    if (typeof x === 'string')
        return utf8.encode(x);
    if (x instanceof Uint8Array)
        return x;
    if (ArrayBuffer.isView(x) && x.buffer)
        return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    if (x instanceof ArrayBuffer)
        return new Uint8Array(x);
    return utf8.encode(String(x));
}

/** Set a single bit. */
function setBit(arrU32, bitIndex) {
    const w = bitIndex >>> 5;
    const mask = 1 << (bitIndex & 31);
    arrU32[w] = arrU32[w] | mask;
}

/** Read a single bit. */
function getBit(arrU32, bitIndex) {
    const w = bitIndex >>> 5;
    const mask = 1 << (bitIndex & 31);
    return (arrU32[w] & mask) !== 0;
}

/** Count bits set in a 32-bit word (HAKMEM/Stanford bit hacks). */
function popcount32(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0F0F0F0F;
    v = v + (v >>> 8);
    v = v + (v >>> 16);
    return v & 0x3F;
}

/** Round up to a multiple of 32. */
function roundUpToMultipleOf32(m) {
    const r = m & 31;
    return r === 0 ? m : (m + (32 - r));
}

/** Next power of two (for 32-bit positive integers). */
function nextPowerOfTwo(x) {
    if (x <= 1) return 1;
    return 1 << (32 - Math.clz32(x - 1));
}

/** Is power of two? */
function isPowerOfTwo(x) {
    return x > 0 && (x & (x - 1)) === 0;
}

/** Uint32Array -> base64 via btoa (browser). */
function u32ToBase64(u32) {
    const bytes = new Uint8Array(u32.buffer, u32.byteOffset, u32.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i++)
        s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

/** base64 -> Uint32Array via atob (browser). Optionally enforce word count. */
function base64ToU32(b64, expectedWords) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
    const pad = (4 - (bytes.byteLength & 3)) & 3;
    let buf = bytes;
    if (pad) {
        const tmp = new Uint8Array(bytes.byteLength + pad);
        tmp.set(bytes);
        buf = tmp;
    }
    const u32 = new Uint32Array(buf.buffer);
    if (expectedWords && u32.length !== expectedWords) {
        const out = new Uint32Array(expectedWords);
        out.set(u32.subarray(0, Math.min(u32.length, expectedWords)));
        return out;
    }
    return u32;
}

/** Ensure two Bloom filters are compatible for set algebra. */
function ensureCompatible(a, b) {
    if (!(a instanceof BloomFilter) || !(b instanceof BloomFilter)) {
        throw new Error("Both arguments must be BloomFilter instances.");
    }
    if (a.bitCount !== b.bitCount || a.hashCount !== b.hashCount) {
        throw new Error("Bloom filters must have identical {bitCount, hashCount}.");
    }
}

Object.defineProperty(BloomFilter, "__esModule", { 'value': true });
BloomFilter['default'] = BloomFilter;
BloomFilter['BloomFilter'] = BloomFilter;
module['exports'] = BloomFilter;
