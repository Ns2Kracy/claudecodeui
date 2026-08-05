import { lookup as systemLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';

import { AppError } from '@/shared/utils.js';

type RoutingLookupAnswer = {
  address: string;
  family: 4 | 6;
};

type RoutingDnsLookup = (hostname: string) => Promise<RoutingLookupAnswer[]>;

type RoutingTargetPolicyOptions = {
  lookup?: RoutingDnsLookup;
  allowLoopbackHttp?: boolean;
  allowedHosts?: string[];
  allowedHttpHosts?: string[];
  allowedCidrs?: string[];
};

type ValidatedRoutingTarget = {
  origin: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
  pinnedAddress: string;
  family: 4 | 6;
  loopback: boolean;
};

type ParsedCidr = {
  blockList: BlockList;
  family: 4 | 6;
};

const LOOPBACK_ADDRESSES = new BlockList();
LOOPBACK_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_ADDRESSES.addAddress('::1', 'ipv6');

const UNSAFE_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  UNSAFE_ADDRESSES.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2002::', 16],
] as const) {
  UNSAFE_ADDRESSES.addSubnet(network, prefix, 'ipv6');
}

const METADATA_ADDRESSES = new BlockList();
for (const address of ['169.254.169.254', '169.254.170.2', '100.100.100.200']) {
  METADATA_ADDRESSES.addAddress(address, 'ipv4');
}
for (const address of ['fd00:ec2::254', 'fe80::a9fe:a9fe']) {
  METADATA_ADDRESSES.addAddress(address, 'ipv6');
}

function targetBlocked(): AppError {
  return new AppError('The configured 9router target is not permitted', {
    code: 'ROUTING_TARGET_BLOCKED',
    statusCode: 400,
  });
}

function configurationInvalid(): AppError {
  return new AppError('The routing network policy configuration is invalid', {
    code: 'ROUTING_CONFIGURATION_INVALID',
    statusCode: 500,
  });
}

function targetUnreachable(): AppError {
  return new AppError('The configured 9router target could not be resolved', {
    code: 'ROUTING_UNREACHABLE',
    statusCode: 502,
  });
}

function environmentList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function configuredBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function normalizeHostname(hostname: string): string {
  return stripIpv6Brackets(hostname).replace(/\.$/, '').toLowerCase();
}

function normalizeAllowedHost(value: string): string {
  const normalized = normalizeHostname(value.trim());
  if (!normalized || normalized.includes('*') || normalized.includes('/') || normalized.includes(':')) {
    if (isIP(normalized) === 6) {
      return normalized;
    }
    throw configurationInvalid();
  }
  if (isIP(normalized) === 4) {
    return normalized;
  }

  const ascii = domainToASCII(normalized);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.split('.').some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw configurationInvalid();
  }
  return ascii;
}

function parseCidr(value: string): ParsedCidr {
  const [rawAddress, rawPrefix, ...extra] = value.trim().split('/');
  const address = stripIpv6Brackets(rawAddress ?? '');
  const family = isIP(address);
  const prefix = Number(rawPrefix);
  const maxPrefix = family === 4 ? 32 : family === 6 ? 128 : -1;
  if (
    extra.length > 0 ||
    !rawPrefix ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > maxPrefix
  ) {
    throw configurationInvalid();
  }

  const blockList = new BlockList();
  try {
    blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    throw configurationInvalid();
  }
  return { blockList, family: family as 4 | 6 };
}

function matchesBlockList(blockList: BlockList, answer: RoutingLookupAnswer): boolean {
  return blockList.check(answer.address, answer.family === 4 ? 'ipv4' : 'ipv6');
}

function matchesCidr(answer: RoutingLookupAnswer, cidrs: ParsedCidr[]): boolean {
  return cidrs.some(
    (cidr) =>
      cidr.family === answer.family &&
      cidr.blockList.check(answer.address, answer.family === 4 ? 'ipv4' : 'ipv6'),
  );
}

function parseBaseUrl(baseUrl: string): {
  origin: string;
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
} {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw targetBlocked();
  }
  const input = baseUrl.trim();
  if (input.includes('?') || input.includes('#')) {
    throw targetBlocked();
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw targetBlocked();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw targetBlocked();
  }
  if (url.username || url.password) {
    throw targetBlocked();
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  if (!['/', '/v1', '/api/v1'].includes(normalizedPath)) {
    throw targetBlocked();
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw targetBlocked();
  }
  const protocol = url.protocol as 'http:' | 'https:';
  const port = url.port ? Number(url.port) : protocol === 'https:' ? 443 : 80;
  return { origin: url.origin, protocol, hostname, port };
}

async function defaultLookup(hostname: string): Promise<RoutingLookupAnswer[]> {
  const answers = await systemLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family as 4 | 6,
  }));
}

/**
 * Used by the routing HTTP transport and connection validation workflow to
 * normalize a user-provided target, reject SSRF destinations, and pin one DNS
 * result for a single outbound request.
 */
export async function validateRoutingTarget(
  baseUrl: string,
  options: RoutingTargetPolicyOptions = {},
): Promise<ValidatedRoutingTarget> {
  const parsed = parseBaseUrl(baseUrl);
  const allowedHostValues =
    options.allowedHosts ?? environmentList('ROUTING_ALLOWED_HOSTS');
  const allowedCidrValues =
    options.allowedCidrs ?? environmentList('ROUTING_ALLOWED_CIDRS');
  const allowedHosts = new Set(allowedHostValues.map(normalizeAllowedHost));
  const allowedHttpHosts = new Set((options.allowedHttpHosts ?? []).map(normalizeAllowedHost));
  const allowedCidrs = allowedCidrValues.map(parseCidr);
  const allowLoopbackHttp =
    options.allowLoopbackHttp ??
    configuredBoolean(process.env.ROUTING_ALLOW_LOOPBACK_HTTP);

  let answers: RoutingLookupAnswer[];
  try {
    answers = await (options.lookup ?? defaultLookup)(parsed.hostname);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw targetUnreachable();
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    throw targetUnreachable();
  }

  for (const answer of answers) {
    if (
      (answer.family !== 4 && answer.family !== 6) ||
      isIP(answer.address) !== answer.family
    ) {
      throw targetUnreachable();
    }
  }

  const allLoopback = answers.every((answer) => matchesBlockList(LOOPBACK_ADDRESSES, answer));
  const hostException = allowedHosts.has(parsed.hostname);

  for (const answer of answers) {
    if (matchesBlockList(METADATA_ADDRESSES, answer)) {
      throw targetBlocked();
    }
    if (!matchesBlockList(UNSAFE_ADDRESSES, answer)) {
      continue;
    }
    const permittedLoopback = allLoopback && allowLoopbackHttp;
    if (!permittedLoopback && !hostException && !matchesCidr(answer, allowedCidrs)) {
      throw targetBlocked();
    }
  }

  if (
    parsed.protocol === 'http:'
    && (!allLoopback || !allowLoopbackHttp)
    && !allowedHttpHosts.has(parsed.hostname)
  ) {
    throw targetBlocked();
  }

  const pinned = answers[0];
  return {
    ...parsed,
    pinnedAddress: pinned.address,
    family: pinned.family,
    loopback: allLoopback,
  };
}
