# Market source discovery

Discovery is disabled by default and has not been live-qualified. It sends a
bounded version of the project offer and audience to Tavily, then independently
fetches up to three public pages with the existing DNS-pinned website reader.
Captured pages remain attributed, unverified source claims. Provider snippets
are not persisted. The planner still needs owner review.

The optional integration uses Tavily's `basic` search with automatic parameter
selection disabled. Current vendor documentation describes one credit per
basic search and a Researcher tier with 1,000 monthly credits and no card.
Prices and terms can change; see the [pricing page](https://www.tavily.com/pricing),
[search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
and [usage API](https://docs.tavily.com/documentation/api-reference/endpoint/usage).
No account was registered and no plan was activated by this implementation.

Before enabling a real account, confirm its terms, privacy implications,
provider-enforced free plan and pay-as-you-go limit of zero. Store its
`TAVILY_API_KEY` only in the existing server-side `media-engine` vault service.
Only after verification set the server-only
`MARKETING_TAVILY_DISCOVERY_ENABLED=true`. The code fails closed unless the
usage endpoint identifies a free/Researcher plan, zero pay-as-you-go limit,
and available account and key credits. Account settings can change, so keep
provider-side limits in place; an application-side check is not a billing
guarantee.

The application records a reservation before one search, allows at most one
attempt per project per 24 hours, and does not automatically replay an
uncertain search. It uses no advanced or auto-selected search depth. The
search and page capture are subject to the existing project source limit.
If the account, provider or page fetch is unavailable, plans use existing
confirmed facts and sources and must state the research gap.
