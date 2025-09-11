/* eslint-env mocha */
const assert = require('assert').strict;
const { BloomFilter } = require('@rawify/bloomfilter');

// Polyfill btoa/atob for Node if needed
if (typeof globalThis.btoa !== 'function') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
}
if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
}

describe('BloomFilter', () => {
  it('constructs from capacity and errorRate', () => {
    const bf = new BloomFilter({ capacity: 10000, errorRate: 0.01 });
    assert.ok(bf.bitCount > 0);
    assert.ok(bf.hashCount > 0);
    assert.ok(bf.bitset instanceof Uint32Array);
  });

  it('constructs from bitCount and hashCount', () => {
    const bf = new BloomFilter({ bitCount: 1 << 15, hashCount: 5 });
    assert.equal(bf.bitCount, 1 << 15);
    assert.equal(bf.hashCount, 5);
  });

  it('adds and finds elements (no false negatives)', () => {
    const bf = new BloomFilter({ capacity: 1000, errorRate: 0.01 });
    bf.add('alice');
    bf.addAll(['bob', 'carol']);
    assert.equal(bf.mightContain('alice'), true);
    assert.equal(bf.mightContain('bob'), true);
    assert.equal(bf.mightContain('carol'), true);
    assert.equal(bf.mightContain('mallory'), false); // definitely not present
  });

  it('handles binary inputs', () => {
    const bf = new BloomFilter({ capacity: 500, errorRate: 0.01 });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    bf.add(bytes);
    assert.equal(bf.mightContain(bytes), true);
  });

  it('clear() resets the filter', () => {
    const bf = new BloomFilter({ capacity: 100, errorRate: 0.01 });
    bf.add('x');
    assert.equal(bf.mightContain('x'), true);
    bf.clear();
    assert.equal(bf.mightContain('x'), false);
    assert.equal(bf.countSetBits(), 0);
  });

  it('estimates cardinality and FP rate reasonably', () => {
    const n = 200, p = 0.01;
    const bf = new BloomFilter({ capacity: n, errorRate: p });
    for (let i = 0; i < n; i++) bf.add(`k${i}`);
    const est = bf.estimatedCardinality();
    assert.ok(est > n * 0.5 && est < n * 2);
    const fp = bf.estimatedFalsePositiveRate();
    assert.ok(fp > 0 && fp < 0.2);
  });

  it('union and intersection work correctly', () => {
    const bf1 = new BloomFilter({ capacity: 100, errorRate: 0.01 });
    const bf2 = new BloomFilter({ capacity: 100, errorRate: 0.01 });
    bf1.add('foo');
    bf2.add('bar');
    bf1.add('both');
    bf2.add('both');

    const uni = BloomFilter.union(bf1, bf2);
    assert.equal(uni.mightContain('foo'), true);
    assert.equal(uni.mightContain('bar'), true);
    assert.equal(uni.mightContain('both'), true);

    const inter = BloomFilter.intersection(bf1, bf2);
    assert.equal(inter.mightContain('both'), true);
    // Should almost certainly exclude exclusive items
    assert.equal(inter.mightContain('foo'), false);
    assert.equal(inter.mightContain('bar'), false);
  });

  it('serializes and restores with toJSON/fromJSON', () => {
    const bf = new BloomFilter({ capacity: 100, errorRate: 0.01 });
    bf.addAll(['alice', 'bob']);
    const dump = bf.toJSON();
    const bf2 = BloomFilter.fromJSON(dump);
    assert.equal(bf2.mightContain('alice'), true);
    assert.equal(bf2.mightContain('bob'), true);
    assert.equal(bf2.mightContain('carol'), false);
  });
});
