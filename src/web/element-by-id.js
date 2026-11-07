// A page's elements by id, typed, failing loudly when the HTML and the module disagree.

/** @typedef {new (...args: any[]) => Element} ElementType a class such as `HTMLAudioElement` */

/**
 * @template {Element} T
 * @param {string} id
 * @param {new (...args: any[]) => T} type
 * @returns {T}
 */
export function elementById(id, type) {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw new Error(`the page has no ${type.name} #${id}; found ${found?.constructor.name}`);
  }
  return found;
}

/**
 * Every element a page module uses, looked up once when it loads: each key is an id.
 * @template {Record<string, ElementType>} S
 * @param {S} spec
 * @returns {{ [K in keyof S]: InstanceType<S[K]> }}
 */
export function elementsById(spec) {
  return /** @type {any} */ (
    Object.fromEntries(Object.entries(spec).map(([id, type]) => [id, elementById(id, type)]))
  );
}
