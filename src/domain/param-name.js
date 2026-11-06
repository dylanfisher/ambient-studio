/** @import { Descriptor, DescriptorTable } from "../engine/descriptor.js" */

/**
 * The name a table gives one of its descriptors, so code that holds the descriptor doesn't
 * write the parameter's name a second time.
 * @param {DescriptorTable} table
 * @param {Descriptor} descriptor
 * @returns {string}
 */
export function paramName(table, descriptor) {
  const entry = Object.entries(table).find(([, d]) => d === descriptor);
  if (!entry) throw new Error(`descriptor "${descriptor.description}" is not in the table`);
  return entry[0];
}
