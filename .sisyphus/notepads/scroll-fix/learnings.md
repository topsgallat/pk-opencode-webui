Fixed chat scroll jank by switching from smooth scroll on sentinel to instant container scroll.

Key points:
- Replaced endRef.scrollIntoView({ behavior: "smooth" }) inside requestAnimationFrame with containerRef.scrollTop = containerRef.scrollHeight.
- Removed requestAnimationFrame wrapper for scrollToBottom in both MessageTimeline and FlatMessageList.
- Updated auto-scroll effects to track the last message's parts so streaming updates trigger the effect.

Result: stable, non-shaking auto-scroll during streaming while preserving user-scrolled-up suppression and loadMore anchoring.

Notes:
- Kept endRef sentinel div in place (used as marker only).
- Did not add debounce/throttle; instant scroll is imperceptible while streaming.

Date: 2026-04-01
