export {
  routingRoutes,
  routingService,
  routingRuntimeService,
  startEmbeddedNineRouter,
  startRoutingUsageMonitor,
  stopEmbeddedNineRouter,
  stopRoutingUsageMonitor,
  restartEmbeddedNineRouter,
  getEmbeddedNineRouterStatus,
  tryAutoConnect,
} from './routing.module.js';

// Future routing startup wiring consumes this factory through the module barrel
// so callers do not deep-import the runtime supervisor implementation.
export { createNineRouterRuntimeService } from './nine-router-runtime.service.js';
