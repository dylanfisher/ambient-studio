// A `<dl>`'s rows from term and value pairs, for the facts lists the pages fill in.

/**
 * @param {readonly (readonly [string, string])[]} facts
 * @returns {HTMLElement[]} a `dt` and a `dd` for each pair, in order
 */
export function factRows(facts) {
  return facts.flatMap(([term, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  });
}
