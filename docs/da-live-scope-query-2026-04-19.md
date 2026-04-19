# DA.live OAuth scope query — for J to send

**Date:** 2026-04-19
**Blocker:** H4 in `spec-review-findings-2026-04-19.md`
**Outcome needed:** Exact IMS OAuth scope string for DA.live source API (user-backed token) so Adobe MCP can authenticate in Phase 1.

---

## Recommended recipients (pick whichever you have warmest contact with)

- **Dylan DePass** — DA.live product lead (most likely to know or route)
- **Aaron Brady** — DA.live engineering lead (fallback)
- **Adobe DA-live Slack** — `#da-live-help` or equivalent internal channel

Send to one, cc the others. Keep it short — this is a single-question ask with a narrow blast radius.

---

## Draft message

**Subject:** DA.live source API — IMS scope string + token lifetime?

Hi Dylan,

Monks is building a programmatic content pipeline on top of DA.live for a brand-launch accelerator — multi-tenant, Workfront + EDS + LLM-driven. Our Adobe MCP authenticates to three stores (Workfront S2S, EDS admin keys, DA.live user-backed) and we're pinning the last one before Phase 1 kickoff next week.

Four questions on DA.live source API auth:

1. **Scope string** — what exact `scope` value do we pass on the IMS token exchange for a user-backed token with read/write access to sources in a given org? Is it `openid,AdobeID,read_organizations,additional_info.projectedProductContext`, or is there a DA-live-specific scope like `da_source` or `helix_admin`?

2. **Token lifetime** — access token TTL? Refresh token TTL? Any rotation requirements we should respect?

3. **Rate limits** — per-token or per-user? Headers returned on 429 (retry-after seconds)?

4. **Service-account variant** — is there a supported S2S flow for DA.live (technical account, no interactive login), or is user-backed the only path? If user-backed only, any best practice for a shared technical-user identity?

We're locked on answers 1 and 4. If 1 is settled, we can ship Phase 1 on user-backed in the interim.

Thanks — happy to jump on a 15-min call if easier to walk through.

— J

---

## Fallback if no answer by 2026-04-23

Adobe MCP ships with `BLA_DA_LIVE_ENABLED=false` and the pipeline degrades to pre-placed Revlon assets for the demo. The flywheel still demonstrates end-to-end: Brief → LLM copy → Workfront review → approve → EDS publish. Only the "auto-source-fetch" beat is omitted. Note this explicitly in the demo narrative so prospects understand it is a 2-week delta, not a gap.

---

## Who captures the answer

When response arrives, paste into `docs/mcp/adobe-mcp-spec.md` §3.4, drop the "PENDING" placeholder, and commit. Update `spec-review-findings-2026-04-19.md` §H4 resolution.

*End of query brief.*
