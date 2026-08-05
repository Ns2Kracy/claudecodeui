export {
  routingRoutes,
  routingService,
  routingRuntimeService,
  startRoutingUsageMonitor,
  stopRoutingUsageMonitor,
  tryAutoConnect,
} from './routing.module.js';

// Future routing startup wiring consumes this factory through the module barrel
// so callers do not deep-import the runtime supervisor implementation.
export { createNineRouterRuntimeService } from './nine-router-runtime.service.js';

// Future routing startup wiring and tests consume these public contracts to
// inject process, filesystem/package, clock, port, health, and credential adapters.
export type {
  NineRouterRuntimeService,
  NineRouterRuntimeServiceDependencies,
} from './nine-router-runtime.service.js';
