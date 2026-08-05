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
