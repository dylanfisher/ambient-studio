// The Host names the server answers for (decision 0025). A page on another site that rebinds
// its own DNS name to this machine's address sends that name as Host, so refusing every name
// but this machine's own keeps such a page from reading or writing through the browser.
import { hostname, networkInterfaces } from "node:os";

/**
 * The name part of a Host header, lowercased: `[::1]` from `[::1]:4180`, `a` from `a:4180`.
 * @param {string} host
 * @returns {string}
 */
function nameOf(host) {
  const lower = host.trim().toLowerCase();
  if (lower.startsWith("[")) return lower.slice(0, lower.indexOf("]") + 1);
  const colon = lower.lastIndexOf(":");
  return colon === -1 ? lower : lower.slice(0, colon);
}

/**
 * Every name this machine answers to now: the loopback names, its host name with and without
 * `.local`, and each interface's address. Read per request, since the LAN address can change
 * while the server runs.
 * @returns {Set<string>}
 */
function ownNames() {
  const machine = hostname()
    .toLowerCase()
    .replace(/\.local$/, "");
  const addresses = Object.values(networkInterfaces())
    .flat()
    .flatMap((net) => (net ? [net.family === "IPv6" ? `[${net.address}]` : net.address] : []));
  return new Set(["localhost", "127.0.0.1", "[::1]", machine, `${machine}.local`, ...addresses]);
}

/**
 * Whether a request's Host header names this machine, on any port. A missing one doesn't.
 * @param {string | undefined} host
 * @returns {boolean}
 */
export function allowedHost(host) {
  return host !== undefined && ownNames().has(nameOf(host));
}
