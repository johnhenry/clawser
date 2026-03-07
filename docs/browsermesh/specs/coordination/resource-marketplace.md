# Resource Marketplace

Service marketplace for publishing, discovering, and reviewing mesh services.

**Source**: `web/clawser-mesh-marketplace.js`
**Related specs**: [trust-graph.md](trust-graph.md) | [payment-channels.md](../extensions/payment-channels.md)

## 1. Overview

The Marketplace lets mesh pods publish service listings, search with multi-criteria
queries, submit and aggregate reviews, and maintain an inverted index for O(1)
lookups by category, tag, and provider. Each instance is scoped to a `localPodId`
that gates unpublish/update permissions.

## 2. Wire Codes

Defined locally in the module (not yet in the canonical constants registry):

| Name              | Hex    | Description                  |
|-------------------|--------|------------------------------|
| LISTING_PUBLISH   | `0x90` | Publish a service listing    |
| LISTING_QUERY     | `0x91` | Query available listings     |
| LISTING_RESPONSE  | `0x92` | Response to a listing query  |
| LISTING_PURCHASE  | `0x93` | Purchase/subscribe to service|
| REVIEW_SUBMIT     | `0x94` | Submit a review              |
| REVIEW_QUERY      | `0x95` | Query reviews for a service  |

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
| App bootstrap wired | No -- not wired to app bootstrap                   |
