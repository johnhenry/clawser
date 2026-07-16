# Resource Marketplace

Service marketplace for publishing, discovering, and reviewing mesh services.

**Source**: `web/clawser-mesh-marketplace.js`
**Related specs**: [trust-graph.md](trust-graph.md) | [payment-channels.md](../extensions/payment-channels.md) | [quota-metering.md](quota-metering.md)

## 1. Overview

The Marketplace lets mesh pods publish service listings, search with multi-criteria
queries, submit and aggregate reviews, and maintain an inverted index for O(1)
lookups by category, tag, and provider. Each instance is scoped to a `localPodId`
that gates unpublish/update permissions.

## 2. Wire Codes

Imported from `MESH_TYPE` in the canonical constants registry
(`browsermesh-primitives/src/constants.mjs`), in the "Extended subsystems" range:

| Name              | Hex    | Description                  |
|-------------------|--------|------------------------------|
| LISTING_PUBLISH   | `0xDF` | Publish a service listing    |
| LISTING_QUERY     | `0xE0` | Query available listings     |
| LISTING_RESPONSE  | `0xE1` | Response to a listing query  |
| LISTING_PURCHASE  | `0xE2` | Purchase/subscribe to service|
| REVIEW_SUBMIT     | `0xE3` | Submit a review              |
| REVIEW_QUERY      | `0xE4` | Query reviews for a service  |

## 3. API Surface

### 3.1 ServiceListing

```
constructor({ id, name, description, providerPodId, category, pricing?,
              tags?, version?, endpoint?, metadata?, publishedAt?, expiresAt?, status? })
isExpired(now?) -> boolean
matchesQuery(query) -> boolean
toJSON() / static fromJSON(data)
```

Pricing: `{ model, amount, currency }`. Models: `free`, `per-call`, `subscription`, `credits`.
Statuses: `active`, `paused`, `expired`, `removed`.

### 3.2 ServiceReview

```
constructor({ id, listingId, reviewerPodId, rating, comment?, createdAt? })
toJSON() / static fromJSON(data)
```

Rating: integer 1-5. Self-review (reviewer === provider) is rejected.

### 3.3 Marketplace

```
constructor({ localPodId })

// Listing lifecycle (unpublish/update are owner-only)
publish(listing) -> string
unpublish(listingId) -> boolean
update(listingId, updates) -> void

// Query
search(query?) -> ServiceListing[]       // text, category, tags, price range, minRating
getListingById(id) -> ServiceListing|null
getListingsByProvider(podId) -> ServiceListing[]
getCategories() -> string[]
getFeatured(limit?) -> ServiceListing[]  // sorted by avg rating

// Reviews
addReview(review) -> void
getReviews(listingId) -> ServiceReview[]
getAverageRating(listingId) -> number

// Events & stats
onPublish(cb) / onUnpublish(cb) / onReview(cb)
getStats() -> { totalListings, activeListings, totalReviews, avgRating }
toJSON() / static fromJSON(data)
```

### 3.4 MarketplaceIndex

Inverted index used internally by Marketplace, also exported.

```
addListing(listing) / removeListing(listingId)
queryByCategory(category) -> string[]
queryByTag(tag) -> string[]
queryByProvider(podId) -> string[]
fullTextSearch(text) -> string[]
```

## 4. Ownership Model

Only the pod matching `localPodId` can `unpublish` or `update`. Publishing is
open (the listing carries its own `providerPodId`).

## 5. Implementation Status

| Aspect              | Status                                             |
|---------------------|----------------------------------------------------|
| All classes         | Fully implemented                                  |
| Multi-criteria search| Fully implemented                                 |
| Inverted index      | Fully implemented (category, tag, provider, text)  |
| Serialization       | toJSON/fromJSON complete                           |
| Unit tests          | Yes (`web/test/clawser-mesh-marketplace.test.mjs`) |
| App bootstrap wired | Yes -- `ClawserPod.initMesh()` constructs `Marketplace` (step 14) and exposes it via `pod.meshMarketplace`; propagated into workspace state as `state.meshMarketplace` by `clawser-workspace-init-mesh.js` |
