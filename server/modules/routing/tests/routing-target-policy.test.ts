import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { validateRoutingTarget } from '../routing-target-policy.js';

type LookupAnswer = { address: string; family: 4 | 6 };

function lookupAnswers(...answers: LookupAnswer[]) {
  return async () => answers;
}

async function assertTargetError(
  run: () => Promise<unknown>,
  code = 'ROUTING_TARGET_BLOCKED',
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, code);
    return true;
  });
}

test('rejects unsupported schemes and URL authority tricks', async () => {
  const lookup = lookupAnswers({ address: '93.184.216.34', family: 4 });

  for (const baseUrl of [
    'ftp://router.example',
    'ws://router.example',
    'https://user:password@router.example',
    'https://router.example?next=/api',
    'https://router.example#fragment',
  ]) {
    await assertTargetError(() => validateRoutingTarget(baseUrl, { lookup }));
  }
});

test('normalizes only origin and known 9router base suffixes', async () => {
  const lookup = lookupAnswers({ address: '93.184.216.34', family: 4 });

  for (const baseUrl of [
    'https://router.example',
    'https://router.example/',
    'https://router.example/v1',
    'https://router.example/v1///',
    'https://router.example/api/v1',
    'https://router.example/api/v1///',
  ]) {
    const target = await validateRoutingTarget(baseUrl, { lookup });
    assert.equal(target.origin, 'https://router.example');
    assert.equal(target.hostname, 'router.example');
    assert.equal(target.port, 443);
  }

  await assertTargetError(() =>
    validateRoutingTarget('https://router.example/arbitrary/path', { lookup }),
  );
});

test('requires HTTPS for every non-loopback target', async () => {
  const lookup = lookupAnswers({ address: '93.184.216.34', family: 4 });

  await assertTargetError(() =>
    validateRoutingTarget('http://router.example', {
      lookup,
      allowLoopbackHttp: true,
    }),
  );
});

test('permits loopback HTTP only with explicit deployment configuration', async () => {
  const lookup = lookupAnswers({ address: '127.0.0.1', family: 4 });

  await assertTargetError(() =>
    validateRoutingTarget('http://localhost:4096', {
      lookup,
      allowLoopbackHttp: false,
    }),
  );

  const target = await validateRoutingTarget('http://localhost:4096/v1', {
    lookup,
    allowLoopbackHttp: true,
  });
  assert.equal(target.origin, 'http://localhost:4096');
  assert.equal(target.loopback, true);
});

test('reads loopback HTTP opt-in from the server environment', async () => {
  const previous = process.env.CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP;
  process.env.CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP = 'true';
  try {
    const target = await validateRoutingTarget('http://localhost:4096', {
      lookup: lookupAnswers({ address: '::1', family: 6 }),
    });
    assert.equal(target.loopback, true);
  } finally {
    if (previous === undefined) {
      delete process.env.CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP;
    } else {
      process.env.CLOUDCLI_ROUTING_ALLOW_LOOPBACK_HTTP = previous;
    }
  }
});

test('blocks unsafe IPv4 and IPv6 address classes', async () => {
  const blockedAnswers: LookupAnswer[] = [
    { address: '0.0.0.0', family: 4 },
    { address: '10.1.2.3', family: 4 },
    { address: '100.64.0.1', family: 4 },
    { address: '127.0.0.1', family: 4 },
    { address: '169.254.169.254', family: 4 },
    { address: '172.16.0.1', family: 4 },
    { address: '192.0.2.1', family: 4 },
    { address: '192.168.1.1', family: 4 },
    { address: '198.18.0.1', family: 4 },
    { address: '198.51.100.1', family: 4 },
    { address: '203.0.113.1', family: 4 },
    { address: '224.0.0.1', family: 4 },
    { address: '::', family: 6 },
    { address: '::1', family: 6 },
    { address: '64:ff9b::a9fe:a9fe', family: 6 },
    { address: '100::1', family: 6 },
    { address: 'fc00::1', family: 6 },
    { address: 'fec0::1', family: 6 },
    { address: 'fe80::1', family: 6 },
    { address: 'ff02::1', family: 6 },
    { address: '2001:2::1', family: 6 },
    { address: '2001:db8::1', family: 6 },
    { address: '2002:a9fe:a9fe::1', family: 6 },
    { address: '::ffff:127.0.0.1', family: 6 },
  ];

  for (const answer of blockedAnswers) {
    await assertTargetError(() =>
      validateRoutingTarget('https://router.example', {
        lookup: lookupAnswers(answer),
      }),
    );
  }
});

test('rejects a hostname when any DNS answer is blocked', async () => {
  await assertTargetError(() =>
    validateRoutingTarget('https://router.example', {
      lookup: lookupAnswers(
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ),
    }),
  );
});

test('allows only exact host or matching CIDR exceptions for private self-host targets', async () => {
  const privateLookup = lookupAnswers({ address: '10.20.30.40', family: 4 });

  const hostAllowed = await validateRoutingTarget('https://router.internal', {
    lookup: privateLookup,
    allowedHosts: ['router.internal'],
  });
  assert.equal(hostAllowed.pinnedAddress, '10.20.30.40');

  const cidrAllowed = await validateRoutingTarget('https://router.internal', {
    lookup: privateLookup,
    allowedCidrs: ['10.20.0.0/16'],
  });
  assert.equal(cidrAllowed.pinnedAddress, '10.20.30.40');

  await assertTargetError(() =>
    validateRoutingTarget('https://router.internal', {
      lookup: privateLookup,
      allowedHosts: ['other.internal'],
      allowedCidrs: ['10.30.0.0/16'],
    }),
  );

  await assertTargetError(
    () =>
      validateRoutingTarget('https://router.internal', {
        lookup: privateLookup,
        allowedHosts: ['*.internal'],
      }),
    'ROUTING_CONFIGURATION_INVALID',
  );

  await assertTargetError(
    () =>
      validateRoutingTarget('https://router.internal', {
        lookup: privateLookup,
        allowedCidrs: ['not-a-cidr'],
      }),
    'ROUTING_CONFIGURATION_INVALID',
  );
});

test('never allows cloud metadata destinations through a hostname exception', async () => {
  await assertTargetError(() =>
    validateRoutingTarget('https://metadata.google.internal', {
      lookup: lookupAnswers({ address: '169.254.169.254', family: 4 }),
      allowedHosts: ['metadata.google.internal'],
    }),
  );
});

test('returns one validated pinned address and resolves again for each call', async () => {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return [{ address: calls === 1 ? '93.184.216.34' : '93.184.216.35', family: 4 as const }];
  };

  const first = await validateRoutingTarget('https://router.example', { lookup });
  const second = await validateRoutingTarget('https://router.example', { lookup });

  assert.equal(first.pinnedAddress, '93.184.216.34');
  assert.equal(second.pinnedAddress, '93.184.216.35');
  assert.equal(calls, 2);
});
