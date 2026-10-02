/**
 * Madrona wordmark — "Madrona" followed by an oversized copper period,
 * matching the Madrona brand mark:
 *   Madrona<span class="text-copper text-[1.4em] leading-none">.</span>
 *
 * Renders inline content only (no wrapper element), so the parent controls
 * the font, size, and base text color (the copper dot is always copper).
 * The dot is aria-hidden so screen readers announce just "Madrona".
 */
export function Wordmark() {
  return (
    <>
      Madrona
      <span aria-hidden="true" className="text-copper text-[1.4em] leading-none">
        .
      </span>
    </>
  );
}

export default Wordmark;
