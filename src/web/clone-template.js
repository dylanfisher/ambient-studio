// Copies of a page's `<template>`s, so its markup stays in its HTML file.
/** @import { ElementType } from "./element-by-id.js" */

/**
 * A copy of the template's one element, with the elements marked `data-part="<key>"` in it.
 * @template {Record<string, ElementType>} S
 * @param {string} id the template's id
 * @param {S} spec each part's class, by name
 * @returns {{ root: HTMLElement } & { [K in keyof S]: InstanceType<S[K]> }}
 */
export function cloneTemplate(id, spec) {
  const template = document.getElementById(id);
  if (!(template instanceof HTMLTemplateElement)) {
    throw new Error(`the page has no template #${id}`);
  }
  const root = template.content.firstElementChild?.cloneNode(true);
  if (!(root instanceof HTMLElement)) throw new Error(`template #${id} holds no element`);
  /** @type {Record<string, Element>} */
  const found = { root };
  for (const element of root.querySelectorAll("[data-part]")) {
    found[/** @type {HTMLElement} */ (element).dataset.part ?? ""] = element;
  }
  for (const [name, type] of Object.entries(spec)) {
    if (!(found[name] instanceof type)) {
      throw new Error(`template #${id} has no ${type.name} part named ${name}`);
    }
  }
  return /** @type {any} */ (found);
}
