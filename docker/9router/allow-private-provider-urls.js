import { readFileSync, writeFileSync } from "node:fs";

const routePath =
	"/usr/local/lib/node_modules/9router/app/.next-cli-build/server/app/api/provider-nodes/validate/route.js";
const source = readFileSync(routePath, "utf8");
const startAnchor = "function i(a){let b,c,f=new URL(a).hostname.toLowerCase();";
const endAnchor = 'throw Error("Blocked URL: private IP")}';
const start = source.indexOf(startAnchor);
const end = source.indexOf(endAnchor, start);

if (start === -1 || end === -1) {
	throw new Error("9Router 0.5.50 URL validator anchor not found");
}

const originalValidator = source.slice(start, end + endAnchor.length);
if (
	!originalValidator.includes("Blocked URL: internal host") ||
	!originalValidator.includes("Blocked URL: private IP")
) {
	throw new Error("9Router 0.5.50 private-network validator changed");
}

const protocolOnlyValidator =
	'function i(a){let b=new URL(a);if("http:"!==b.protocol&&"https:"!==b.protocol)throw Error("Blocked URL: unsupported protocol")}';
const patched =
	source.slice(0, start) +
	protocolOnlyValidator +
	source.slice(end + endAnchor.length);

writeFileSync(routePath, patched);
console.log("Patched 9Router provider validation to allow all HTTP(S) targets");
