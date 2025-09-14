# BloomFilter.js

[![NPM Package](https://img.shields.io/npm/v/@rawify/bloomfilter.svg?style=flat)](https://www.npmjs.com/package/@rawify/bloomfilter "View this project on npm")
[![MIT license](http://img.shields.io/badge/license-MIT-brightgreen.svg)](http://opensource.org/licenses/MIT)

**BloomFilter.js** is a high-performance JavaScript implementation of Bloom filters, a probabilistic data structures for fast set membership testing.

They are particularly useful as **pre-checks** in situations where a lookup or request is expensive for example, checking whether an element might exist in a database, a cache, or an API before actually making the request. If the filter says **“no”**, you can skip the request entirely. If it says **“yes”**, you proceed, knowing there may still be a false positive. This trade-off makes Bloom filters ideal for large-scale systems where memory and response time matter.

## Features

- Space-efficient set membership testing with guaranteed no false negatives
- Practical use case: lookup pre-check to avoid unnecessary requests
- Optimal parameter calculation from target capacity and false-positive rate
- Bit-level operations inspired by [BitSet.js](https://github.com/rawify/BitSet.js)
- Support for binary and string keys (UTF-8 encoded once)
- High-quality double hashing (Kirsch–Mitzenmacher) with Murmur3-style hashes
- Enhanced double hashing (ENH) + xor mixing for accuracy
- Optional power-of-two optimization for constant-time masking
- Union and intersection of Bloom filters
- Live estimates: fill ratio, cardinality, false-positive rate
- Compact base64 serialization and restoration

## Implementation Notes & Accuracy

Bloom filters are simple in concept but easy to implement poorly. Some implementations (see [RocksDB issue #4120](https://github.com/facebook/rocksdb/issues/4120)) suffer from:

1. **Poor probe distribution**:
   If the “step” size between indices is zero or not coprime with the filter size, the same few positions get probed repeatedly. This silently increases the false-positive rate.

2. **Weak hashing**:
   Deriving all indices from the same 32-bit hash with only rotations/XOR can create subtle correlations between indices, especially in medium-sized filters.

**BloomFilter.js** avoids these pitfalls:

* Uses **two independent Murmur3 32-bit hashes** instead of reusing one, ensuring high-quality entropy.
* Always forces the step to be **odd**, and when the bit count is a power of two (default), this guarantees full-cycle probing with no repeats.
* For non-power-of-two filters, it applies **Enhanced Double Hashing (ENH)** so indices remain well distributed even when gcd(step, m) ≠ 1.
* Adds a cheap **xor mixing step** to decorrelate the two hash streams further.

As a result, the accuracy of this implementation closely tracks the theoretical false-positive rates, even for small or non-standard filter sizes.

> ⚡ **Note:** Binary Fuse and XOR filters can outperform Bloom filters on **static sets** (lower bits/item, faster lookups), but they are not a drop-in replacement. Bloom filters remain the better choice when you need **online updates**, **unions/intersections**, or compatibility with streaming workloads.

## Installation

You can install `BloomFilter.js` via npm:

```bash
npm install @rawify/bloomfilter
```

Or with yarn:

```bash
yarn add @rawify/bloomfilter
```

Alternatively, download or clone the repository:

```bash
git clone https://github.com/rawify/BloomFilter.js
```

## Usage

Include the `bloomfilter.min.js` file in your project:

```html
<script src="path/to/bloomfilter.min.js"></script>
```

Or in a Node.js / modern ES project:

```javascript
const { BloomFilter } = require('@rawify/bloomfilter');
```

or

```javascript
import { BloomFilter } from '@rawify/bloomfilter';
```

### Creating a Bloom Filter

You can create a Bloom filter either by specifying the desired capacity and false-positive rate:

```javascript
const bf = new BloomFilter({ capacity: 100000, errorRate: 0.01 });
```

or by explicitly providing the number of bits and hash functions:

```javascript
const bf = new BloomFilter({ bitCount: 1 << 20, hashCount: 7 });
```

### Lookup Pre-Check Example

```javascript
// Suppose we want to avoid unnecessary DB/API requests
bf.add("user:alice"); // mark known entries
bf.add("user:bob");

if (!bf.mightContain("user:mallory")) {
  // definitely not present → skip expensive lookup
} else {
  // possibly present → perform the real DB/API request
}
```

### Adding and Testing Elements

```javascript
bf.add("alice");
bf.addAll(["bob", "carol"]);

bf.mightContain("alice");   // true (possibly)
bf.mightContain("mallory"); // false (definitely not)
```

### Estimations

```javascript
bf.estimatedCardinality();        // Approximate number of inserted elements
bf.estimatedFalsePositiveRate();  // Current FP rate given fill ratio
bf.fillRatio();                   // Fraction of bits set
```

### Set Operations

```javascript
const bf1 = new BloomFilter({ capacity: 1000, errorRate: 0.01 });
const bf2 = new BloomFilter({ capacity: 1000, errorRate: 0.01 });

bf1.add("foo");
bf2.add("bar");

const both = BloomFilter.union(bf1, bf2);          // union of sets
const common = BloomFilter.intersection(bf1, bf2); // intersection of sets
```

### Serialization

```javascript
const dump = bf.toJSON();
// Save to disk, send over network, etc.
const bf2 = BloomFilter.fromJSON(dump);
```

## Methods

### Instance Methods

* `add(key)` - insert a single element.
* `addAll(iterable)` - insert multiple elements.
* `mightContain(key)` - test membership (false = definitely not present).
* `clear()` - reset the filter.
* `bitCount` - number of bits in the filter.
* `hashCount` - number of hash functions.
* `bitset` - underlying `Uint32Array`.
* `addCalls` - number of `add` operations performed.
* `countSetBits()` - number of bits currently set.
* `fillRatio()` - fraction of bits set.
* `estimatedCardinality()` - approximate number of distinct inserted elements.
* `estimatedFalsePositiveRate()` - current false-positive probability.
* `toJSON()` - export configuration and bitset as JSON.

### Static Methods

* `BloomFilter.fromJSON(obj)` - restore from serialized JSON.
* `BloomFilter.optimalParameters(capacity, errorRate)` - compute ideal `{bitCount, hashCount}`.
* `BloomFilter.union(a, b)` - compute union of two compatible filters.
* `BloomFilter.intersection(a, b)` - compute intersection of two compatible filters.

## Coding Style

Like all my libraries, BloomFilter.js is written to minimize size after compression with Google Closure Compiler in advanced mode. The code style is optimized to maximize compressibility. If you extend the library, please preserve this style.


## Building the library

After cloning the Git repository run:

```
npm install
npm run build
```

## Copyright and Licensing

Copyright (c) 2025, [Robert Eisele](https://raw.org/)
Licensed under the MIT license.
